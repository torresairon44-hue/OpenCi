import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { del as deleteBlob, put as putBlob } from '@vercel/blob';
import { runQuery, executeQuery, isDatabaseNotReadyError } from './database';
import {
  startSession,
  updateSessionInfo,
  stopSession,
  isSessionUserNotFoundError,
} from './session-service';

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const LARK_APP_ID = process.env.LARK_APP_ID || '';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || '';
const FIRST_ADMIN_OPEN_ID = process.env.FIRST_ADMIN_OPEN_ID || 'ou_d652030afb4a5cbe7d08f3cfdda685ad';
const FIRST_ADMIN_TENANT_KEY = process.env.FIRST_ADMIN_TENANT_KEY || '12f9cd33134f1759';
let JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET || JWT_SECRET === 'change-this-secret-in-production') {
  console.error('⚠ JWT_SECRET is missing or using a placeholder. Using an in-memory fallback secret for this runtime.');
  console.error('⚠ Set a strong JWT_SECRET in your deployment environment variables to avoid session invalidation on restart.');
  JWT_SECRET = randomBytes(32).toString('hex');
}
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PROFILE_UPLOAD_SUBDIR = path.join('uploads', 'profile');
const LARK_AVATAR_FETCH_TIMEOUT_MS = 8000;
const IS_PRODUCTION = (process.env.NODE_ENV || 'development') === 'production';
const AVATAR_STORAGE_BACKEND = String(process.env.AVATAR_STORAGE_BACKEND || 'auto').trim().toLowerCase();
const ALLOW_FILESYSTEM_AVATAR_STORAGE_IN_PRODUCTION = process.env.ALLOW_FILESYSTEM_AVATAR_STORAGE_IN_PRODUCTION === 'true';
const BLOB_STORAGE_HOST_SUFFIX = '.public.blob.vercel-storage.com';
const LARK_AVATAR_ALLOWED_HOST_SUFFIXES = String(process.env.LARK_AVATAR_ALLOWED_HOST_SUFFIXES || 'larksuite.com,feishu.cn,byteimg.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.length > 0);

export const authRouter = Router();

const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PROFILE_IMAGE_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!PROFILE_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Unsupported image type. Allowed types: PNG, JPEG, WEBP'));
      return;
    }
    cb(null, true);
  },
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Map Lark job_title → app role (admin | fieldman).
 * Returns 'unknown' if no match — caller should reject.
 */
function mapLarkJobTitleToRole(jobTitle: string): string {
  const t = (jobTitle || '').toLowerCase();
  if (t.includes('admin') || t.includes('administrator')) return 'admin';
  if (t.includes('field')) return 'fieldman';
  return 'unknown';
}

function isFirstAdminIdentity(larkId: string, tenantKey: string): boolean {
  return larkId === FIRST_ADMIN_OPEN_ID && tenantKey === FIRST_ADMIN_TENANT_KEY;
}

function issueJwt(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function normalizeUrlOrNull(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (raw.startsWith('/')) {
    return raw.slice(0, 512);
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString().slice(0, 512);
  } catch {
    return null;
  }
}

function pickLarkAvatarUrl(larkUser: any): string | null {
  const candidates = [
    larkUser?.avatar_big,
    larkUser?.avatar_url,
    larkUser?.avatar,
    larkUser?.avatar_thumb,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUrlOrNull(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function resolveAvatarSource(_customAvatarUrl: string | null, larkAvatarUrl: string | null): 'lark' | 'default' {
  if (larkAvatarUrl) return 'lark';
  return 'default';
}

function buildAvatarPayload(customAvatarUrl: string | null, larkAvatarUrl: string | null): {
  effectiveUrl: string | null;
  customUrl: string | null;
  larkUrl: string | null;
  source: 'lark' | 'default';
} {
  const custom = null;
  const lark = toTrustedLarkAvatarUrlOrNull(larkAvatarUrl);
  return {
    effectiveUrl: lark || null,
    customUrl: null,
    larkUrl: lark,
    source: resolveAvatarSource(custom, lark),
  };
}

function resolveProfileUploadDir(): string {
  return path.resolve(__dirname, '../public', PROFILE_UPLOAD_SUBDIR);
}

function getManagedProfileAvatarPrefix(): string {
  return `/${PROFILE_UPLOAD_SUBDIR.replace(/\\/g, '/')}/`;
}

type AvatarStorageBackend = 'blob' | 'filesystem';

function resolveAvatarStorageBackend(): AvatarStorageBackend {
  if (AVATAR_STORAGE_BACKEND === 'blob') {
    return 'blob';
  }
  if (AVATAR_STORAGE_BACKEND === 'filesystem') {
    return 'filesystem';
  }

  const hasBlobToken = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim().length > 0;
  return hasBlobToken ? 'blob' : 'filesystem';
}

function canUseFilesystemAvatarStorage(): boolean {
  if (!IS_PRODUCTION) return true;
  return ALLOW_FILESYSTEM_AVATAR_STORAGE_IN_PRODUCTION;
}

function isManagedBlobAvatarUrl(value: string | null | undefined): boolean {
  const normalized = normalizeUrlOrNull(value);
  if (!normalized || normalized.startsWith('/')) return false;
  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.endsWith(BLOB_STORAGE_HOST_SUFFIX)) {
      return false;
    }
    return parsed.pathname.includes('/avatars/');
  } catch {
    return false;
  }
}

function isManagedProfileAvatarPath(value: string | null | undefined): boolean {
  const normalized = normalizeUrlOrNull(value);
  if (!normalized) return false;
  if (normalized.startsWith('/')) {
    return normalized.startsWith(getManagedProfileAvatarPrefix());
  }
  return isManagedBlobAvatarUrl(normalized);
}

function toManagedAvatarUrlOrNull(value: unknown): string | null {
  const normalized = normalizeUrlOrNull(value);
  if (!normalized) return null;
  return isManagedProfileAvatarPath(normalized) ? normalized : null;
}

function toTrustedLarkAvatarUrlOrNull(value: unknown): string | null {
  const normalized = normalizeUrlOrNull(value);
  if (!normalized) return null;

  if (isManagedProfileAvatarPath(normalized)) {
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

  return isAllowedLarkAvatarHost(normalized) ? normalized : null;
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

function ensureProfileUploadDir(): string {
  const dir = resolveProfileUploadDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAvatarFileExtension(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function parseMimeType(value: unknown): string | null {
  const raw = Array.isArray(value) ? String(value[0] || '') : String(value || '');
  const normalized = raw.split(';')[0].trim().toLowerCase();
  return normalized || null;
}

function hasValidImageBufferSignature(buffer: Buffer, mimeType: string): boolean {
  if (!buffer || buffer.length < 12) return false;

  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }

  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8;
  }

  if (mimeType === 'image/webp') {
    return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  }

  return false;
}

function hasValidImageSignature(file: Express.Multer.File): boolean {
  return hasValidImageBufferSignature(file.buffer, file.mimetype);
}

function toPublicProfileAvatarPath(fileName: string): string {
  return `/${PROFILE_UPLOAD_SUBDIR.replace(/\\/g, '/')}/${fileName}`;
}

function buildAvatarObjectKey(userId: string, source: 'lark' | 'custom', fileExtension: string): string {
  const safeUserId = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `avatars/profile/${safeUserId}-${source}-${Date.now()}-${randomSuffix}.${fileExtension}`;
}

async function persistManagedAvatar(
  userId: string,
  source: 'lark' | 'custom',
  buffer: Buffer,
  mimeType: string
): Promise<string | null> {
  const fileExtension = getAvatarFileExtension(mimeType);
  const storageBackend = resolveAvatarStorageBackend();

  if (storageBackend === 'blob') {
    const hasBlobToken = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim().length > 0;
    if (!hasBlobToken) {
      throw new Error('BLOB_READ_WRITE_TOKEN is missing for Blob avatar storage.');
    }

    const blob = await putBlob(buildAvatarObjectKey(userId, source, fileExtension), buffer, {
      access: 'public',
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return normalizeUrlOrNull(blob.url);
  }

  if (!canUseFilesystemAvatarStorage()) {
    if (source === 'custom') {
      throw new Error('Filesystem avatar storage is disabled in production. Configure Blob storage.');
    }
    return null;
  }

  const fileName = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExtension}`;
  const uploadDir = ensureProfileUploadDir();
  const absolutePath = path.join(uploadDir, fileName);
  await fs.promises.writeFile(absolutePath, buffer);
  return toPublicProfileAvatarPath(fileName);
}

async function cacheLarkAvatarToManagedPath(userId: string, remoteUrl: string | null): Promise<string | null> {
  const normalizedRemoteUrl = normalizeUrlOrNull(remoteUrl);
  if (!normalizedRemoteUrl || normalizedRemoteUrl.startsWith('/')) {
    return null;
  }

  if (!isAllowedLarkAvatarHost(normalizedRemoteUrl)) {
    console.warn(`[AUTH AVATAR] Rejected Lark avatar host for user ${userId}`);
    return null;
  }

  try {
    const response = await axios.get<ArrayBuffer>(normalizedRemoteUrl, {
      responseType: 'arraybuffer',
      timeout: LARK_AVATAR_FETCH_TIMEOUT_MS,
      maxContentLength: PROFILE_IMAGE_MAX_BYTES,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const mimeType = parseMimeType(response.headers['content-type']);
    if (!mimeType || !PROFILE_IMAGE_MIME_TYPES.has(mimeType)) {
      return null;
    }

    const buffer = Buffer.from(response.data);
    if (!buffer.length || buffer.length > PROFILE_IMAGE_MAX_BYTES) {
      return null;
    }

    if (!hasValidImageBufferSignature(buffer, mimeType)) {
      return null;
    }

    return await persistManagedAvatar(userId, 'lark', buffer, mimeType);
  } catch {
    return null;
  }
}

async function deleteManagedProfileAvatarFile(avatarUrl: string | null | undefined): Promise<void> {
  const normalized = normalizeUrlOrNull(avatarUrl);
  if (!normalized) return;
  if (!isManagedProfileAvatarPath(normalized)) return;

  if (!normalized.startsWith('/')) {
    if (isManagedBlobAvatarUrl(normalized)) {
      try {
        await deleteBlob(normalized);
      } catch {
        // Ignore delete failures for already-removed Blob files.
      }
    }
    return;
  }

  const relativePath = normalized.slice(1);
  const absolutePath = path.resolve(__dirname, '../public', relativePath);
  try {
    await fs.promises.unlink(absolutePath);
  } catch {
    // Ignore delete failures for missing files.
  }
}

async function syncTokenRoleFromDatabase(res: Response, payload: any): Promise<any> {
  if (!payload?.userId) {
    return null;
  }

  try {
    const rows = await runQuery<{ id: string; username: string | null; email: string | null; role: string | null; lark_id: string | null; lark_avatar_url: string | null; custom_avatar_url: string | null }>(
      `SELECT id, username, email, role, lark_id, lark_avatar_url, custom_avatar_url FROM users WHERE id = ?`,
      [payload.userId]
    );

    let resolvedUser = rows[0] || null;
    let reboundByLarkId = false;

    if (!resolvedUser && payload.larkId) {
      const byLarkId = await runQuery<{ id: string; username: string | null; email: string | null; role: string | null; lark_id: string | null; lark_avatar_url: string | null; custom_avatar_url: string | null }>(
        `SELECT id, username, email, role, lark_id, lark_avatar_url, custom_avatar_url FROM users WHERE lark_id = ?`,
        [payload.larkId]
      );
      if (byLarkId.length > 0) {
        resolvedUser = byLarkId[0];
        reboundByLarkId = true;
      }
    }

    if (!resolvedUser) {
      res.clearCookie('auth_token');
      return null;
    }

    const dbRole = (resolvedUser.role || '').toLowerCase();
    if (!dbRole) {
      return null;
    }

    const refreshedPayload = {
      userId: resolvedUser.id,
      name: resolvedUser.username || payload.name || 'Unknown',
      email: resolvedUser.email || payload.email || null,
      role: dbRole,
      larkId: resolvedUser.lark_id || payload.larkId,
      larkAvatarUrl: toTrustedLarkAvatarUrlOrNull(resolvedUser.lark_avatar_url),
      customAvatarUrl: null,
      larkTenant: payload.larkTenant,
      sessionId: reboundByLarkId ? undefined : payload.sessionId,
    };

    const tokenUserId = String(payload.userId || '');
    const tokenRole = String(payload.role || '').toLowerCase();
    const tokenName = String(payload.name || '');
    const tokenEmail = payload.email || null;
    const tokenLarkId = payload.larkId || null;
    const tokenLarkAvatarUrl = normalizeUrlOrNull(payload.larkAvatarUrl);
    const tokenCustomAvatarUrl = normalizeUrlOrNull(payload.customAvatarUrl);
    const tokenSessionId = payload.sessionId || undefined;

    const shouldRefreshToken =
      tokenUserId !== refreshedPayload.userId ||
      tokenRole !== refreshedPayload.role ||
      tokenName !== refreshedPayload.name ||
      tokenEmail !== refreshedPayload.email ||
      tokenLarkId !== refreshedPayload.larkId ||
      tokenLarkAvatarUrl !== refreshedPayload.larkAvatarUrl ||
      tokenCustomAvatarUrl !== refreshedPayload.customAvatarUrl ||
      tokenSessionId !== refreshedPayload.sessionId;

    if (shouldRefreshToken) {
      const refreshedToken = issueJwt(refreshedPayload);
      setAuthCookie(res, refreshedToken);
    }

    return refreshedPayload;
  } catch {
    // Keep original payload when DB is temporarily unavailable.
    return payload;
  }
}

async function createSessionForPayloadOrRespond(res: Response, payload: any): Promise<string | null> {
  try {
    return await startSession(payload.userId);
  } catch (error) {
    if (isSessionUserNotFoundError(error)) {
      res.clearCookie('auth_token');
      res.status(401).json({ error: 'Session invalidated. Please login again.' });
      return null;
    }

    console.error('Session creation error:', error);
    res.status(500).json({ error: 'Failed to recover session' });
    return null;
  }
}

interface NormalizedSessionLocation {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  capturedAt: string;
  source: string;
}

interface NormalizedSessionDevice {
  platform: string;
  os: string;
  browser: string;
  model: string;
  userAgent: string;
}

function sanitizeDevicePart(value: string, fallback: string): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 48) : fallback;
}

function detectDeviceFromUserAgent(userAgentRaw: string | undefined | null): NormalizedSessionDevice | null {
  const userAgent = String(userAgentRaw || '').trim();
  if (!userAgent) return null;

  const ua = userAgent.toLowerCase();

  let os = 'Unknown OS';
  if (ua.includes('windows nt')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) os = 'iOS';
  else if (ua.includes('mac os x') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  let browser = 'Unknown Browser';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
  else if (ua.includes('chrome/') || ua.includes('crios/')) browser = 'Chrome';
  else if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('crios/')) browser = 'Safari';
  else if (ua.includes('firefox/') || ua.includes('fxios/')) browser = 'Firefox';

  let platform = 'Desktop';
  if (ua.includes('ipad') || ua.includes('tablet')) platform = 'Tablet';
  else if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('ipod') || ua.includes('android')) platform = 'Mobile';

  let model = '';
  if (ua.includes('iphone')) model = 'iPhone';
  else if (ua.includes('ipad')) model = 'iPad';
  else if (ua.includes('ipod')) model = 'iPod';
  else if (ua.includes('android')) {
    const match = userAgent.match(/Android\s+[\d.]+;\s*([^;\)]+)/i);
    model = match?.[1] ? match[1].trim() : '';
  }

  return {
    platform: sanitizeDevicePart(platform, 'Unknown Platform'),
    os: sanitizeDevicePart(os, 'Unknown OS'),
    browser: sanitizeDevicePart(browser, 'Unknown Browser'),
    model: sanitizeDevicePart(model, ''),
    userAgent: userAgent.slice(0, 220),
  };
}

function normalizeSessionDevice(rawDevice: any, fallbackUserAgent?: string): NormalizedSessionDevice | null {
  if (rawDevice && typeof rawDevice === 'object' && !Array.isArray(rawDevice)) {
    return {
      platform: sanitizeDevicePart(String(rawDevice.platform || rawDevice.deviceType || ''), 'Unknown Platform'),
      os: sanitizeDevicePart(String(rawDevice.os || rawDevice.operatingSystem || ''), 'Unknown OS'),
      browser: sanitizeDevicePart(String(rawDevice.browser || ''), 'Unknown Browser'),
      model: sanitizeDevicePart(String(rawDevice.model || ''), ''),
      userAgent: String(rawDevice.userAgent || fallbackUserAgent || '').slice(0, 220),
    };
  }

  if (typeof rawDevice === 'string' && rawDevice.trim()) {
    try {
      const parsed = JSON.parse(rawDevice);
      if (parsed && typeof parsed === 'object') {
        return normalizeSessionDevice(parsed, fallbackUserAgent);
      }
    } catch {
      return detectDeviceFromUserAgent(rawDevice);
    }
  }

  return detectDeviceFromUserAgent(fallbackUserAgent);
}

const MAX_USER_LOCATION_HISTORY = 10;
const MAX_REALISTIC_SPEED_MPS = 120; // ~432 km/h (fast airplane speed)
const LOCATION_HISTORY_RETENTION_MS = 30 * 60 * 1000; // 30 minutes
const WEAK_LOCATION_ACCURACY_THRESHOLD_METERS = 80;
const REJECT_LOCATION_ACCURACY_THRESHOLD_METERS = 300;
const WEAK_LOCATION_PROMOTION_DISTANCE_METERS = 150;
const WEAK_LOCATION_PROMOTION_LOOKBACK_MS = 10 * 60 * 1000;
const REJECTED_LOCATION_SOURCES = new Set(['ip-approx']);

interface UserLocationEventRow {
  id: string;
  lat: number | string;
  lng: number | string;
  captured_at: string | null;
  created_at: string | null;
}

function parseLocationEventTimestamp(row: UserLocationEventRow): number | null {
  const capturedMs = Date.parse(String(row.captured_at || ''));
  if (!Number.isNaN(capturedMs)) {
    return capturedMs;
  }

  const createdMs = Date.parse(String(row.created_at || ''));
  if (!Number.isNaN(createdMs)) {
    return createdMs;
  }

  return null;
}

async function getUserLocationHistory(userId: string): Promise<Array<{ id: string; lat: number; lng: number; timestamp: number }>> {
  const rows = await runQuery<UserLocationEventRow>(
    `SELECT id, lat, lng, captured_at, created_at FROM user_location_events WHERE user_id = ?`,
    [userId]
  );

  const events = rows
    .map((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      const timestamp = parseLocationEventTimestamp(row);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || timestamp === null) {
        return null;
      }
      return {
        id: String(row.id || ''),
        lat,
        lng,
        timestamp,
      };
    })
    .filter((row): row is { id: string; lat: number; lng: number; timestamp: number } => Boolean(row));

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Detect potential location spoofing by checking velocity against user's location history
 */
async function detectServerSideSpoofing(
  userId: string,
  newLat: number,
  newLng: number,
  capturedAtMs: number
): Promise<{ spoofed: boolean; reason: string | null; confidence: number }> {
  try {
    const history = await getUserLocationHistory(userId);

    if (history.length === 0) {
      return { spoofed: false, reason: null, confidence: 1.0 };
    }

    const lastEntry = history[history.length - 1];
    const distance = calculateDistanceMeters(lastEntry.lat, lastEntry.lng, newLat, newLng);
    const timeDiff = (capturedAtMs - lastEntry.timestamp) / 1000; // seconds

    if (timeDiff <= 0) {
      return { spoofed: false, reason: null, confidence: 1.0 };
    }

    const speed = distance / timeDiff; // meters per second

    // If moving faster than physically possible (teleportation) over a significant distance
    if (speed > MAX_REALISTIC_SPEED_MPS && distance > 1000) {
      const speedKmh = Math.round(speed * 3.6);
      console.warn(`[LOCATION SPOOF] User ${userId}: Unrealistic movement ${Math.round(distance)}m in ${Math.round(timeDiff)}s = ${speedKmh} km/h`);
      return {
        spoofed: true,
        reason: `Unrealistic movement: ${speedKmh} km/h over ${Math.round(distance)}m`,
        confidence: Math.max(0.1, 1 - (speed / (MAX_REALISTIC_SPEED_MPS * 5))),
      };
    }

    // Reduce confidence for high speeds (but still possible)
    if (speed > MAX_REALISTIC_SPEED_MPS * 0.5) {
      return {
        spoofed: false,
        reason: null,
        confidence: Math.max(0.5, 1 - (speed / (MAX_REALISTIC_SPEED_MPS * 2))),
      };
    }

    return { spoofed: false, reason: null, confidence: 1.0 };
  } catch (error) {
    console.error(`[LOCATION WARNING] Failed spoof check for user ${userId}:`, error);
    return { spoofed: false, reason: null, confidence: 1.0 };
  }
}

/**
 * Add location to user's server-side history
 */
async function addToUserLocationHistory(userId: string, lat: number, lng: number, capturedAtMs: number): Promise<void> {
  try {
    const capturedAtIso = new Date(capturedAtMs).toISOString();
    const createdAtIso = new Date().toISOString();

    await executeQuery(
      `INSERT INTO user_location_events (id, user_id, lat, lng, captured_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, lat, lng, capturedAtIso, createdAtIso]
    );

    const cutoffIso = new Date(capturedAtMs - LOCATION_HISTORY_RETENTION_MS).toISOString();
    await executeQuery(
      `DELETE FROM user_location_events WHERE user_id = ? AND captured_at < ?`,
      [userId, cutoffIso]
    );

    const history = await getUserLocationHistory(userId);
    if (history.length > MAX_USER_LOCATION_HISTORY) {
      const staleEntries = history.slice(0, history.length - MAX_USER_LOCATION_HISTORY);
      for (const staleEntry of staleEntries) {
        await executeQuery(`DELETE FROM user_location_events WHERE id = ?`, [staleEntry.id]);
      }
    }
  } catch (error) {
    console.error(`[LOCATION WARNING] Failed storing location history for user ${userId}:`, error);
  }
}

interface NormalizedSessionLocationExtended extends NormalizedSessionLocation {
  spoofingDetected?: boolean;
  spoofingReason?: string | null;
  confidence?: number;
}

function parseStoredSessionLocation(rawLocation: string | null | undefined): NormalizedSessionLocationExtended | null {
  if (!rawLocation || typeof rawLocation !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(rawLocation);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const latValue = Number((parsed as any).lat ?? (parsed as any).latitude);
    const lngValue = Number((parsed as any).lng ?? (parsed as any).longitude);
    if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) {
      return null;
    }

    if (latValue < -90 || latValue > 90 || lngValue < -180 || lngValue > 180) {
      return null;
    }

    const rawAccuracy = (parsed as any).accuracyMeters ?? (parsed as any).accuracy;
    const parsedAccuracy = Number(rawAccuracy);
    const accuracyMeters = Number.isFinite(parsedAccuracy) && parsedAccuracy >= 0 && parsedAccuracy <= 5000
      ? Number(parsedAccuracy.toFixed(1))
      : null;

    const capturedAtRaw = String((parsed as any).capturedAt || '');
    const capturedAtMs = Date.parse(capturedAtRaw);
    const capturedAt = Number.isNaN(capturedAtMs)
      ? new Date().toISOString()
      : new Date(capturedAtMs).toISOString();

    const source = typeof (parsed as any).source === 'string' && (parsed as any).source.trim().length > 0
      ? (parsed as any).source.trim().toLowerCase().slice(0, 48)
      : 'browser-gps';

    const spoofingDetected = typeof (parsed as any).spoofingDetected === 'boolean'
      ? Boolean((parsed as any).spoofingDetected)
      : false;
    const spoofingReason = typeof (parsed as any).spoofingReason === 'string'
      ? (parsed as any).spoofingReason.slice(0, 220)
      : null;
    const confidenceRaw = Number((parsed as any).confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 1;

    return {
      lat: Number(latValue.toFixed(6)),
      lng: Number(lngValue.toFixed(6)),
      accuracyMeters,
      capturedAt,
      source,
      spoofingDetected,
      spoofingReason,
      confidence,
    };
  } catch {
    return null;
  }
}

function isReliableSessionLocationSample(location: NormalizedSessionLocationExtended | null | undefined): boolean {
  if (!location) return false;
  if (REJECTED_LOCATION_SOURCES.has(String(location.source || '').toLowerCase())) return false;
  if (!Number.isFinite(location.accuracyMeters as number)) return false;
  return Number(location.accuracyMeters) <= WEAK_LOCATION_ACCURACY_THRESHOLD_METERS;
}

async function hasConsistentWeakLocationCluster(
  userId: string,
  lat: number,
  lng: number,
  capturedAtMs: number
): Promise<boolean> {
  try {
    const history = await getUserLocationHistory(userId);
    let nearPointCount = 0;

    for (let i = history.length - 1; i >= 0; i -= 1) {
      const entry = history[i];
      const ageMs = capturedAtMs - entry.timestamp;
      if (ageMs < 0) continue;
      if (ageMs > WEAK_LOCATION_PROMOTION_LOOKBACK_MS) {
        break;
      }

      const distanceMeters = calculateDistanceMeters(entry.lat, entry.lng, lat, lng);
      if (distanceMeters <= WEAK_LOCATION_PROMOTION_DISTANCE_METERS) {
        nearPointCount += 1;
      }

      if (nearPointCount >= 1) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

async function normalizeSessionLocation(
  rawLocation: any,
  options?: { userId?: string; previousLocation?: NormalizedSessionLocationExtended | null }
): Promise<{ value?: NormalizedSessionLocationExtended; error?: string; ignoredReason?: string }> {
  if (rawLocation === undefined || rawLocation === null) {
    return {};
  }

  if (typeof rawLocation !== 'object' || Array.isArray(rawLocation)) {
    return { error: 'Location payload must be an object.' };
  }

  const latValue = Number(rawLocation.lat ?? rawLocation.latitude);
  const lngValue = Number(rawLocation.lng ?? rawLocation.longitude);
  if (!Number.isFinite(latValue) || latValue < -90 || latValue > 90) {
    return { error: 'Location latitude must be a valid number between -90 and 90.' };
  }

  if (!Number.isFinite(lngValue) || lngValue < -180 || lngValue > 180) {
    return { error: 'Location longitude must be a valid number between -180 and 180.' };
  }

  const rawAccuracy = rawLocation.accuracyMeters ?? rawLocation.accuracy;
  let accuracyMeters: number | null = null;
  if (rawAccuracy !== undefined && rawAccuracy !== null && String(rawAccuracy).trim() !== '') {
    const parsedAccuracy = Number(rawAccuracy);
    if (!Number.isFinite(parsedAccuracy) || parsedAccuracy < 0 || parsedAccuracy > 5000) {
      return { error: 'Location accuracy must be between 0 and 5000 meters.' };
    }
    accuracyMeters = Number(parsedAccuracy.toFixed(1));
  }

  let capturedAt = new Date().toISOString();
  if (rawLocation.capturedAt !== undefined && rawLocation.capturedAt !== null) {
    const parsedDate = new Date(String(rawLocation.capturedAt));
    if (Number.isNaN(parsedDate.getTime())) {
      return { error: 'Location capturedAt must be a valid ISO datetime.' };
    }
    capturedAt = parsedDate.toISOString();
  }

  const source = typeof rawLocation.source === 'string' && rawLocation.source.trim().length > 0
    ? rawLocation.source.trim().toLowerCase().slice(0, 48)
    : 'browser-gps';
  const capturedAtMs = Date.parse(capturedAt);
  const userId = options?.userId;
  const previousLocation = options?.previousLocation || null;

  // Server-side spoof detection
  let spoofingDetected = Boolean(rawLocation.spoofingDetected);
  let spoofingReason = rawLocation.spoofingReason || null;
  let confidence = 1.0;

  if (REJECTED_LOCATION_SOURCES.has(source)) {
    if (previousLocation) {
      return {
        value: previousLocation,
        ignoredReason: `Rejected low-trust source: ${source}`,
      };
    }
    return {
      ignoredReason: `Rejected low-trust source: ${source}`,
    };
  }

  const incomingAccuracy = Number(accuracyMeters);
  const hasIncomingAccuracy = Number.isFinite(incomingAccuracy);
  if (!hasIncomingAccuracy) {
    if (previousLocation) {
      return {
        value: previousLocation,
        ignoredReason: 'Preserved previous location due to missing accuracy metadata.',
      };
    }
    return {
      ignoredReason: 'Ignored location sample without accuracy metadata.',
    };
  }

  if (incomingAccuracy > REJECT_LOCATION_ACCURACY_THRESHOLD_METERS) {
    if (previousLocation) {
      return {
        value: previousLocation,
        ignoredReason: `Preserved previous location due to very low accuracy (${Math.round(incomingAccuracy)}m).`,
      };
    }
    return {
      ignoredReason: `Ignored very low-accuracy location sample (${Math.round(incomingAccuracy)}m).`,
    };
  }

  if (userId) {
    const serverSpoofCheck = await detectServerSideSpoofing(userId, latValue, lngValue, capturedAtMs);
    if (serverSpoofCheck.spoofed) {
      spoofingDetected = true;
      spoofingReason = serverSpoofCheck.reason;
    }
    confidence = serverSpoofCheck.confidence;

    // Add to history for future checks
    await addToUserLocationHistory(userId, latValue, lngValue, capturedAtMs);
  }

  if (previousLocation && isReliableSessionLocationSample(previousLocation)) {
    const distanceFromPrevious = calculateDistanceMeters(previousLocation.lat, previousLocation.lng, latValue, lngValue);

    if (spoofingDetected) {
      return {
        value: previousLocation,
        ignoredReason: 'Preserved previous reliable location due to spoofing signal.',
      };
    }

    if (hasIncomingAccuracy && incomingAccuracy > REJECT_LOCATION_ACCURACY_THRESHOLD_METERS) {
      return {
        value: previousLocation,
        ignoredReason: `Preserved previous reliable location due to very low accuracy (${Math.round(incomingAccuracy)}m).`,
      };
    }

    if (hasIncomingAccuracy && incomingAccuracy > WEAK_LOCATION_ACCURACY_THRESHOLD_METERS) {
      const hasConsistency = userId
        ? await hasConsistentWeakLocationCluster(userId, latValue, lngValue, capturedAtMs)
        : false;
      const canPromoteWeakSample = distanceFromPrevious <= WEAK_LOCATION_PROMOTION_DISTANCE_METERS || hasConsistency;

      if (!canPromoteWeakSample) {
        return {
          value: previousLocation,
          ignoredReason: `Preserved previous reliable location while waiting for consistent weak-signal fixes (${Math.round(incomingAccuracy)}m).`,
        };
      }

      confidence = Math.min(confidence, 0.72);
    }
  }

  return {
    value: {
      lat: Number(latValue.toFixed(6)),
      lng: Number(lngValue.toFixed(6)),
      accuracyMeters,
      capturedAt,
      source,
      spoofingDetected,
      spoofingReason,
      confidence,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// GET /api/auth/lark — Redirect user to Lark OAuth consent page
// ─────────────────────────────────────────────────────────────
authRouter.get('/lark', (req: Request, res: Response) => {
  if (!LARK_APP_ID) {
    res.status(503).json({ error: 'Lark authentication is not configured. Set LARK_APP_ID in .env' });
    return;
  }
  // Prefer forwarded headers so callback host is correct behind tunnels/reverse proxies.
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  const originHeader = req.get('origin') || '';
  const refererHeader = req.get('referer') || '';

  const parseHeaderUrl = (value: string): { protocol: string; host: string } | null => {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      return {
        protocol: parsed.protocol.replace(':', ''),
        host: parsed.host,
      };
    } catch {
      return null;
    }
  };

  const originData = parseHeaderUrl(originHeader);
  const refererData = parseHeaderUrl(refererHeader);
  const protocol = forwardedProto || originData?.protocol || refererData?.protocol || req.protocol;
  const host = forwardedHost || originData?.host || refererData?.host || req.get('host');
  const callbackUrl = `${protocol}://${host}/api/auth/lark/callback`;
  const redirectUri = encodeURIComponent(callbackUrl);
  const scope = 'contact:user.base:readonly';
  const larkAuthUrl =
    `https://open.larksuite.com/open-apis/authen/v1/authorize` +
    `?app_id=${LARK_APP_ID}&redirect_uri=${redirectUri}&scope=${scope}`;
  res.redirect(larkAuthUrl);
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/lark/callback — Handle Lark OAuth callback
// ─────────────────────────────────────────────────────────────
authRouter.get('/lark/callback', async (req: Request, res: Response) => {
  const code = req.query.code;
  if (!code || typeof code !== 'string') {
    res.redirect('/?error=auth_failed');
    return;
  }

  try {
    // Step 1: Get app access token
    const appTokenRes = await axios.post(
      'https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal',
      { app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const appAccessToken: string = appTokenRes.data.app_access_token;
    if (!appAccessToken) {
      res.redirect('/?error=auth_failed');
      return;
    }

    // Step 2: Exchange authorization code for user access token
    const userTokenRes = await axios.post(
      'https://open.larksuite.com/open-apis/authen/v1/oidc/access_token',
      { grant_type: 'authorization_code', code },
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const userAccessToken: string = userTokenRes.data.data?.access_token;
    if (!userAccessToken) {
      res.redirect('/?error=auth_failed');
      return;
    }

    // Step 3: Fetch user profile from Lark
    const userInfoRes = await axios.get(
      'https://open.larksuite.com/open-apis/authen/v1/user_info',
      { headers: { Authorization: `Bearer ${userAccessToken}` } }
    );
    const larkUser = userInfoRes.data.data;
    if (!larkUser || !larkUser.open_id) {
      res.redirect('/?error=auth_failed');
      return;
    }

      // Log only minimal, non-sensitive auth audit info.
      console.log('Lark login success:', {
        openId: larkUser.open_id,
        name: larkUser.name || larkUser.en_name || 'Unknown',
        tenant: larkUser.tenant_key || 'Unknown',
      });

    const larkId: string = larkUser.open_id;
    const name: string = larkUser.name || larkUser.en_name || 'Unknown';
    const email: string | null = larkUser.email || null;
    const larkAvatarUrl: string | null = pickLarkAvatarUrl(larkUser);
    const tenantKey: string = larkUser.tenant_key || '';
    const firstAdminIdentity = isFirstAdminIdentity(larkId, tenantKey);

    // Step 4: Upsert user in database
    const existing = await runQuery<{ id: string; role: string | null; lark_avatar_url: string | null }>(
      `SELECT id, role, lark_avatar_url FROM users WHERE lark_id = ?`,
      [larkId]
    );

    let userId: string;
    let role: string;
    const previousStoredLarkAvatarUrl = existing.length > 0 ? normalizeUrlOrNull(existing[0].lark_avatar_url) : null;
    const previousTrustedLarkAvatarUrl = toTrustedLarkAvatarUrlOrNull(previousStoredLarkAvatarUrl);
    const previousManagedLarkAvatarUrl = isManagedProfileAvatarPath(previousStoredLarkAvatarUrl)
      ? previousStoredLarkAvatarUrl
      : null;

    if (existing.length > 0) {
      userId = existing[0].id;
      role = existing[0].role || 'unknown'; // Keep existing role
    } else {
      userId = uuidv4();
      role = firstAdminIdentity ? 'admin' : 'fieldman';
    }

    const managedLarkAvatarUrl = await cacheLarkAvatarToManagedPath(userId, larkAvatarUrl);
    const effectiveLarkAvatarUrl = toTrustedLarkAvatarUrlOrNull(
      managedLarkAvatarUrl || larkAvatarUrl || previousTrustedLarkAvatarUrl || null
    );

    if (existing.length > 0) {
      if (firstAdminIdentity && role !== 'admin') {
        role = 'admin';
        await executeQuery(
          `UPDATE users SET username = ?, email = ?, role = ?, lark_avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [name, email, role, effectiveLarkAvatarUrl, userId]
        );
      } else if (!firstAdminIdentity && role === 'unknown') {
        role = 'fieldman';
        await executeQuery(
          `UPDATE users SET username = ?, email = ?, role = ?, lark_avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [name, email, role, effectiveLarkAvatarUrl, userId]
        );
      } else {
        await executeQuery(
          `UPDATE users SET username = ?, email = ?, lark_avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [name, email, effectiveLarkAvatarUrl, userId]
        );
      }
    } else {
      await executeQuery(
        `INSERT INTO users (id, username, email, role, lark_id, lark_avatar_url) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, name, email, role, larkId, effectiveLarkAvatarUrl]
      );
    }

    if (managedLarkAvatarUrl && previousManagedLarkAvatarUrl && previousManagedLarkAvatarUrl !== managedLarkAvatarUrl) {
      await deleteManagedProfileAvatarFile(previousManagedLarkAvatarUrl);
    }

    // Step 5: Issue JWT and set as httpOnly cookie
    // Also start a tracking session
    const sessionId = await startSession(userId);
    const loginDevice = normalizeSessionDevice(null, req.get('user-agent') || '');
    if (loginDevice) {
      await updateSessionInfo(sessionId, { device: JSON.stringify(loginDevice) });
    }
    const token = issueJwt({ userId, name, email, role, larkId, larkTenant: tenantKey, larkAvatarUrl: effectiveLarkAvatarUrl, customAvatarUrl: null, sessionId });
    setAuthCookie(res, token);
    res.redirect('/');
  } catch (error) {
    console.error('Lark OAuth callback error:', error);
    res.redirect('/?error=auth_failed');
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me — Return current user info from JWT cookie
// ─────────────────────────────────────────────────────────────
authRouter.get('/me', async (req: Request, res: Response) => {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    res.json({ loggedIn: false });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const payload = await syncTokenRoleFromDatabase(res, decoded);
    if (!payload) {
      res.json({ loggedIn: false });
      return;
    }
    const canSelectAdmin = isFirstAdminIdentity(payload.larkId || '', payload.larkTenant || '');
    res.json({
      loggedIn: true,
      userId: payload.userId,
      name: payload.name,
      role: payload.role,
      email: payload.email,
      sessionId: payload.sessionId,
      avatar: buildAvatarPayload(payload.customAvatarUrl, payload.larkAvatarUrl),
      canSelectAdmin,
    });
  } catch {
    res.json({ loggedIn: false });
  }
});

authRouter.post('/profile/photo', requireAuth, (_req: Request, res: Response) => {
  res.status(403).json({ error: 'Custom profile photos are disabled. Lark profile photo is required.' });
});

authRouter.delete('/profile/photo', requireAuth, (_req: Request, res: Response) => {
  res.status(403).json({ error: 'Custom profile photos are disabled. Lark profile photo is required.' });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/logout — Clear JWT cookie
// ─────────────────────────────────────────────────────────────
authRouter.post('/logout', async (req: Request, res: Response) => {
  const token = (req as any).cookies?.auth_token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      if (payload?.sessionId) {
        await stopSession(payload.sessionId);
      }
    } catch {
      // Ignore invalid token on logout and continue cookie clear.
    }
  }
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/set-role — Set role after first Lark login
// Only allows 'admin' or 'fieldman'. Reissues JWT with new role.
// ─────────────────────────────────────────────────────────────
authRouter.post('/set-role', async (req: Request, res: Response) => {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }

  payload = await syncTokenRoleFromDatabase(res, payload);
  if (!payload) {
    res.status(401).json({ error: 'Session invalidated. Please login again.' });
    return;
  }

  const { role } = req.body;
  if (role !== 'admin' && role !== 'fieldman') {
    res.status(400).json({ error: 'Role must be admin or fieldman' });
    return;
  }

  if (role === 'admin' && !isFirstAdminIdentity(payload.larkId || '', payload.larkTenant || '')) {
    res.status(403).json({ error: 'Admin role is restricted to authorized identities' });
    return;
  }

  try {
    await executeQuery(
      `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [role, payload.userId]
    );

    let sessionId = payload.sessionId;
    if (!sessionId) {
      const recoveredSessionId = await createSessionForPayloadOrRespond(res, payload);
      if (!recoveredSessionId) {
        return;
      }
      sessionId = recoveredSessionId;
    }

    const newToken = issueJwt({
      userId: payload.userId,
      name: payload.name,
      email: payload.email,
      role,
      larkId: payload.larkId,
      larkTenant: payload.larkTenant,
      larkAvatarUrl: payload.larkAvatarUrl,
      customAvatarUrl: payload.customAvatarUrl,
      sessionId,
    });
    setAuthCookie(res, newToken);
    res.json({ success: true, role });
  } catch (error) {
    console.error('Set role error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─────────────────────────────────────────────────────────────
// Session Tracking Endpoints
// ─────────────────────────────────────────────────────────────

authRouter.post('/session/update', async (req: Request, res: Response) => {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }

  payload = await syncTokenRoleFromDatabase(res, payload);
  if (!payload) {
    res.status(401).json({ error: 'Session invalidated. Please login again.' });
    return;
  }

  if (!payload.sessionId) {
    const recoveredSessionId = await createSessionForPayloadOrRespond(res, payload);
    if (!recoveredSessionId) {
      return;
    }

    const refreshedToken = issueJwt({
      userId: payload.userId,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      larkId: payload.larkId,
      larkTenant: payload.larkTenant,
      larkAvatarUrl: payload.larkAvatarUrl,
      customAvatarUrl: payload.customAvatarUrl,
      sessionId: recoveredSessionId,
    });
    setAuthCookie(res, refreshedToken);
    payload.sessionId = recoveredSessionId;
  }

  try {
    const existingSessionRows = await runQuery<{ stop_time: string | null; location: string | null }>(
      `SELECT stop_time, location FROM user_sessions WHERE session_id = ?`,
      [payload.sessionId]
    );

    const currentSessionStopped = existingSessionRows.length > 0 && Boolean(existingSessionRows[0].stop_time);
    const currentSessionMissing = existingSessionRows.length === 0;
    let previousSessionLocation = !currentSessionMissing && !currentSessionStopped
      ? parseStoredSessionLocation(existingSessionRows[0].location)
      : null;

    if (currentSessionMissing || currentSessionStopped) {
      const renewedSessionId = await createSessionForPayloadOrRespond(res, payload);
      if (!renewedSessionId) {
        return;
      }

      const renewedToken = issueJwt({
        userId: payload.userId,
        name: payload.name,
        email: payload.email,
        role: payload.role,
        larkId: payload.larkId,
        larkTenant: payload.larkTenant,
        larkAvatarUrl: payload.larkAvatarUrl,
        customAvatarUrl: payload.customAvatarUrl,
        sessionId: renewedSessionId,
      });
      setAuthCookie(res, renewedToken);
      payload.sessionId = renewedSessionId;
      previousSessionLocation = null;
    }

    const { location, battery, device, resetLocation } = req.body;

    if (resetLocation === true) {
      await executeQuery(
        `UPDATE user_sessions SET location = NULL, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`,
        [payload.sessionId]
      );
      await executeQuery(
        `DELETE FROM user_location_events WHERE user_id = ?`,
        [payload.userId]
      );
      previousSessionLocation = null;
    }

    const normalizedLocation = await normalizeSessionLocation(location, {
      userId: payload.userId,
      previousLocation: previousSessionLocation,
    });
    if (normalizedLocation.error) {
      res.status(400).json({ error: normalizedLocation.error });
      return;
    }

    if (normalizedLocation.ignoredReason) {
      console.log(`[LOCATION INFO] User ${payload.userId} (${payload.name}): ${normalizedLocation.ignoredReason}`);
    }
    
    // Log spoofing detection for monitoring
    if (normalizedLocation.value?.spoofingDetected) {
      console.warn(`[LOCATION WARNING] User ${payload.userId} (${payload.name}): ${normalizedLocation.value.spoofingReason || 'Spoofing detected'}`);
    }
    
    const normalizedDevice = normalizeSessionDevice(device, req.get('user-agent') || '');

    await updateSessionInfo(payload.sessionId, {
      location: normalizedLocation.value ? JSON.stringify(normalizedLocation.value) : undefined,
      battery: battery ? String(battery) : undefined,
      device: normalizedDevice ? JSON.stringify(normalizedDevice) : undefined,
    });
    res.json({ success: true });
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      res.status(503).json({ error: 'Service warming up. Please retry in a few seconds.' });
      return;
    }

    console.error('Session update error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

authRouter.post('/session/stop', async (req: Request, res: Response) => {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }

  payload = await syncTokenRoleFromDatabase(res, payload);
  if (!payload) {
    res.status(401).json({ error: 'Session invalidated. Please login again.' });
    return;
  }

  if (!payload.sessionId) {
    res.status(400).json({ error: 'No active session' });
    return;
  }

  try {
    await stopSession(payload.sessionId);
    res.json({ success: true });
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      res.status(503).json({ error: 'Service warming up. Please retry in a few seconds.' });
      return;
    }

    console.error('Session stop error:', error);
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

// ─────────────────────────────────────────────────────────────
// Middleware: optionalAuth
// Attaches req.user if a valid JWT cookie is present; otherwise no-op.
// ─────────────────────────────────────────────────────────────
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    next();
    return;
  }

  jwt.verify(token, JWT_SECRET, async (err: jwt.VerifyErrors | null, decoded: string | jwt.JwtPayload | undefined) => {
    if (err || !decoded) {
      next();
      return;
    }

    const syncedPayload = await syncTokenRoleFromDatabase(_res, decoded as any);
    if (!syncedPayload) {
      next();
      return;
    }
    (req as any).user = syncedPayload;
    next();
  });
}

// ─────────────────────────────────────────────────────────────
// Middleware: requireAuth
// Rejects unauthenticated requests with 401.
// ─────────────────────────────────────────────────────────────
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const syncedPayload = await syncTokenRoleFromDatabase(res, decoded);
    if (!syncedPayload) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
    (req as any).user = syncedPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = ((req as any).user?.role || '').toLowerCase();
  if (role !== 'admin') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  next();
}
