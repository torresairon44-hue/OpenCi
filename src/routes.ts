import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { body, param, validationResult } from 'express-validator';
import xss from 'xss';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { createWorker } from 'tesseract.js';
import { runQuery, executeQuery } from './database';
import { generateAIResponse, extractProblemTitle, UserProfile, ImageAttachment, AIProviderLimitError, getAIRoutingMetrics } from './ai-service';
import { getCoordinates, getLocationFromCoordinates, formatCoordinates } from './location-service';
import { requireAuth } from './auth';
import { chatRateLimiter, resetRateLimit } from './rate-limiter';
import { queryChatbotLocationByName, getChatbotLocationScraperStatus } from './chatbot-location-scraper';
import { getUserLocationByName, formatLocationResponse } from './user-location-service';
import { evaluateCanaryPolicy } from './deployment-policy';
import { decideAgenticRoute } from './agentic-router';

// Sanitization helper
const sanitizeInput = (input: string): string => {
  return xss(input.trim(), {
    whiteList: {}, // Remove all HTML tags
    stripIgnoreTag: true,
  });
};

// Validation middleware
const handleValidationErrors = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  return next();
};

export const chatRouter = Router();

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_IMAGE_FILES = 3;
const OCR_TIMEOUT_MS = 10_000;
const OCR_MAX_CHARS_PER_IMAGE = 2_500;
const OCR_MAX_TOTAL_CHARS = 6_000;
const OCR_CONCURRENCY = 2;
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

interface LocationQueryIntent {
  personName: string;
  asksAddress: boolean;
  requestedRole: 'admin' | 'fieldman' | 'unknown';
}

function detectRequestedRoleFromText(text: string): 'admin' | 'fieldman' | 'unknown' {
  const lower = String(text || '').toLowerCase();
  if (/\badmin\b/i.test(lower)) {
    return 'admin';
  }
  if (/\bfield\s*man\b|\bfieldman\b|\bfield\s*agent\b/i.test(lower)) {
    return 'fieldman';
  }
  return 'unknown';
}

function cleanCandidatePersonName(value: string): string {
  return String(value || '')
    .replace(/[?!.:,;'"/\\|]+/g, ' ')
    .replace(/\b(where|is|the|of|si|ni|ang|kay|location|coordinates?|coord|address|exact|current|po|please|what|whats|what's|admin|field\s*man|fieldman|field\s*agent|niya|nya|his|her|for|ako|ikaw|ka|my|me|mine|sarili)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function containsLocationKeyword(message: string): boolean {
  const raw = String(message || '').trim();
  if (!raw) return false;
  if (/\b(where\s+is|nasaan|asan|saan\s+si|saan\s+banda\s+si|location|lokasyon|coordinates?|coord|address|tirahan|nakatira)\b/i.test(raw)) {
    return true;
  }

  // Support casual self-reference phrases like "ako di mo alam" after location-related context.
  return /\b(ako|ko|akin|my|me|mine)\b/i.test(raw) && /\b(alam|where|nasaan|asan|location|address)\b/i.test(raw);
}

function detectLocationQueryIntent(message: string): LocationQueryIntent | null {
  const raw = String(message || '').trim();
  if (!raw) return null;

  const asksAddress = /\b(address|tirahan|location address)\b/i.test(raw);
  const looksLikeLocationQuestion =
    /\b(where\s+is|where\s+exactly|nasaan|asan|location\s+of|location\s+for|lokasyon\s+ni|lokasyon\s+ng|coordinates?\s+of|coordinates?\s+ni|coordinates?\s+for|coord\s+ni|address\s+of|address\s+for|address\s+ni|tirahan\s+ni|saan\s+nakatira\s+si|saan\s+si|ano\s+ang\s+(?:address|coordinates?|lokasyon))\b/i.test(raw)
    || /['’]s\s+address\b/i.test(raw);

  if (!looksLikeLocationQuestion) {
    return null;
  }

  const requestedRole = detectRequestedRoleFromText(raw);

  const quotedMatch = raw.match(/["']([^"']{2,120})["']/);
  if (quotedMatch && quotedMatch[1]) {
    const cleanedQuoted = cleanCandidatePersonName(quotedMatch[1]);
    if (cleanedQuoted.length >= 2) {
      return { personName: cleanedQuoted, asksAddress, requestedRole };
    }
  }

  const patterns = [
    /(?:where\s+is|where\s+exactly\s+is|nasaan|asan)\s+(.+)/i,
    /(?:saan\s+si|saan\s+banda\s+si)\s+(.+)/i,
    /(?:location|coordinates?|address)\s+of\s+(.+)/i,
    /(?:location|coordinates?|address)\s+for\s+(.+)/i,
    /(?:lokasyon|coordinates?|coord|address|tirahan)\s+ni\s+(.+)/i,
    /(?:lokasyon|coordinates?|coord|address|tirahan)\s+ng\s+(.+)/i,
    /(?:ano\s+ang\s+(?:address|coordinates?|lokasyon)\s+ni)\s+(.+)/i,
    /(?:address|tirahan)\s+ni\s+(.+)/i,
    /saan\s+nakatira\s+si\s+(.+)/i,
    /(?:what\s+is\s+)?(.+?)['’]s\s+address/i,
    /name\s+of\s+(?:the\s+)?(?:field\s*man|fieldman|admin)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match || !match[1]) continue;

    const cleaned = cleanCandidatePersonName(match[1]);
    if (cleaned.length >= 2) {
      return { personName: cleaned, asksAddress, requestedRole };
    }
  }

  return null;
}

function detectLocationFollowUpIntent(
  message: string,
  history: Array<{ role?: string; content?: string }>
): LocationQueryIntent | null {
  const raw = String(message || '').trim();
  if (!raw) return null;

  const asksAddress = /\b(address|tirahan)\b/i.test(raw);
  const asksCoordinates = /\b(location|coordinates?|coord|lokasyon)\b/i.test(raw);
  const hasPronoun = /\b(niya|nya|his|her|siya|ito|yun|yan)\b/i.test(raw);
  const looksLikeFollowUp = (asksAddress || asksCoordinates) && hasPronoun;

  if (!looksLikeFollowUp) {
    return null;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (String(item?.role || '').toLowerCase() !== 'user') continue;

    const previousIntent = detectLocationQueryIntent(String(item?.content || ''));
    if (!previousIntent) continue;

    return {
      personName: previousIntent.personName,
      asksAddress,
      requestedRole: detectRequestedRoleFromText(raw) !== 'unknown'
        ? detectRequestedRoleFromText(raw)
        : previousIntent.requestedRole,
    };
  }

  return null;
}

function getMostRecentLocationIntentFromHistory(
  history: Array<{ role?: string; content?: string }>
): LocationQueryIntent | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (String(item?.role || '').toLowerCase() !== 'user') continue;
    const previousIntent = detectLocationQueryIntent(String(item?.content || ''));
    if (previousIntent) {
      return previousIntent;
    }
  }
  return null;
}

const LOCATION_TOKEN_STOP_WORDS = new Set([
  'where', 'is', 'whereis', 'nasaan', 'asan', 'saan', 'banda', 'location', 'lokasyon', 'coordinates', 'coordinate', 'coord',
  'address', 'tirahan', 'for', 'of', 'ni', 'ng', 'si', 'ang', 'ko', 'akin', 'my', 'me', 'mine', 'alam', 'mo', 'kung',
  'ano', 'what', 'whats', 'whats', 'exactly', 'please', 'po', 'ba', 'nya', 'niya', 'his', 'her', 'siya', 'admin', 'fieldman',
  'know', 'u', 'you', 'your', 'ako', 'ikaw', 'ka',
]);

function inferExplicitLocationTarget(
  message: string,
  isAnonymous: boolean
): { personName: string; requestedRole: 'admin' | 'fieldman' | 'unknown'; ambiguity: string | null } | null {
  const normalized = String(message || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = Array.from(new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !LOCATION_TOKEN_STOP_WORDS.has(token))
  ));
  if (tokens.length === 0) {
    return null;
  }

  const scores = new Map<string, { personName: string; role: 'admin' | 'fieldman'; score: number }>();

  tokens.forEach((token) => {
    const matches = queryChatbotLocationByName(token, { isAnonymous });
    matches.forEach((match) => {
      const key = `${match.personName}|${match.role}`;
      const existing = scores.get(key) || {
        personName: match.personName,
        role: match.role,
        score: 0,
      };
      existing.score += 1;
      scores.set(key, existing);
    });
  });

  if (scores.size === 0) {
    return null;
  }

  const ranked = Array.from(scores.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.personName.localeCompare(b.personName);
  });

  const top = ranked[0];
  const second = ranked[1];
  const roleFromMessage = detectRequestedRoleFromText(message);

  if (!second || top.score > second.score) {
    return {
      personName: top.personName,
      requestedRole: roleFromMessage !== 'unknown' ? roleFromMessage : top.role,
      ambiguity: null,
    };
  }

  return {
    personName: top.personName,
    requestedRole: roleFromMessage,
    ambiguity: getLocationMatchPreview(ranked.map((item) => ({ personName: item.personName, role: item.role })), 5),
  };
}

function extractLocationNameTokens(message: string): string[] {
  const normalized = String(message || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return Array.from(new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !LOCATION_TOKEN_STOP_WORDS.has(token))
  ));
}

function resolveLocationIntentFromMessage(
  message: string,
  history: Array<{ role?: string; content?: string }>,
  isAnonymous: boolean,
  currentUserName?: string
): string | null {
  const directIntent = detectLocationQueryIntent(message);
  if (directIntent) {
    return resolveLocationQueryReply(directIntent, isAnonymous);
  }

  const followUpIntent = detectLocationFollowUpIntent(message, history);
  if (followUpIntent) {
    return resolveLocationQueryReply(followUpIntent, isAnonymous);
  }

  if (!containsLocationKeyword(message)) {
    return null;
  }

  const explicitTarget = inferExplicitLocationTarget(message, isAnonymous);
  if (explicitTarget && explicitTarget.ambiguity) {
    return `I found multiple possible people in your message. Please specify full name and role. Matches: ${explicitTarget.ambiguity}.`;
  }
  if (explicitTarget) {
    const asksAddress = /\b(address|tirahan)\b/i.test(String(message || ''));
    return resolveLocationQueryReply(
      {
        personName: explicitTarget.personName,
        asksAddress,
        requestedRole: explicitTarget.requestedRole,
      },
      isAnonymous
    );
  }

  const explicitNameTokens = extractLocationNameTokens(message);
  if (explicitNameTokens.length > 0) {
    const hintedName = explicitNameTokens.join(' ');
    if (isAnonymous) {
      return `No visible location record found for ${hintedName}. It may be unavailable or restricted.`;
    }
    return `No location record found for ${hintedName}. Please check the spelling and try again.`;
  }

  const asksAddress = /\b(address|tirahan)\b/i.test(String(message || ''));
  const asksOwnLocation = /\b(my|me|mine|ko|akin|ako|sarili)\b/i.test(String(message || ''));
  if (!isAnonymous && asksOwnLocation && currentUserName && currentUserName.trim().length > 0) {
    return resolveLocationQueryReply(
      {
        personName: currentUserName.trim(),
        asksAddress,
        requestedRole: 'unknown',
      },
      false
    );
  }

  const previousIntent = getMostRecentLocationIntentFromHistory(history);
  if (!previousIntent) {
    return 'Please include the person name for location lookup (example: where is Ronald Airon or address of Angelo).';
  }

  return resolveLocationQueryReply(
    {
      personName: previousIntent.personName,
      asksAddress,
      requestedRole: detectRequestedRoleFromText(message) !== 'unknown'
        ? detectRequestedRoleFromText(message)
        : previousIntent.requestedRole,
    },
    isAnonymous
  );
}

function getLocationMatchPreview(matches: Array<{ personName: string; role: string }>, maxItems = 5): string {
  const seen = new Set<string>();
  const preview: string[] = [];

  for (const item of matches) {
    const key = `${item.personName}|${item.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    preview.push(`${item.personName} (${item.role})`);
    if (preview.length >= maxItems) break;
  }

  return preview.join(', ');
}

function resolveLocationQueryReply(intent: LocationQueryIntent, isAnonymous: boolean): string {
  if (isAnonymous && intent.requestedRole === 'admin') {
    return 'Anonymous access is restricted for admin location lookups. You can request fieldman location data only.';
  }

  // Use the new database-backed location service as primary
  // This function is synchronous, so we'll return a placeholder and handle async in the route
  // For now, we'll try the scraper first for backward compatibility
  const status = getChatbotLocationScraperStatus();
  let matches = queryChatbotLocationByName(intent.personName, { isAnonymous });

  if (matches.length === 0) {
    // No matches from scraper - will be handled by async database lookup in route
    // Return a special marker that the route handler will intercept
    return `__ASYNC_LOCATION_LOOKUP__:${intent.personName}:${intent.requestedRole}:${intent.asksAddress}`;
  }

  if (intent.requestedRole !== 'unknown') {
    const roleMatches = matches.filter((item) => item.role === intent.requestedRole);
    if (roleMatches.length === 0) {
      const availableRoles = Array.from(new Set(matches.map((item) => item.role))).join(', ');
      return `I found matches for ${intent.personName}, but none with role ${intent.requestedRole}. Available role(s): ${availableRoles}.`;
    }
    matches = roleMatches;
  }

  const normalizedQuery = intent.personName.toLowerCase();
  const exactMatches = matches.filter((item) => item.personName.toLowerCase() === normalizedQuery);
  if (exactMatches.length > 1) {
    const roleSet = new Set(exactMatches.map((item) => item.role));
    const preview = getLocationMatchPreview(exactMatches);
    if (intent.requestedRole === 'unknown' && roleSet.size > 1) {
      return `I found multiple records for ${intent.personName} with different roles. Please specify role (admin or fieldman). Matches: ${preview}.`;
    }
    return `I found multiple records for ${intent.personName}. Please provide a more specific name. Matches: ${preview}.`;
  }

  if (exactMatches.length === 0 && matches.length > 1) {
    const roleSet = new Set(matches.map((item) => item.role));
    const preview = getLocationMatchPreview(matches);
    if (intent.requestedRole === 'unknown' && roleSet.size > 1) {
      return `I found multiple people matching ${intent.personName} across different roles. Please specify role (admin or fieldman). Matches: ${preview}.`;
    }
    return `I found multiple people matching ${intent.personName}. Please provide the full name for an exact result. Matches: ${preview}.`;
  }

  const selected = exactMatches[0] || matches[0];
  const coordinatesText = `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`;
  const staleSuffix = status.stale ? ' Note: feed is currently stale.' : '';

  if (intent.asksAddress) {
    if (selected.address && selected.address.trim().length > 0) {
      return `${selected.personName} (${selected.role}) approximate address: ${selected.address}. Coordinates: ${coordinatesText}.${staleSuffix}`;
    }
    return `${selected.personName} (${selected.role}) has no indexed address yet. Coordinates: ${coordinatesText}.${staleSuffix}`;
  }

  return `${selected.personName} (${selected.role}) coordinates: ${coordinatesText}.${staleSuffix}`;
}

const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CHAT_IMAGE_BYTES,
    files: MAX_CHAT_IMAGE_FILES,
    fields: 12,
    fieldSize: 128 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported image type. Allowed types: PNG, JPEG, WEBP'));
  },
});

type ChatUploadRequest = Request & {
  file?: Express.Multer.File;
  files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] };
};

interface ChatAttachmentMeta {
  name: string;
  mimeType: string;
  size: number;
}

const IMAGE_ONLY_CONTENT_MARKER = '__IMAGE_ONLY__';

function getUploadedImageFiles(req: Request): Express.Multer.File[] {
  const request = req as ChatUploadRequest;
  const filesFromFields = request.files && !Array.isArray(request.files)
    ? [
      ...(request.files.image || []),
      ...(request.files.images || []),
    ]
    : [];

  const filesFromArray = Array.isArray(request.files) ? request.files : [];
  const primaryFile = request.file ? [request.file] : [];

  const combined = [...primaryFile, ...filesFromArray, ...filesFromFields];
  if (combined.length === 0) {
    return [];
  }

  const uniqueByFingerprint = new Map<string, Express.Multer.File>();
  for (const f of combined) {
    const fingerprint = `${f.fieldname}:${f.originalname}:${f.size}:${f.mimetype}`;
    if (!uniqueByFingerprint.has(fingerprint)) {
      uniqueByFingerprint.set(fingerprint, f);
    }
  }

  return Array.from(uniqueByFingerprint.values());
}

const parseOptionalChatImage = (req: Request, res: Response, next: NextFunction) => {
  chatImageUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: MAX_CHAT_IMAGE_FILES },
  ])(req, res, (err: any) => {
    if (!err) {
      const imageFiles = getUploadedImageFiles(req);
      if (imageFiles.length > MAX_CHAT_IMAGE_FILES) {
        res.status(400).json({ error: `Too many images. Maximum is ${MAX_CHAT_IMAGE_FILES}.` });
        return;
      }
      next();
      return;
    }

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'Image is too large. Maximum size is 5MB.' });
      return;
    }

    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: 'Invalid multipart payload.' });
      return;
    }

    res.status(400).json({ error: err.message || 'Invalid image upload payload' });
  });
};

function hasValidImageSignature(file: Express.Multer.File): boolean {
  const data = file.buffer;
  if (!data || data.length < 12) return false;

  if (file.mimetype === 'image/png') {
    return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47;
  }

  if (file.mimetype === 'image/jpeg') {
    return data[0] === 0xFF && data[1] === 0xD8;
  }

  if (file.mimetype === 'image/webp') {
    return data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
  }

  return false;
}

const validateUploadedImageSignature = (req: Request, res: Response, next: NextFunction) => {
  const imageFiles = getUploadedImageFiles(req);
  if (imageFiles.length === 0) {
    next();
    return;
  }

  for (const imageFile of imageFiles) {
    if (!hasValidImageSignature(imageFile)) {
      res.status(400).json({ error: 'Uploaded file content does not match declared image type.' });
      return;
    }
  }

  next();
};

const chatImageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => getUploadedImageFiles(req).length === 0,
  keyGenerator: (req: Request) => {
    const userId = (req as any)?.user?.userId;
    const anonId = (req as any)?.cookies?.anon_id;
    if (userId) return `chat-image:user:${userId}`;
    if (anonId) return `chat-image:anon:${anonId}`;
    return `chat-image:ip:${req.ip}`;
  },
  message: { error: 'Too many image uploads. Please wait a minute and try again.' },
});

const normalizeAnonymousMultipartPayload = (req: Request, _res: Response, next: NextFunction) => {
  const contentHeader = req.headers['x-chat-content'];
  if ((!req.body.content || String(req.body.content).trim() === '') && typeof contentHeader === 'string') {
    req.body.content = contentHeader;
  }

  const historyHeader = req.headers['x-chat-history'];
  if ((req.body.history === undefined || req.body.history === null) && typeof historyHeader === 'string') {
    try {
      req.body.history = JSON.parse(historyHeader);
    } catch {
      req.body.history = [];
    }
  }

  const suggestedHeader = req.headers['x-chat-suggested-prompt'];
  if (req.body.fromSuggestedPrompt === undefined && typeof suggestedHeader === 'string') {
    req.body.fromSuggestedPrompt = suggestedHeader === 'true';
  }

  if (typeof req.body.history === 'string') {
    try {
      req.body.history = JSON.parse(req.body.history);
    } catch {
      req.body.history = [];
    }
  }

  if (typeof req.body.fromSuggestedPrompt === 'string') {
    req.body.fromSuggestedPrompt = req.body.fromSuggestedPrompt === 'true';
  }

  next();
};

const hydrateContentFromHeader = (req: Request, _res: Response, next: NextFunction) => {
  const contentHeader = req.headers['x-chat-content'];
  if ((!req.body.content || String(req.body.content).trim() === '') && typeof contentHeader === 'string') {
    req.body.content = contentHeader;
  }
  next();
};

const getImageAttachmentsFromRequest = (req: Request): ImageAttachment[] => {
  return getUploadedImageFiles(req)
    .slice(0, MAX_CHAT_IMAGE_FILES)
    .filter((imageFile) => imageFile && imageFile.buffer)
    .map((imageFile) => ({
      mimeType: imageFile.mimetype,
      dataBase64: imageFile.buffer.toString('base64'),
    }));
};

function getAttachmentMetadataFromRequest(req: Request): ChatAttachmentMeta[] {
  return getUploadedImageFiles(req).map((file) => ({
    name: file.originalname,
    mimeType: file.mimetype,
    size: file.size || 0,
  }));
}

function isContentOrImageProvided(req: Request, value: unknown): boolean {
  const content = typeof value === 'string' && value.trim() === IMAGE_ONLY_CONTENT_MARKER
    ? ''
    : (typeof value === 'string' ? value.trim() : '');
  if (content.length > 0) {
    return true;
  }

  return getUploadedImageFiles(req).length > 0;
}

function sanitizeOCRText(text: string): string {
  let normalized = String(text || '');
  normalized = normalized.replace(/[\r\t]+/g, ' ');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  normalized = normalized.replace(/\s{2,}/g, ' ');
  normalized = normalized.replace(/<\s*\/?\s*(system|developer|assistant|instruction|prompt)\s*>/gi, '');
  normalized = normalized.replace(/\[\s*(system|developer|assistant|instruction|prompt)\s*(note)?\s*:[^\]]{0,400}\]/gi, '');
  return normalized.trim();
}

async function extractOCRText(file: Express.Multer.File): Promise<{ text: string; confidence: number | null }> {
  const worker = await createWorker('eng');
  try {
    const recognizePromise = worker.recognize(file.buffer);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('OCR_TIMEOUT')), OCR_TIMEOUT_MS);
    });

    const result: any = await Promise.race([recognizePromise, timeoutPromise]);
    const rawText = result?.data?.text ? String(result.data.text) : '';
    const confidence = typeof result?.data?.confidence === 'number'
      ? result.data.confidence
      : null;

    return {
      text: sanitizeOCRText(rawText),
      confidence,
    };
  } finally {
    await worker.terminate();
  }
}

interface OCRContextPayload {
  contextText?: string;
  summary: {
    uploadedCount: number;
    attemptedCount: number;
    withTextCount: number;
    timeoutCount: number;
    failedCount: number;
  };
}

interface OCRResultItem {
  index: number;
  file: Express.Multer.File;
  text?: string;
  confidence?: number | null;
  errorReason?: string;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const maxWorkers = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: maxWorkers }, () => runWorker()));
  return results;
}

async function getOCRContextFromRequest(req: Request): Promise<OCRContextPayload> {
  const imageFiles = getUploadedImageFiles(req);
  if (imageFiles.length === 0) {
    return {
      summary: {
        uploadedCount: 0,
        attemptedCount: 0,
        withTextCount: 0,
        timeoutCount: 0,
        failedCount: 0,
      }
    };
  }

  const blocks: string[] = [];
  let totalChars = 0;
  const attemptedCount = imageFiles.length;
  let withTextCount = 0;
  let timeoutCount = 0;
  let failedCount = 0;

  const limitedImages = imageFiles.slice(0, MAX_CHAT_IMAGE_FILES);
  const rawOCRResults = await runWithConcurrency<Express.Multer.File, OCRResultItem>(
    limitedImages,
    OCR_CONCURRENCY,
    async (file, index) => {
      try {
        const ocr = await extractOCRText(file);
        return {
          index,
          file,
          text: ocr.text,
          confidence: ocr.confidence,
        };
      } catch (error: any) {
        const reason = error?.message === 'OCR_TIMEOUT'
          ? `timeout after ${Math.round(OCR_TIMEOUT_MS / 1000)}s`
          : 'ocr_failed';
        return {
          index,
          file,
          errorReason: reason,
        };
      }
    }
  );

  const orderedOCRResults = rawOCRResults.sort((a, b) => a.index - b.index);

  for (const result of orderedOCRResults) {
    const i = result.index;
    const file = result.file;

    if (result.errorReason) {
      if (result.errorReason.includes('timeout')) {
        timeoutCount += 1;
      } else {
        failedCount += 1;
      }
      blocks.push(`OCR_IMAGE_${i + 1} (name=${file.originalname}): [${result.errorReason}]`);
      continue;
    }

    const extractedText = String(result.text || '');
    if (!extractedText) {
      blocks.push(`OCR_IMAGE_${i + 1}: [no readable text detected]`);
      continue;
    }

    withTextCount += 1;

    let textForPrompt = extractedText;
    if (textForPrompt.length > OCR_MAX_CHARS_PER_IMAGE) {
      textForPrompt = textForPrompt.substring(0, OCR_MAX_CHARS_PER_IMAGE) + '...';
    }

    if (totalChars + textForPrompt.length > OCR_MAX_TOTAL_CHARS) {
      const remaining = Math.max(0, OCR_MAX_TOTAL_CHARS - totalChars);
      if (remaining <= 0) {
        blocks.push(`OCR_IMAGE_${i + 1}: [truncated due to OCR text budget]`);
        break;
      }
      textForPrompt = textForPrompt.substring(0, remaining) + '...';
    }

    totalChars += textForPrompt.length;
    const confidencePart = result.confidence == null
      ? ''
      : `, confidence=${Math.round(result.confidence)}%`;

    blocks.push(`OCR_IMAGE_${i + 1} (name=${file.originalname}${confidencePart}):\n${textForPrompt}`);
  }

  return {
    contextText: blocks.length > 0 ? blocks.join('\n\n') : undefined,
    summary: {
      uploadedCount: imageFiles.length,
      attemptedCount,
      withTextCount,
      timeoutCount,
      failedCount,
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// TOPIC DETECTION
// ───────────────────────────────────────────────────────────────────
async function extractTopicFromMessage(message: string): Promise<string> {
  try {
    // Use the AI service to generate a brief topic (max 50 chars)
    const systemPrompt = `You are a helpful assistant. Extract a brief, concise topic (max 50 characters) from the following message. 
Respond with ONLY the topic, nothing else:`;

    // For simplicity, use the first 60 characters or until first sentence as topic
    const firstLine = message.split('\n')[0].substring(0, 60).trim();
    if (firstLine.length > 0) {
      return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
    }
    return 'Chat'; // Fallback
  } catch (error) {
    console.error('Error extracting topic:', error);
    return message.substring(0, 50).trim() || 'Chat';
  }
}

// Create a new conversation
chatRouter.post(
  '/conversations',
  requireAuth,
  body('title').optional().trim().isLength({ max: 200 }),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const conversationId = uuidv4();
      // Use authenticated user's ID from JWT
      const userId = (req as any).user.userId;
      const title = sanitizeInput(req.body.title || ''); // Start with blank title

      // Ensure user exists in DB (it was created on first Lark login, but guard anyway)
      const existing = await runQuery<any>(`SELECT id FROM users WHERE id = ?`, [userId]);
      if (existing.length === 0) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      // Create conversation linked to the authenticated user
      await executeQuery(
        `INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)`,
        [conversationId, userId, title]
      );

      res.json({
        success: true,
        conversationId,
        userId,
        role: (req as any).user.role,
        message: 'Conversation created',
      });
    } catch (error) {
      console.error('Error creating conversation:', error);
      res.status(500).json({ error: 'Failed to create conversation' });
    }
  }
);

// Get all conversations (only for the authenticated user)
chatRouter.get('/conversations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const conversations = await runQuery(
      `SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`,
      [userId]
    );
    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get a specific conversation with messages
chatRouter.get(
  '/conversations/:conversationId',
  requireAuth,
  param('conversationId').isUUID(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;

      const conversation = await runQuery<any>(
        `SELECT * FROM conversations WHERE id = ?`,
        [conversationId]
      );

      if (conversation.length === 0) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const messages = await runQuery(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
        [conversationId]
      );
      const normalizedMessages = (messages as any[]).map((message) => {
        let attachments: ChatAttachmentMeta[] = [];
        if (message.attachment_list_json) {
          try {
            const parsed = JSON.parse(String(message.attachment_list_json));
            if (Array.isArray(parsed)) {
              attachments = parsed.filter((item: any) => item && typeof item.name === 'string').map((item: any) => ({
                name: String(item.name),
                mimeType: String(item.mimeType || ''),
                size: Number(item.size || 0),
              }));
            }
          } catch {
            attachments = [];
          }
        }

        if (!attachments.length && message.attachment_name) {
          attachments = [{
            name: String(message.attachment_name),
            mimeType: String(message.attachment_mime || ''),
            size: Number(message.attachment_size || 0),
          }];
        }

        return {
          ...message,
          attachments,
        };
      });

      // Get user profile including role and name
      let userRole = 'unknown';
      let userName: string | null = null;
      if (conversation[0].user_id) {
        const user = await runQuery<any>(
          `SELECT role, username FROM users WHERE id = ?`,
          [conversation[0].user_id]
        );
        if (user.length > 0) {
          userRole = user[0].role || 'unknown';
          userName = user[0].username || null;
        }
      }

      res.json({
        id: conversation[0].id,
        userId: conversation[0].user_id,
        title: conversation[0].title,
        userRole,
        userName,
        created_at: conversation[0].created_at,
        updated_at: conversation[0].updated_at,
        messages: normalizedMessages,
      });
    } catch (error) {
      console.error('Error fetching conversation:', error);
      res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  }
);

// Send a message to a conversation
chatRouter.post(
  '/conversations/:conversationId/messages',
  requireAuth,
  chatRateLimiter,
  parseOptionalChatImage,
  hydrateContentFromHeader,
  validateUploadedImageSignature,
  chatImageRateLimiter,
  param('conversationId').isUUID(),
  body('content')
    .optional({ nullable: true })
    .custom((value, { req }) => {
      if (!isContentOrImageProvided(req as Request, value)) {
        throw new Error('Message content or at least one image is required');
      }

      const content = typeof value === 'string' ? value.trim() : '';
      if (content.length > 5000) {
        throw new Error('Message must be between 1 and 5000 characters');
      }

      return true;
    }),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const rawTransportContent = typeof req.body.content === 'string' ? req.body.content : '';
      const rawContent = rawTransportContent.trim() === IMAGE_ONLY_CONTENT_MARKER ? '' : rawTransportContent;
      const content = sanitizeInput(rawContent);
      const uploadedAttachments = getAttachmentMetadataFromRequest(req);
      const primaryAttachment = uploadedAttachments[0];
      const aiInputContent = content || (uploadedAttachments.length > 0
        ? 'This is an OpenCI screenshot. Analyze the attached image(s) and explain what is shown in OpenCI context.'
        : '');

      // Check if this is the first message for this conversation
      const existingMessages = await runQuery(
        `SELECT id FROM messages WHERE conversation_id = ?`,
        [conversationId]
      );
      const isFirstMessage = existingMessages.length === 0;

      // Save user message
      const userMessageId = uuidv4();
      await executeQuery(
        `INSERT INTO messages (id, conversation_id, role, content, attachment_name, attachment_mime, attachment_size, attachment_list_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userMessageId,
          conversationId,
          'user',
          content,
          primaryAttachment?.name || null,
          primaryAttachment?.mimeType || null,
          primaryAttachment?.size || 0,
          uploadedAttachments.length > 0 ? JSON.stringify(uploadedAttachments) : null,
        ]
      );

      // Auto-detect topic from first message if title is empty
      if (isFirstMessage) {
        const conversation = await runQuery<any>(
          `SELECT title FROM conversations WHERE id = ?`,
          [conversationId]
        );

        if (conversation.length > 0 && (!conversation[0].title || conversation[0].title.trim() === '') && content) {
          const detectedTopic = await extractTopicFromMessage(content);
          await executeQuery(
            `UPDATE conversations SET title = ? WHERE id = ?`,
            [detectedTopic, conversationId]
          );
        }
      }

      // Get conversation history for context
      const messages = await runQuery(
        `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
        [conversationId]
      );

      // Build user profile from JWT for logged-in users
      const user = (req as any).user;
      const ocrPayload = await getOCRContextFromRequest(req);

      // Generate AI response using Groq AI
      // Exclude the last message (the just-saved user message) since generateAIResponse appends it explicitly
      let aiResponse: string;
      try {
        const imageAttachments = getImageAttachmentsFromRequest(req);
        const executionPlan = decideAgenticRoute({
          message: content,
          hasImageInput: uploadedAttachments.length > 0,
        });

        let locationReply = executionPlan.route === 'multimodal_ai'
          ? null
          : resolveLocationIntentFromMessage(content, (messages as any[]).slice(0, -1), false, user?.name)
          ;

        // Handle async location lookup from database if scraper returned no results
        if (locationReply && locationReply.startsWith('__ASYNC_LOCATION_LOOKUP__:')) {
          const parts = locationReply.split(':');
          const personName = parts[1];
          const requestedRole = parts[2] as 'admin' | 'fieldman' | 'unknown';
          const asksAddress = parts[3] === 'true';
          
          // Query the database for user location
          const roleFilter = requestedRole !== 'unknown' ? requestedRole : undefined;
          const locationResult = await getUserLocationByName(personName, roleFilter);
          locationReply = formatLocationResponse(locationResult, asksAddress);
        }

        if (locationReply) {
          aiResponse = locationReply;
        } else {
          const userProfile: UserProfile | undefined = user
            ? { name: user.name, role: user.role }
            : undefined;

          const result = await generateAIResponse(
            aiInputContent,
            (messages as any[]).slice(0, -1),
            conversationId,
            userProfile,
            true,
            {
              imageAttachments,
              ocrExtractedText: ocrPayload.contextText,
              hasImageInput: uploadedAttachments.length > 0,
            }
          );
          aiResponse = result.text;
        }
      } catch (error) {
        if (error instanceof AIProviderLimitError) {
          res.status(503).json({
            error: 'ai_provider_limit_reached',
            provider: error.provider,
            message: 'AI service limit reached. Please try again later.',
          });
          return;
        }
        console.error('AI generation error:', error);
        aiResponse = 'I apologize, but I encountered an error while processing your request. Please try again.';
      }

      // Detect user name from AI response (e.g., "Thanks Juan! ...")
      // GUARDRAIL: For logged-in Lark users, don't overwrite their verified name
      let detectedName: string | null = null;
      const isLarkUser = !!(user?.name && user?.larkId);
      if (!isLarkUser) {
        // Only detect/overwrite name for anonymous or non-Lark users
        const nameMatch =
          aiResponse.match(/(?:Thanks|Okay|Hi|Hello|Nice|Kumusta|Noted|Sure|Great|Got it),?\s+([A-Za-z]{2,30})[!?.]/i) ||
          aiResponse.match(/,\s+([A-Za-z]{2,30})[!?.]\s+[Ii]kaw ba ay/i);
        if (nameMatch && nameMatch[1]) {
          detectedName = nameMatch[1];
          try {
            const convData = await runQuery<any>(
              `SELECT user_id FROM conversations WHERE id = ?`,
              [conversationId]
            );
            if (convData.length > 0 && convData[0].user_id) {
              await executeQuery(
                `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [detectedName, convData[0].user_id]
              );
            }
          } catch (nameErr) {
            console.error('Name update error (non-critical):', nameErr instanceof Error ? nameErr.message.substring(0, 50) : 'unknown');
          }
        }
      }

      // Save AI response
      const aiMessageId = uuidv4();
      await executeQuery(
        `INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`,
        [aiMessageId, conversationId, 'assistant', aiResponse]
      );

      // Update conversation timestamp
      await executeQuery(
        `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [conversationId]
      );

      // Smart title: extract problem topic from the conversation
      let updatedTitle: string | null = null;
      try {
        const allMessages = await runQuery(
          `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
          [conversationId]
        );
        const smartTitle = await extractProblemTitle(allMessages as any[]);
        if (smartTitle) {
          const existing = await runQuery<any>(
            `SELECT title FROM conversations WHERE id = ?`,
            [conversationId]
          );
          if (existing.length > 0 && existing[0].title !== smartTitle) {
            await executeQuery(
              `UPDATE conversations SET title = ? WHERE id = ?`,
              [smartTitle, conversationId]
            );
            updatedTitle = smartTitle;
          }
        }
      } catch (titleErr) {
        console.error('Smart title extraction failed (non-critical):', titleErr instanceof Error ? titleErr.message.substring(0, 50) : 'unknown');
      }

      res.json({
        success: true,
        userMessage: {
          id: userMessageId,
          role: 'user',
          content,
          attachmentName: primaryAttachment?.name || null,
          attachmentMime: primaryAttachment?.mimeType || null,
          attachmentSize: primaryAttachment?.size || 0,
          attachments: uploadedAttachments,
        },
        aiMessage: {
          id: aiMessageId,
          role: 'assistant',
          content: aiResponse,
        },
        ocrSummary: ocrPayload.summary,
        executionPlan: decideAgenticRoute({
          message: content,
          hasImageInput: uploadedAttachments.length > 0,
        }),
        detectedRole: null,
        detectedName,
        updatedTitle,
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

// Save a message without triggering AI (for onboarding)
chatRouter.post(
  '/conversations/:conversationId/messages/save',
  requireAuth,
  param('conversationId').isUUID(),
  body('content')
    .notEmpty().withMessage('Content is required')
    .trim()
    .isLength({ min: 1, max: 5000 }).withMessage('Content must be between 1 and 5000 characters'),
  body('role').optional().isIn(['user', 'assistant']),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const content = sanitizeInput(req.body.content);
      const role = req.body.role || 'user';

      const messageId = uuidv4();
      await executeQuery(
        `INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`,
        [messageId, conversationId, role, content]
      );

      res.json({ success: true, messageId });
    } catch (error) {
      console.error('Error saving message:', error);
      res.status(500).json({ error: 'Failed to save message' });
    }
  }
);

// Delete a conversation
chatRouter.delete(
  '/conversations/:conversationId',
  requireAuth,
  param('conversationId').isUUID(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;

      await executeQuery(
        `DELETE FROM conversations WHERE id = ?`,
        [conversationId]
      );

      res.json({
        success: true,
        message: 'Conversation deleted',
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({ error: 'Failed to delete conversation' });
    }
  }
);

// Update a conversation (e.g., title)
chatRouter.patch(
  '/conversations/:conversationId',
  requireAuth,
  param('conversationId').isUUID(),
  body('title')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Title must be at most 200 characters'),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const title = req.body.title !== undefined ? sanitizeInput(req.body.title) : null;

      if (title !== null) {
        await executeQuery(
          `UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [title, conversationId]
        );
      } else {
        await executeQuery(
          `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [conversationId]
        );
      }

      res.json({
        success: true,
        message: 'Conversation updated',
      });
    } catch (error) {
      console.error('Error updating conversation:', error);
      res.status(500).json({ error: 'Failed to update conversation' });
    }
  }
);

// Health check endpoint
chatRouter.get('/health', (_req: Request, res: Response) => {
  const aiRouting = getAIRoutingMetrics();
  const canary = evaluateCanaryPolicy(aiRouting);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    aiRouting,
    canary,
  });
});

chatRouter.get('/chatbot/location-status', (_req: Request, res: Response) => {
  const status = getChatbotLocationScraperStatus();
  res.json({
    success: true,
    status,
  });
});

// Captcha client configuration endpoint.
chatRouter.get('/captcha/config', (_req: Request, res: Response) => {
  const enabled = RECAPTCHA_SITE_KEY.length > 0 && RECAPTCHA_SECRET_KEY.length > 0;
  res.json({
    provider: 'recaptcha',
    enabled,
    siteKey: enabled ? RECAPTCHA_SITE_KEY : null,
  });
});

// Verify reCAPTCHA token server-side and reset limiter bucket on success.
chatRouter.post(
  '/captcha/verify',
  body('token').isString().isLength({ min: 1, max: 4096 }),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    if (!RECAPTCHA_SECRET_KEY) {
      res.status(503).json({ success: false, error: 'captcha_not_configured' });
      return;
    }

    const token = String(req.body.token || '');

    try {
      const payload = new URLSearchParams();
      payload.append('secret', RECAPTCHA_SECRET_KEY);
      payload.append('response', token);
      if (req.ip) {
        payload.append('remoteip', req.ip);
      }

      const verifyRes = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        payload.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 8000,
        }
      );

      if (verifyRes.data?.success !== true) {
        res.status(400).json({ success: false, error: 'captcha_invalid' });
        return;
      }

      resetRateLimit(req);
      res.json({ success: true });
    } catch (error) {
      console.error('reCAPTCHA verification failed:', error);
      res.status(502).json({ success: false, error: 'captcha_verification_failed' });
    }
  }
);

// Anonymous chat — no persistence, ephemeral session
chatRouter.post(
  '/chat/anonymous',
  chatRateLimiter,
  parseOptionalChatImage,
  hydrateContentFromHeader,
  validateUploadedImageSignature,
  chatImageRateLimiter,
  normalizeAnonymousMultipartPayload,
  body('content')
    .optional({ nullable: true })
    .custom((value, { req }) => {
      if (!isContentOrImageProvided(req as Request, value)) {
        throw new Error('Message content or at least one image is required');
      }

      const content = typeof value === 'string' ? value.trim() : '';
      if (content.length > 5000) {
        throw new Error('Message must be between 1 and 5000 characters');
      }

      return true;
    }),
  body('history').optional().isArray({ max: 100 }),
  body('fromSuggestedPrompt').optional().isBoolean(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const rawTransportContent = typeof req.body.content === 'string' ? req.body.content : '';
      const rawContent = rawTransportContent.trim() === IMAGE_ONLY_CONTENT_MARKER ? '' : rawTransportContent;
      const content = sanitizeInput(rawContent);
      const fromSuggestedPrompt = req.body.fromSuggestedPrompt === true;
      const rawHistory: any[] = Array.isArray(req.body.history) ? req.body.history : [];
      const ocrPayload = await getOCRContextFromRequest(req);
      const hasUploadedImages = getUploadedImageFiles(req).length > 0;
      const executionPlan = decideAgenticRoute({
        message: content,
        hasImageInput: hasUploadedImages,
      });
      const aiInputContent = content || (hasUploadedImages
        ? 'This is an OpenCI screenshot. Analyze the attached image(s) and explain what is shown in OpenCI context.'
        : '');
      const safeHistory = rawHistory
        .filter((m: any) => m && typeof m.role === 'string' && typeof m.content === 'string')
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: sanitizeInput(String(m.content).substring(0, 5000))
        }));

      let result: { text: string; detectedRole: string | null };
      try {
        let locationReply = executionPlan.route === 'multimodal_ai'
          ? null
          : resolveLocationIntentFromMessage(content, safeHistory, true, undefined);
        
        // Handle async location lookup from database if scraper returned no results
        if (locationReply && locationReply.startsWith('__ASYNC_LOCATION_LOOKUP__:')) {
          const parts = locationReply.split(':');
          const personName = parts[1];
          const requestedRole = parts[2] as 'admin' | 'fieldman' | 'unknown';
          const asksAddress = parts[3] === 'true';
          
          // For anonymous users, only allow fieldman lookups
          if (requestedRole === 'admin') {
            locationReply = 'Anonymous access is restricted for admin location lookups. You can request fieldman location data only.';
          } else {
            const roleFilter = requestedRole !== 'unknown' ? requestedRole : 'fieldman';
            const locationResult = await getUserLocationByName(personName, roleFilter);
            locationReply = formatLocationResponse(locationResult, asksAddress);
          }
        }
        
        if (locationReply) {
          result = {
            text: locationReply,
            detectedRole: null,
          };
        } else {
          result = await generateAIResponse(
            aiInputContent,
            safeHistory,
            undefined,
            undefined,
            false,
            {
              suggestedPromptFirstTurn: fromSuggestedPrompt && safeHistory.length === 0,
              imageAttachments: getImageAttachmentsFromRequest(req),
              ocrExtractedText: ocrPayload.contextText,
              hasImageInput: hasUploadedImages,
            }
          );
        }
      } catch (error) {
        if (error instanceof AIProviderLimitError) {
          res.status(503).json({
            error: 'ai_provider_limit_reached',
            provider: error.provider,
            message: 'AI service limit reached. Please try again later.',
          });
          return;
        }
        throw error;
      }

      // Detect name from AI response for anonymous users
      let detectedName: string | null = null;
      const nameMatch =
        result.text.match(/(?:Thanks|Okay|Hi|Hello|Nice|Kumusta|Noted|Sure|Great|Got it),?\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)[!?.]/i) ||
        result.text.match(/,\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)[!?.]\s+[Ii]kaw ba ay/i);
      if (nameMatch && nameMatch[1]) {
        detectedName = nameMatch[1].trim();
      }

      // Detect role from user message for anonymous users
      let detectedRole: string | null = null;
      const msgLower = content.toLowerCase();
      if (/\bfieldman\b|\bfield man\b|\bfield agent\b|\bfa\b/.test(msgLower)) {
        detectedRole = 'fieldman';
      } else if (/\badmin\b|\badministrator\b/.test(msgLower)) {
        detectedRole = 'admin';
      }

      res.json({
        success: true,
        aiMessage: { id: 'anon-' + Date.now(), role: 'assistant', content: result.text },
        ocrSummary: ocrPayload.summary,
        executionPlan,
        detectedName,
        detectedRole,
      });
    } catch (error) {
      console.error('Error in anonymous chat:', error);
      res.status(500).json({ error: 'Failed to process message' });
    }
  }
);

// Get coordinates from location name
chatRouter.post('/location/coordinates',
  body('location').trim().notEmpty().withMessage('Location is required'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const location = sanitizeInput(req.body.location);
      const coordinates = await getCoordinates(location);

      if (coordinates) {
        res.json({
          success: true,
          location,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          address: coordinates.address,
          city: coordinates.city,
          country: coordinates.country,
          formatted: formatCoordinates(coordinates.latitude, coordinates.longitude)
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Location not found. Please try a different location name.'
        });
      }
    } catch (error) {
      console.error('Error getting coordinates:', error);
      res.status(500).json({ error: 'Failed to get coordinates' });
    }
  }
);

// Get location from coordinates (reverse geocoding)
chatRouter.post('/location/reverse',
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { latitude, longitude } = req.body;
      const formattedLoc = formatCoordinates(latitude, longitude);

      res.json({
        success: true,
        latitude,
        longitude,
        address: formattedLoc,
        formatted: formattedLoc
      });
    } catch (error) {
      console.error('Error getting location from coordinates:', error);
      res.status(500).json({ error: 'Failed to get location' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// USER PROFILE ENDPOINTS
// ══════════════════════════════════════════════════════════════

// Create a new user (implicit on conversation start)
chatRouter.post('/users',
  body('username').optional().trim().isLength({ min: 1, max: 100 }),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const userId = uuidv4();
      const username = req.body.username ? sanitizeInput(req.body.username) : undefined;
      const email = undefined; // Not required for implicit user creation
      const role = 'unknown'; // Default role

      // Create user in database
      await executeQuery(
        `INSERT INTO users (id, username, email, role) VALUES (?, ?, ?, ?)`,
        [userId, username || null, email || null, role]
      );

      res.json({
        success: true,
        userId,
        username,
        role,
        message: 'User created',
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

// Get user profile
chatRouter.get('/users/:userId',
  param('userId').isUUID(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      const user = await runQuery<any>(
        `SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?`,
        [userId]
      );

      if (user.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(user[0]);
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  }
);

// Update user profile (username, role)
chatRouter.post('/users/:userId/profile',
  param('userId').isUUID(),
  body('username').optional().trim().isLength({ min: 1, max: 100 }),
  body('role').optional().isIn(['unknown', 'fieldman', 'admin', 'manager']),
  handleValidationErrors,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { username, role } = req.body;

      // Check if user exists
      const user = await runQuery<any>(
        `SELECT id FROM users WHERE id = ?`,
        [userId]
      );

      if (user.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Update username if provided
      if (username) {
        const sanitizedUsername = sanitizeInput(username);
        await executeQuery(
          `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [sanitizedUsername, userId]
        );
      }

      // Update role if provided
      if (role) {
        const sanitizedRole = sanitizeInput(role).toLowerCase();
        await executeQuery(
          `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [sanitizedRole, userId]
        );
      }

      // Fetch updated user
      const updatedUser = await runQuery<any>(
        `SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?`,
        [userId]
      );

      res.json({
        success: true,
        user: updatedUser[0],
        message: 'User profile updated',
      });
    } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).json({ error: 'Failed to update user profile' });
    }
  }
);

