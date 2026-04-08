import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery, executeTransaction, runQuery } from './database';
import { requireAuth, requireAdmin } from './auth';
import {
  CHATBOT_CONTRACT_VERSION,
  LocationSnapshot,
  deriveVisibilityScopeByRole,
  validateLocationSnapshot,
} from './chatbot-data-contract';
import { getLocationFromCoordinates } from './location-service';

export const adminApprovalsRouter = Router();

interface ApprovalRequestRow {
  id: string;
  request_type: string;
  requested_by_user_id: string;
  requested_by_lark_id: string | null;
  reason: string;
  payload_json: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

interface DashboardUserRow {
  id: string;
  username: string | null;
  role: string | null;
  lark_id: string | null;
  lark_avatar_url?: string | null;
  custom_avatar_url?: string | null;
}

interface SessionRow {
  user_id: string;
  session_id: string;
  location: string | null;
  start_time?: string | null;
  updated_at: string | null;
  stop_time: string | null;
  battery?: string | null;
  device?: string | null;
}

interface ParsedSessionLocation {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  capturedAt: string;
  source: string;
  address: string | null;
  spoofingDetected?: boolean;
  spoofingReason?: string | null;
  confidence?: number;
}

type FreshnessStatus = 'live' | 'stale' | 'offline';
type AccessStatus = 'active' | 'recent' | 'offline';

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const RECENT_WINDOW_MS = 5 * 60 * 1000;
const FIRST_ADMIN_OPEN_ID = process.env.FIRST_ADMIN_OPEN_ID || 'ou_d652030afb4a5cbe7d08f3cfdda685ad';
const FIRST_ADMIN_TENANT_KEY = process.env.FIRST_ADMIN_TENANT_KEY || '12f9cd33134f1759';
const BLOB_STORAGE_HOST_SUFFIX = '.public.blob.vercel-storage.com';
const LARK_AVATAR_ALLOWED_HOST_SUFFIXES = String(process.env.LARK_AVATAR_ALLOWED_HOST_SUFFIXES || 'larksuite.com,feishu.cn,byteimg.com,larkoffice.com,larkofficecdn.com,feishucdn.com,larkcdn.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.length > 0);

const PHILIPPINES_BOUNDS = {
  minLat: 4.0,
  maxLat: 22.5,
  minLng: 116.0,
  maxLng: 127.5,
};

const LOCATION_ADDRESS_CACHE_TTL_MS = 15 * 60 * 1000;
const locationAddressCache = new Map<string, { address: string | null; expiresAt: number }>();

function getAddressCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

const BANNED_ADDRESS_PATTERNS: RegExp[] = [
  /^McDonald['']?s?,?\s*/i,
  /^Jollibee,?\s*/i,
  /^KFC,?\s*/i,
  /^7-Eleven,?\s*/i,
  /^Starbucks,?\s*/i,
  /^Mercury Drug,?\s*/i,
  /^SM\s/i,
  /^Puregold,?\s*/i,
  /^Ministop,?\s*/i,
  /^FamilyMart,?\s*/i,
  /^Alfamart,?\s*/i,
  /^Robinsons,?\s*/i,
  /^Watsons,?\s*/i,
  /^Chowking,?\s*/i,
  /^Greenwich,?\s*/i,
  /^Red Ribbon,?\s*/i,
  /^Goldilocks,?\s*/i,
  /^Mang Inasal,?\s*/i,
  /^Bonchon,?\s*/i,
  /^Shakey['']?s,?\s*/i,
  /^Pizza Hut,?\s*/i,
  /^Burger King,?\s*/i,
  /^Subway,?\s*/i,
  /^Wendy['']?s,?\s*/i,
  /^Dunkin['']?,?\s*/i,
  /^Caltex,?\s*/i,
  /^Shell,?\s*/i,
  /^Petron,?\s*/i,
  /^PhoenixFUELS?,?\s*/i,
];

function sanitizeAddress(raw: string): string {
  let cleaned = raw.trim();
  for (const pattern of BANNED_ADDRESS_PATTERNS) {
    if (pattern.test(cleaned)) {
      // Remove the matched POI name and any following comma
      const commaIndex = cleaned.indexOf(',');
      if (commaIndex > 0 && commaIndex < 60) {
        cleaned = cleaned.slice(commaIndex + 1).trim();
      }
      break;
    }
  }
  return cleaned;
}

async function resolveAddressForLocation(lat: number, lng: number): Promise<string | null> {
  const cacheKey = getAddressCacheKey(lat, lng);
  const now = Date.now();
  const cached = locationAddressCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.address;
  }

  const resolved = await getLocationFromCoordinates(lat, lng);
  let address = resolved?.address && resolved.address.trim().length > 0
    ? resolved.address.trim()
    : null;

  // Safety net: strip any commercial establishment names that leaked through
  if (address) {
    address = sanitizeAddress(address);
  }

  locationAddressCache.set(cacheKey, {
    address,
    expiresAt: now + LOCATION_ADDRESS_CACHE_TTL_MS,
  });

  return address;
}

function normalizeIsoDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function getFreshnessSeconds(capturedAt: string, generatedAt: string): number {
  const capturedMs = Date.parse(capturedAt);
  const generatedMs = Date.parse(generatedAt);
  if (Number.isNaN(capturedMs) || Number.isNaN(generatedMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((generatedMs - capturedMs) / 1000));
}

function getLocationConfidence(accessStatus: AccessStatus, accuracyMeters: number | null): number {
  const base = accessStatus === 'active'
    ? 0.96
    : accessStatus === 'recent'
      ? 0.84
      : 0.62;

  if (!Number.isFinite(accuracyMeters as number)) {
    return Number(base.toFixed(2));
  }

  const accuracy = Number(accuracyMeters);
  if (accuracy <= 15) return Number(base.toFixed(2));
  if (accuracy <= 50) return Number(Math.max(0, base - 0.04).toFixed(2));
  if (accuracy <= 120) return Number(Math.max(0, base - 0.08).toFixed(2));
  return Number(Math.max(0, base - 0.15).toFixed(2));
}

interface FieldmanLocationItem {
  userId: string;
  name: string;
  role: 'admin' | 'fieldman';
  larkId: string | null;
  avatarUrl: string | null;
  sessionId: string | null;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  capturedAt: string;
  source: string;
  address: string | null;
  accessStatus: AccessStatus;
  freshnessStatus: FreshnessStatus;
  spoofingDetected?: boolean;
  spoofingReason?: string | null;
  confidence?: number;
}

function toLocationSnapshot(item: FieldmanLocationItem, generatedAt: string): LocationSnapshot {
  const capturedAt = normalizeIsoDate(item.capturedAt, generatedAt);

  return {
    entityType: 'LocationSnapshot',
    entityId: item.userId,
    sourceApi: '/api/admin/fieldman-locations',
    updatedAt: capturedAt,
    capturedAt,
    freshnessSeconds: getFreshnessSeconds(capturedAt, generatedAt),
    confidence: getLocationConfidence(item.accessStatus, item.accuracyMeters),
    visibilityScope: deriveVisibilityScopeByRole(item.role),
    version: CHATBOT_CONTRACT_VERSION,
    personName: item.name,
    role: item.role,
    latitude: item.lat,
    longitude: item.lng,
    address: item.address || null,
    freshnessStatus: item.freshnessStatus,
    accessStatus: item.accessStatus,
    source: item.source || 'admin-fieldman-map',
  };
}

interface FieldmanLocationsPayload {
  generatedAt: string;
  summary: {
    totalCandidates: number;
    inPhilippinesCount: number;
    excludedOutOfPhilippinesCount: number;
  };
  items: FieldmanLocationItem[];
  chatbotFeed: LocationSnapshot[];
}

function requireInternalScraperKey(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = String(process.env.INTERNAL_SCRAPER_API_KEY || '').trim();
  if (!expectedKey) {
    res.status(503).json({ error: 'Internal scraper API key is not configured' });
    return;
  }

  const providedKey = String(req.get('x-internal-api-key') || '').trim();
  if (!providedKey || providedKey !== expectedKey) {
    res.status(401).json({ error: 'Invalid internal API key' });
    return;
  }

  next();
}

function isMainAdminIdentityByLarkId(larkId: string | null | undefined): boolean {
  return String(larkId || '') === FIRST_ADMIN_OPEN_ID;
}

function isMainAdminRequester(user: any): boolean {
  const role = String(user?.role || '').toLowerCase();
  const larkId = String(user?.larkId || '');
  const tenant = String(user?.larkTenant || '');
  return role === 'admin' && larkId === FIRST_ADMIN_OPEN_ID && tenant === FIRST_ADMIN_TENANT_KEY;
}

function getPermittedRoleTargetForRequester(
  requester: any,
  target: { id: string; role: string | null; lark_id: string | null }
): 'admin' | 'fieldman' | null {
  const requesterRole = String(requester?.role || '').toLowerCase();
  if (requesterRole !== 'admin') {
    return null;
  }

  if (isMainAdminIdentityByLarkId(target.lark_id)) {
    return null;
  }

  const targetRole = String(target.role || '').toLowerCase() === 'admin' ? 'admin' : 'fieldman';
  if (isMainAdminRequester(requester)) {
    return targetRole === 'admin' ? 'fieldman' : 'admin';
  }

  const requesterId = String(requester?.userId || '');
  if (targetRole === 'fieldman') {
    return 'admin';
  }

  if (targetRole === 'admin' && String(target.id) === requesterId) {
    return 'fieldman';
  }

  return null;
}

function normalizeAvatarUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (raw.startsWith('/')) {
    return raw.slice(0, 512);
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString().slice(0, 512);
    }
  } catch {
    return null;
  }

  return null;
}

function isManagedAvatarUrl(value: string): boolean {
  if (value.startsWith('/')) {
    return value.startsWith('/uploads/profile/');
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.endsWith(BLOB_STORAGE_HOST_SUFFIX)) {
      return false;
    }
    return parsed.pathname.includes('/avatars/');
  } catch {
    return false;
  }
}

function toManagedAvatarUrlOrNull(value: unknown): string | null {
  const normalized = normalizeAvatarUrl(value);
  if (!normalized) return null;
  return isManagedAvatarUrl(normalized) ? normalized : null;
}

function isAllowedLarkAvatarHost(remoteUrl: string): boolean {
  try {
    const parsed = new URL(remoteUrl);
    const hostname = parsed.hostname.toLowerCase();
    return LARK_AVATAR_ALLOWED_HOST_SUFFIXES.some((suffix) => {
      if (!suffix) return false;
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    });
  } catch {
    return false;
  }
}

function toTrustedLarkAvatarUrlOrNull(value: unknown): string | null {
  const normalized = normalizeAvatarUrl(value);
  if (!normalized) return null;

  if (isManagedAvatarUrl(normalized)) {
    return normalized;
  }

  if (normalized.startsWith('/')) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  return normalized;
}

function resolveEffectiveAvatarUrl(customAvatarUrl: unknown, larkAvatarUrl: unknown): string | null {
  void customAvatarUrl;
  return toTrustedLarkAvatarUrlOrNull(larkAvatarUrl) || null;
}

function requireMainAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user;
  if (!isMainAdminRequester(user)) {
    res.status(403).json({ error: 'Main admin authorization required' });
    return;
  }
  next();
}

async function buildFieldmanLocationsPayload(): Promise<FieldmanLocationsPayload> {
  const users = await runQuery<DashboardUserRow>(`SELECT id, username, role, lark_id, lark_avatar_url, custom_avatar_url FROM users`);
  const sessions = await runQuery<SessionRow>(
    `SELECT user_id, session_id, location, updated_at, stop_time FROM user_sessions`
  );

  const candidates = users.filter(
    (user) => {
      const normalizedRole = (user.role || '').toLowerCase();
      const isTrackableRole = normalizedRole === 'fieldman' || normalizedRole === 'admin';
      return isTrackableRole && Boolean((user.lark_id || '').trim());
    }
  );

  const nowMs = Date.now();
  const latestByUser = getLatestSessionByUser(sessions, nowMs);
  const bestAccessSessionByUser = getBestAccessSessionByUser(sessions, nowMs);
  let excludedOutOfPhilippinesCount = 0;

  const items = candidates
    .map<FieldmanLocationItem | null>((user) => {
      const latest = latestByUser.get(user.id);
      if (!latest) {
        return null;
      }
      const best = bestAccessSessionByUser.get(user.id);

      const location = latest.location;
      if (!isInPhilippines(location.lat, location.lng)) {
        excludedOutOfPhilippinesCount += 1;
        return null;
      }

      const accessStatus = best?.status || 'offline';
      const freshnessStatus: FreshnessStatus = accessStatus === 'active'
        ? 'live'
        : accessStatus === 'recent'
          ? 'stale'
          : 'offline';

      return {
        userId: user.id,
        name: user.username || 'Unknown User',
        role: (user.role || 'fieldman').toLowerCase() === 'admin' ? 'admin' : 'fieldman',
        larkId: user.lark_id || null,
        avatarUrl: resolveEffectiveAvatarUrl(user.custom_avatar_url, user.lark_avatar_url),
        sessionId: latest.sessionId,
        lat: location.lat,
        lng: location.lng,
        accuracyMeters: location.accuracyMeters,
        capturedAt: location.capturedAt,
        source: location.source,
        address: location.address,
        accessStatus,
        freshnessStatus,
        spoofingDetected: location.spoofingDetected || false,
        spoofingReason: location.spoofingReason || null,
        confidence: location.confidence ?? 1.0,
      };
    })
    .filter((item): item is FieldmanLocationItem => item !== null);

  await Promise.all(items.map(async (item) => {
    if (item.address && item.address.trim().length > 0) {
      return;
    }

    try {
      item.address = await resolveAddressForLocation(item.lat, item.lng);
    } catch {
      item.address = null;
    }
  }));

  const generatedAt = new Date().toISOString();
  const chatbotFeed: LocationSnapshot[] = items
    .map((item) => toLocationSnapshot(item, generatedAt))
    .filter((snapshot) => validateLocationSnapshot(snapshot).length === 0);

  return {
    generatedAt,
    summary: {
      totalCandidates: candidates.length,
      inPhilippinesCount: items.length,
      excludedOutOfPhilippinesCount,
    },
    items,
    chatbotFeed,
  };
}

function parseSinceQuery(req: Request): number | null {
  const since = typeof req.query.since === 'string' ? req.query.since : '';
  if (!since) return null;
  const parsed = Date.parse(since);
  return Number.isNaN(parsed) ? null : parsed;
}

function deriveNextCursor(items: LocationSnapshot[], fallbackIso: string): string {
  let maxMs = Date.parse(fallbackIso);
  if (Number.isNaN(maxMs)) {
    maxMs = 0;
  }

  items.forEach((item) => {
    const parsed = Date.parse(item.updatedAt);
    if (!Number.isNaN(parsed) && parsed > maxMs) {
      maxMs = parsed;
    }
  });

  return new Date(maxMs || Date.now()).toISOString();
}

function parseTimestamp(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseSessionLocation(rawLocation: string | null, updatedAt: string | null): ParsedSessionLocation | null {
  if (!rawLocation || typeof rawLocation !== 'string') {
    return null;
  }

  const sanitized = rawLocation.trim();
  if (!sanitized) {
    return null;
  }

  let lat: number | null = null;
  let lng: number | null = null;
  let accuracyMeters: number | null = null;
  let capturedAt = updatedAt || new Date().toISOString();
  let source = 'unknown';
  let address: string | null = null;
  let spoofingDetected = false;
  let spoofingReason: string | null = null;
  let confidence = 1.0;

  try {
    const parsed = JSON.parse(sanitized);
    if (parsed && typeof parsed === 'object') {
      const candidateLat = Number((parsed as any).lat ?? (parsed as any).latitude);
      const candidateLng = Number((parsed as any).lng ?? (parsed as any).longitude);
      if (Number.isFinite(candidateLat) && Number.isFinite(candidateLng)) {
        lat = candidateLat;
        lng = candidateLng;
      }

      const candidateAccuracy = Number((parsed as any).accuracyMeters ?? (parsed as any).accuracy);
      if (Number.isFinite(candidateAccuracy) && candidateAccuracy >= 0) {
        accuracyMeters = Number(candidateAccuracy.toFixed(1));
      }

      if (typeof (parsed as any).capturedAt === 'string' && parseTimestamp((parsed as any).capturedAt) > 0) {
        capturedAt = new Date((parsed as any).capturedAt).toISOString();
      }

      if (typeof (parsed as any).source === 'string' && (parsed as any).source.trim().length > 0) {
        source = (parsed as any).source.trim();
      }

      if (typeof (parsed as any).address === 'string' && (parsed as any).address.trim().length > 0) {
        address = (parsed as any).address.trim().slice(0, 260);
      }

      // Parse spoofing detection data
      if (typeof (parsed as any).spoofingDetected === 'boolean') {
        spoofingDetected = (parsed as any).spoofingDetected;
      }
      if (typeof (parsed as any).spoofingReason === 'string') {
        spoofingReason = (parsed as any).spoofingReason;
      }
      if (typeof (parsed as any).confidence === 'number' && Number.isFinite((parsed as any).confidence)) {
        confidence = Math.max(0, Math.min(1, (parsed as any).confidence));
      }
    }
  } catch {
    const match = sanitized.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (match) {
      lat = Number(match[1]);
      lng = Number(match[2]);
      source = 'legacy-string';
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (lat! < -90 || lat! > 90 || lng! < -180 || lng! > 180) {
    return null;
  }

  return {
    lat: Number(lat!.toFixed(6)),
    lng: Number(lng!.toFixed(6)),
    accuracyMeters,
    capturedAt,
    source,
    address,
    spoofingDetected,
    spoofingReason,
    confidence,
  };
}

function isInPhilippines(lat: number, lng: number): boolean {
  if (
    lat < PHILIPPINES_BOUNDS.minLat ||
    lat > PHILIPPINES_BOUNDS.maxLat ||
    lng < PHILIPPINES_BOUNDS.minLng ||
    lng > PHILIPPINES_BOUNDS.maxLng
  ) {
    return false;
  }

  return true;
}

function getLocationSourceScore(source: string): number {
  const normalized = String(source || '').toLowerCase();
  if (normalized === 'browser-gps-watch' || normalized === 'browser-gps') return 1;
  if (normalized === 'admin-fieldman-map') return 0.92;
  if (normalized === 'cached-location') return 0.45;
  if (normalized === 'ip-approx') return 0.2;
  if (normalized === 'legacy-string') return 0.6;
  return 0.7;
}

function getLocationAccuracyScore(accuracyMeters: number | null): number {
  if (!Number.isFinite(accuracyMeters as number)) return 0.65;
  const accuracy = Number(accuracyMeters);
  if (accuracy <= 30) return 1;
  if (accuracy <= 80) return 0.9;
  if (accuracy <= 200) return 0.75;
  if (accuracy <= 600) return 0.55;
  if (accuracy <= 1200) return 0.35;
  return 0.15;
}

function getLocationQualityScore(location: ParsedSessionLocation): number {
  const sourceScore = getLocationSourceScore(location.source);
  const accuracyScore = getLocationAccuracyScore(location.accuracyMeters);
  const confidenceScore = Number.isFinite(location.confidence as number)
    ? Math.max(0, Math.min(1, Number(location.confidence)))
    : 1;
  const spoofPenalty = location.spoofingDetected ? 0.25 : 1;
  return Number(((sourceScore * 0.4 + accuracyScore * 0.4 + confidenceScore * 0.2) * spoofPenalty).toFixed(4));
}

function getLocationSelectionScore(location: ParsedSessionLocation, sampleMs: number, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - sampleMs);
  const recencyScore = Math.max(0, 1 - (ageMs / (2 * 60 * 60 * 1000)));
  let score = recencyScore * 0.62 + getLocationQualityScore(location) * 0.38;

  if (String(location.source || '').toLowerCase() === 'ip-approx') {
    score *= 0.7;
  }

  return Number(score.toFixed(4));
}

function getLatestSessionByUser(rows: SessionRow[], nowMs: number): Map<string, { sessionId: string; location: ParsedSessionLocation; updatedAtMs: number }> {
  const latestByUser = new Map<string, { sessionId: string; location: ParsedSessionLocation; updatedAtMs: number; selectionScore: number }>();

  rows.forEach((row) => {
    const parsedLocation = parseSessionLocation(row.location, row.updated_at);
    if (!parsedLocation || !row.user_id) {
      return;
    }

    const capturedMs = parseTimestamp(parsedLocation.capturedAt);
    const updatedMs = parseTimestamp(row.updated_at);
    const score = Math.max(capturedMs, updatedMs);

    const selectionScore = getLocationSelectionScore(parsedLocation, score, nowMs);
    const existing = latestByUser.get(row.user_id);
    if (
      !existing ||
      selectionScore > (existing.selectionScore + 0.015) ||
      (Math.abs(selectionScore - existing.selectionScore) <= 0.015 && score > existing.updatedAtMs)
    ) {
      latestByUser.set(row.user_id, {
        sessionId: row.session_id,
        location: parsedLocation,
        updatedAtMs: score,
        selectionScore,
      });
    }
  });

  const result = new Map<string, { sessionId: string; location: ParsedSessionLocation; updatedAtMs: number }>();
  latestByUser.forEach((value, key) => {
    result.set(key, {
      sessionId: value.sessionId,
      location: value.location,
      updatedAtMs: value.updatedAtMs,
    });
  });
  return result;
}

function getSessionScore(row: SessionRow): number {
  return Math.max(
    parseTimestamp(row.updated_at),
    parseTimestamp(row.stop_time),
    parseTimestamp(row.start_time)
  );
}

function getBestAccessSessionByUser(
  rows: SessionRow[],
  nowMs: number
): Map<string, { row: SessionRow; status: AccessStatus }> {
  const bestByUser = new Map<string, { row: SessionRow; status: AccessStatus }>();
  const statusRank: Record<AccessStatus, number> = {
    active: 0,
    recent: 1,
    offline: 2,
  };

  rows.forEach((row) => {
    if (!row.user_id) return;

    const candidateStatus = getAccessStatus(row, nowMs);
    const existing = bestByUser.get(row.user_id);

    if (!existing) {
      bestByUser.set(row.user_id, { row, status: candidateStatus });
      return;
    }

    const candidateRank = statusRank[candidateStatus];
    const existingRank = statusRank[existing.status];

    if (candidateRank < existingRank) {
      bestByUser.set(row.user_id, { row, status: candidateStatus });
      return;
    }

    if (candidateRank === existingRank && getSessionScore(row) > getSessionScore(existing.row)) {
      bestByUser.set(row.user_id, { row, status: candidateStatus });
    }
  });

  return bestByUser;
}

function getAccessStatus(row: SessionRow | null | undefined, nowMs: number): AccessStatus {
  if (!row) return 'offline';

  const updatedMs = Math.max(parseTimestamp(row.updated_at), parseTimestamp(row.start_time));
  const stoppedMs = parseTimestamp(row.stop_time);
  const lastEventMs = Math.max(updatedMs, stoppedMs);

  if (!lastEventMs) {
    return 'offline';
  }

  const hasRecentUpdate = (nowMs - updatedMs) <= ACTIVE_WINDOW_MS;
  const resumedAfterStop = stoppedMs > 0 && updatedMs > stoppedMs;

  if (hasRecentUpdate && (!stoppedMs || resumedAfterStop)) {
    return 'active';
  }

  if ((nowMs - lastEventMs) <= RECENT_WINDOW_MS) {
    return 'recent';
  }

  return 'offline';
}

function pickStatusChangedAt(row: SessionRow | null | undefined, status: AccessStatus): string | null {
  if (!row) return null;

  if (status === 'active') {
    return row.updated_at || row.start_time || null;
  }

  return row.stop_time || row.updated_at || row.start_time || null;
}

function parseDeviceLabel(rawDevice: string | null | undefined): string | null {
  if (!rawDevice || typeof rawDevice !== 'string') {
    return null;
  }

  const trimmed = rawDevice.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const platform = typeof (parsed as any).platform === 'string' ? (parsed as any).platform.trim() : '';
      const os = typeof (parsed as any).os === 'string' ? (parsed as any).os.trim() : '';
      const browser = typeof (parsed as any).browser === 'string' ? (parsed as any).browser.trim() : '';
      const model = typeof (parsed as any).model === 'string' ? (parsed as any).model.trim() : '';

      const parts = [platform, os, browser, model].filter((value) => value.length > 0);
      if (parts.length > 0) {
        return parts.join(' / ').slice(0, 120);
      }
    }
  } catch {
    // Fall through to plain string formatting.
  }

  return trimmed.slice(0, 120);
}

async function insertAuditLog(
  approvalRequestId: string,
  actorUserId: string,
  action: 'create' | 'approve' | 'reject' | 'delete',
  metadata: Record<string, unknown>
): Promise<void> {
  await executeQuery(
    `INSERT INTO approval_audit_log (id, approval_request_id, actor_user_id, action, metadata_json) VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), approvalRequestId, actorUserId, action, JSON.stringify(metadata)]
  );
}

adminApprovalsRouter.post('/approvals', requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { requestType, reason, payload } = req.body;

  if (requestType !== 'role_elevation_admin') {
    res.status(400).json({ error: 'Unsupported requestType. Allowed: role_elevation_admin' });
    return;
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 8) {
    res.status(400).json({ error: 'Reason is required and must be at least 8 characters.' });
    return;
  }

  const existing = await runQuery<{ id: string }>(
    `SELECT id FROM approval_requests WHERE requested_by_user_id = ? AND request_type = ? AND status = ?`,
    [user.userId, requestType, 'pending']
  );

  if (existing.length > 0) {
    res.status(409).json({ error: 'You already have a pending request of this type.' });
    return;
  }

  const id = uuidv4();
  await executeQuery(
    `INSERT INTO approval_requests (id, request_type, requested_by_user_id, requested_by_lark_id, reason, payload_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      requestType,
      user.userId,
      user.larkId || null,
      reason.trim(),
      payload ? JSON.stringify(payload) : null,
      'pending',
    ]
  );

  await insertAuditLog(id, user.userId, 'create', {
    requestType,
    reason: reason.trim(),
  });

  res.status(201).json({ success: true, id, status: 'pending' });
});

adminApprovalsRouter.get('/admin/approvals', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const rawStatus = String(req.query.status || 'pending').toLowerCase();
  const status = rawStatus === 'approved' || rawStatus === 'rejected' ? rawStatus : 'pending';

  const approvals = await runQuery<ApprovalRequestRow>(
    `SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC`,
    [status]
  );

  const requesterRows = await runQuery<{ id: string; username: string | null; email: string | null; role: string | null }>(
    `SELECT id, username, email, role FROM users`
  );
  const requesterById = new Map<string, { username: string | null; email: string | null; role: string | null }>(
    requesterRows.map((row) => [row.id, { username: row.username, email: row.email, role: row.role }])
  );

  const items = await Promise.all(
    approvals.map(async (item) => {
      const requester = requesterById.get(item.requested_by_user_id);

      return {
        id: item.id,
        requestType: item.request_type,
        status: item.status,
        reason: item.reason,
        payload: item.payload_json ? JSON.parse(item.payload_json) : null,
        requestedBy: {
          userId: item.requested_by_user_id,
          larkId: item.requested_by_lark_id,
          name: requester?.username || 'Unknown User',
          email: requester?.email || null,
          role: requester?.role || null,
        },
        reviewedByUserId: item.reviewed_by_user_id,
        reviewedAt: item.reviewed_at,
        decisionNote: item.decision_note,
        createdAt: item.created_at,
      };
    })
  );

  res.json({ success: true, status, count: items.length, items });
});

adminApprovalsRouter.get('/admin/access-activity', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const requester = (req as any).user;
  const requesterUserId = String(requester?.userId || '');
  const canManageUsers = isMainAdminRequester(requester);
  const canManageRoleChanges = String(requester?.role || '').toLowerCase() === 'admin';
  const users = await runQuery<DashboardUserRow>(`SELECT id, username, role, lark_id, lark_avatar_url, custom_avatar_url FROM users`);
  const sessions = await runQuery<SessionRow>(
    `SELECT user_id, session_id, location, start_time, updated_at, stop_time, battery, device FROM user_sessions`
  );

  const larkUsers = users.filter((user) => Boolean((user.lark_id || '').trim()));
  const nowMs = Date.now();
  const bestAccessSessionByUser = getBestAccessSessionByUser(sessions, nowMs);

  const items = larkUsers
    .map((user) => {
      const best = bestAccessSessionByUser.get(user.id);
      const latest = best?.row;
      const status = best?.status || 'offline';
      const statusChangedAt = pickStatusChangedAt(latest, status);
      const lastEventAt = latest ? (pickStatusChangedAt(latest, 'recent') || null) : null;
      const parsedLocation = latest ? parseSessionLocation(latest.location, latest.updated_at) : null;
      const locationText = parsedLocation ? `${parsedLocation.lat.toFixed(4)}, ${parsedLocation.lng.toFixed(4)}` : null;

      return {
        userId: user.id,
        name: user.username || 'Unknown User',
        role: (user.role || 'unknown').toLowerCase(),
        larkId: user.lark_id || null,
        avatarUrl: resolveEffectiveAvatarUrl(user.custom_avatar_url, user.lark_avatar_url),
        status,
        statusChangedAt,
        lastEventAt,
        sessionId: latest?.session_id || null,
        startTime: latest?.start_time || null,
        stopTime: latest?.stop_time || null,
        updatedAt: latest?.updated_at || null,
        device: parseDeviceLabel(latest?.device) || null,
        battery: latest?.battery || null,
        location: canManageUsers ? locationText : null,
        isSelf: user.id === requesterUserId,
        isMainAdminIdentity: isMainAdminIdentityByLarkId(user.lark_id),
      };
    })
    .sort((a, b) => {
      const order = { active: 0, recent: 1, offline: 2 } as const;
      const statusDelta = order[a.status as AccessStatus] - order[b.status as AccessStatus];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const timeA = parseTimestamp(a.lastEventAt || a.statusChangedAt);
      const timeB = parseTimestamp(b.lastEventAt || b.statusChangedAt);
      if (timeA !== timeB) {
        return timeB - timeA;
      }

      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  const activeCount = items.filter((item) => item.status === 'active').length;
  const recentCount = items.filter((item) => item.status === 'recent').length;
  const offlineCount = items.filter((item) => item.status === 'offline').length;

  res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    canManageUsers,
    canManageRoleChanges,
    isMainAdminRequester: canManageUsers,
    currentUserId: requesterUserId,
    summary: {
      totalUsers: items.length,
      activeCount,
      recentCount,
      offlineCount,
    },
    items,
  });
});

adminApprovalsRouter.patch('/admin/users/:id/role', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const requester = (req as any).user;
  const targetUserId = String(req.params.id || '').trim();
  const requestedRole = String(req.body?.role || '').toLowerCase();

  if (!targetUserId) {
    res.status(400).json({ error: 'Target user id is required' });
    return;
  }

  if (requestedRole !== 'admin' && requestedRole !== 'fieldman') {
    res.status(400).json({ error: 'Role must be admin or fieldman' });
    return;
  }

  const rows = await runQuery<{ id: string; username: string | null; role: string | null; lark_id: string | null }>(
    `SELECT id, username, role, lark_id FROM users WHERE id = ?`,
    [targetUserId]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const target = rows[0];
  if (!target.lark_id) {
    res.status(400).json({ error: 'Only Lark users can be managed from this table' });
    return;
  }

  const permittedRoleTarget = getPermittedRoleTargetForRequester(requester, target);
  if (!permittedRoleTarget) {
    res.status(403).json({ error: 'You are not allowed to change this user role' });
    return;
  }

  if (requestedRole !== permittedRoleTarget) {
    res.status(403).json({ error: `Allowed role change for this user is only: ${permittedRoleTarget}` });
    return;
  }

  await executeQuery(
    `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [requestedRole, targetUserId]
  );

  res.json({
    success: true,
    userId: targetUserId,
    role: requestedRole,
    name: target.username || 'Unknown User',
  });
});

adminApprovalsRouter.delete('/admin/users/:id', requireAuth, requireAdmin, requireMainAdmin, async (req: Request, res: Response) => {
  const requester = (req as any).user;
  const targetUserId = String(req.params.id || '').trim();

  if (!targetUserId) {
    res.status(400).json({ error: 'Target user id is required' });
    return;
  }

  const rows = await runQuery<{ id: string; username: string | null; lark_id: string | null }>(
    `SELECT id, username, lark_id FROM users WHERE id = ?`,
    [targetUserId]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const target = rows[0];
  if (!target.lark_id) {
    res.status(400).json({ error: 'Only Lark users can be managed from this table' });
    return;
  }

  if (isMainAdminIdentityByLarkId(target.lark_id)) {
    res.status(403).json({ error: 'Main admin account cannot be deleted' });
    return;
  }

  if (String(target.id) === String(requester?.userId || '')) {
    res.status(409).json({ error: 'Main admin cannot delete own account' });
    return;
  }

  try {
    await executeTransaction([
      {
        sql: `DELETE FROM conversations WHERE user_id = ?`,
        params: [targetUserId],
      },
      {
        sql: `DELETE FROM users WHERE id = ?`,
        params: [targetUserId],
      },
    ]);
  } catch (error) {
    const message = (error as any)?.message || 'Failed to delete user due to related records';
    res.status(409).json({ error: message });
    return;
  }

  res.json({
    success: true,
    userId: targetUserId,
    deleted: true,
    name: target.username || 'Unknown User',
  });
});

adminApprovalsRouter.get('/admin/dashboard/summary', requireAuth, requireAdmin, requireMainAdmin, async (_req: Request, res: Response) => {
  const users = await runQuery<DashboardUserRow>(`SELECT id, role, lark_id FROM users`);
  const larkUsers = users.filter((user) => Boolean((user.lark_id || '').trim()));

  const pending = await runQuery<{ id: string }>(`SELECT id FROM approval_requests WHERE status = ?`, ['pending']);
  const approved = await runQuery<{ id: string }>(`SELECT id FROM approval_requests WHERE status = ?`, ['approved']);
  const rejected = await runQuery<{ id: string }>(`SELECT id FROM approval_requests WHERE status = ?`, ['rejected']);

  const reviewedTotal = approved.length + rejected.length;
  const approvalRate = reviewedTotal > 0 ? Number(((approved.length / reviewedTotal) * 100).toFixed(1)) : 0;

  // Fetch users and sessions with simple queries for in-memory compatibility
  const rawUsers = await runQuery<DashboardUserRow>(`SELECT id, username, role, lark_id FROM users`);
  const allSessions = await runQuery<SessionRow>(
    `SELECT user_id, session_id, location, start_time, updated_at, stop_time FROM user_sessions`
  );
  const nowMs = Date.now();
  const latestByUser = getLatestSessionByUser(allSessions, nowMs);
  const bestAccessSessionByUser = getBestAccessSessionByUser(allSessions, nowMs);

  const onlineLarkUsers = larkUsers.filter((user) => {
    const best = bestAccessSessionByUser.get(user.id);
    return (best?.status || 'offline') === 'active';
  });

  const adminCount = onlineLarkUsers.filter((user) => (user.role || '').toLowerCase() === 'admin').length;
  const fieldmanCount = onlineLarkUsers.filter((user) => (user.role || '').toLowerCase() === 'fieldman').length;
  const totalUsers = onlineLarkUsers.length;

  // Filter and limit in TypeScript
  const activeLarkUsers = rawUsers
    .filter((u) => {
      if (!Boolean((u.lark_id || '').trim())) return false;
      const best = bestAccessSessionByUser.get(u.id);
      return (best?.status || 'offline') === 'active';
    })
    .slice(0, 18);

  const recentActiveUsers = activeLarkUsers.map(u => {
    const latest = latestByUser.get(u.id);
    const locationText = latest
      ? `${latest.location.lat.toFixed(4)}, ${latest.location.lng.toFixed(4)}`
      : 'No location yet';

    return {
      name: u.username || 'System User',
      role: u.role || 'fieldman',
      location: locationText,
    };
  });

  res.json({
    success: true,
    users: {
      total: totalUsers,
      adminCount,
      fieldmanCount,
      recentActiveUsers,
    },
    approvals: {
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      total: pending.length + approved.length + rejected.length,
      approvalRate,
    },
  });
});

adminApprovalsRouter.get('/admin/fieldman-locations', requireAuth, requireAdmin, requireMainAdmin, async (_req: Request, res: Response) => {
  const payload = await buildFieldmanLocationsPayload();

  res.json({
    success: true,
    generatedAt: payload.generatedAt,
    summary: payload.summary,
    items: payload.items,
    chatbotFeed: payload.chatbotFeed,
    chatbotFeedContractVersion: CHATBOT_CONTRACT_VERSION,
  });
});

adminApprovalsRouter.get('/internal/chatbot/location-feed', requireInternalScraperKey, async (req: Request, res: Response) => {
  const payload = await buildFieldmanLocationsPayload();
  const sinceMs = parseSinceQuery(req);

  const filteredItems = sinceMs == null
    ? payload.chatbotFeed
    : payload.chatbotFeed.filter((item) => {
      const updatedMs = Date.parse(item.updatedAt);
      return !Number.isNaN(updatedMs) && updatedMs > sinceMs;
    });

  const sinceIso = sinceMs == null ? payload.generatedAt : new Date(sinceMs).toISOString();
  const nextCursor = deriveNextCursor(filteredItems, sinceIso);

  res.json({
    success: true,
    generatedAt: payload.generatedAt,
    contractVersion: CHATBOT_CONTRACT_VERSION,
    sourceApi: '/api/internal/chatbot/location-feed',
    count: filteredItems.length,
    nextCursor,
    items: filteredItems,
  });
});

adminApprovalsRouter.post('/admin/approvals/:id/approve', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { decisionNote } = req.body;

  const requestRows = await runQuery<ApprovalRequestRow>(`SELECT * FROM approval_requests WHERE id = ?`, [id]);
  if (requestRows.length === 0) {
    res.status(404).json({ error: 'Approval request not found' });
    return;
  }

  const approval = requestRows[0];
  if (approval.status !== 'pending') {
    res.status(409).json({ error: 'Only pending requests can be approved' });
    return;
  }

  await executeQuery(
    `UPDATE approval_requests SET status = ?, reviewed_by_user_id = ?, decision_note = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?`,
    ['approved', user.userId, decisionNote || null, id, 'pending']
  );

  const latestRows = await runQuery<ApprovalRequestRow>(`SELECT * FROM approval_requests WHERE id = ?`, [id]);
  const latest = latestRows[0];
  if (!latest || latest.status !== 'approved' || latest.reviewed_by_user_id !== user.userId) {
    res.status(409).json({ error: 'Request was already processed by another admin.' });
    return;
  }

  const txStatements: Array<{ sql: string; params: any[] }> = [];

  if (approval.request_type === 'role_elevation_admin') {
    txStatements.push({
      sql:
      `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params: ['admin', approval.requested_by_user_id],
    });
  }

  txStatements.push({
    sql: `INSERT INTO approval_audit_log (id, approval_request_id, actor_user_id, action, metadata_json) VALUES (?, ?, ?, ?, ?)`,
    params: [
      uuidv4(),
      id,
      user.userId,
      'approve',
      JSON.stringify({
        decisionNote: decisionNote || null,
        requestType: approval.request_type,
        targetUserId: approval.requested_by_user_id,
      }),
    ],
  });

  await executeTransaction(txStatements);

  res.json({ success: true, id, status: 'approved' });
});

adminApprovalsRouter.post('/admin/approvals/:id/reject', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { decisionNote } = req.body;

  const requestRows = await runQuery<ApprovalRequestRow>(`SELECT * FROM approval_requests WHERE id = ?`, [id]);
  if (requestRows.length === 0) {
    res.status(404).json({ error: 'Approval request not found' });
    return;
  }

  const approval = requestRows[0];
  if (approval.status !== 'pending') {
    res.status(409).json({ error: 'Only pending requests can be rejected' });
    return;
  }

  await executeQuery(
    `UPDATE approval_requests SET status = ?, reviewed_by_user_id = ?, decision_note = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?`,
    ['rejected', user.userId, decisionNote || null, id, 'pending']
  );

  const latestRows = await runQuery<ApprovalRequestRow>(`SELECT * FROM approval_requests WHERE id = ?`, [id]);
  const latest = latestRows[0];
  if (!latest || latest.status !== 'rejected' || latest.reviewed_by_user_id !== user.userId) {
    res.status(409).json({ error: 'Request was already processed by another admin.' });
    return;
  }

  await executeTransaction([
    {
      sql: `INSERT INTO approval_audit_log (id, approval_request_id, actor_user_id, action, metadata_json) VALUES (?, ?, ?, ?, ?)`,
      params: [
        uuidv4(),
        id,
        user.userId,
        'reject',
        JSON.stringify({
          decisionNote: decisionNote || null,
          requestType: approval.request_type,
          targetUserId: approval.requested_by_user_id,
        }),
      ],
    },
  ]);

  res.json({ success: true, id, status: 'rejected' });
});

adminApprovalsRouter.delete('/admin/approvals/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;

  const requestRows = await runQuery<ApprovalRequestRow>(`SELECT * FROM approval_requests WHERE id = ?`, [id]);
  if (requestRows.length === 0) {
    res.status(404).json({ error: 'Approval request not found' });
    return;
  }

  const approval = requestRows[0];

  const txStatements: Array<{ sql: string; params: any[] }> = [];
  if (approval.request_type === 'role_elevation_admin' && approval.status === 'approved') {
    txStatements.push({
      sql: `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params: ['fieldman', approval.requested_by_user_id],
    });
  }

  txStatements.push({
    sql: `INSERT INTO approval_audit_log (id, approval_request_id, actor_user_id, action, metadata_json) VALUES (?, ?, ?, ?, ?)`,
    params: [
      uuidv4(),
      id,
      user.userId,
      'delete',
      JSON.stringify({
        requestType: approval.request_type,
        previousStatus: approval.status,
        targetUserId: approval.requested_by_user_id,
      }),
    ],
  });

  txStatements.push({
    sql: `DELETE FROM approval_requests WHERE id = ?`,
    params: [id],
  });

  await executeTransaction(txStatements);

  res.json({ success: true, id, deleted: true });
});

export default adminApprovalsRouter;
