import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';

/**
 * Chat-specific rate limiter middleware.
 * Limits users to a configurable number of chat prompts per time window.
 * Priority for identity key: user ID -> anonymous cookie -> IP fallback.
 */

interface RateLimitEntry {
    timestamps: number[];
    pausedUntil: number | null;
}

interface ClientKeyInfo {
    key: string;
    keyType: 'user' | 'anonymous_cookie' | 'ip_fallback';
    rawValue: string;
}

const store = new Map<string, RateLimitEntry>();

// Config
const MAX_PROMPTS = 5;          // Max prompts per window
const WINDOW_MS = 60 * 1000;    // 1 minute window
const PAUSE_DURATION_MS = 15 * 1000; // 15 second pause on exceed
const ENABLE_RATE_LIMIT_LOGS = process.env.RATE_LIMIT_LOGS !== 'false';

// Cleanup stale entries every 5 minutes.
// Use unref so this timer does not keep Node/Jest processes alive by itself.
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        // Remove entries with no recent activity and no active pause
        const hasRecentActivity = entry.timestamps.some(t => now - t < WINDOW_MS * 2);
        const isPaused = entry.pausedUntil && entry.pausedUntil > now;
        if (!hasRecentActivity && !isPaused) {
            store.delete(key);
        }
    }
}, 5 * 60 * 1000);

if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
}

function getClientKeyInfo(req: Request): ClientKeyInfo {
    const user = (req as any).user;
    if (user?.userId) {
        return {
            key: `user:${user.userId}`,
            keyType: 'user',
            rawValue: String(user.userId),
        };
    }

    const anonymousId = (req as any).cookies?.anon_id;
    if (anonymousId && typeof anonymousId === 'string') {
        return {
            key: `anon:${anonymousId}`,
            keyType: 'anonymous_cookie',
            rawValue: anonymousId,
        };
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return {
        key: `ip:${ip}`,
        keyType: 'ip_fallback',
        rawValue: String(ip),
    };
}

function hashForLog(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function logRateLimiterEvent(req: Request, keyInfo: ClientKeyInfo, event: string, remaining?: number): void {
    if (!ENABLE_RATE_LIMIT_LOGS) {
        return;
    }

    const parts = [
        '[chat-rate-limit]',
        `event=${event}`,
        `keyType=${keyInfo.keyType}`,
        `keyHash=${hashForLog(keyInfo.rawValue)}`,
        `path=${req.path}`,
    ];

    if (typeof remaining === 'number') {
        parts.push(`remaining=${remaining}`);
    }

    console.log(parts.join(' '));
}

/**
 * Chat rate limiter middleware.
 * Returns 429 when limit is exceeded, with pause info.
 */
export function chatRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const keyInfo = getClientKeyInfo(req);
    const now = Date.now();

    let entry = store.get(keyInfo.key);
    if (!entry) {
        entry = { timestamps: [], pausedUntil: null };
        store.set(keyInfo.key, entry);
    }

    // Check if user is currently paused
    if (entry.pausedUntil && now < entry.pausedUntil) {
        const remainingMs = entry.pausedUntil - now;
        const remainingSec = Math.ceil(remainingMs / 1000);
        logRateLimiterEvent(req, keyInfo, 'paused', 0);
        res.status(429).json({
            error: 'rate_limited',
            message: `You are currently paused. Please wait ${remainingSec} seconds.`,
            pauseDuration: Math.ceil(PAUSE_DURATION_MS / 1000),
            remainingSeconds: remainingSec,
            requiresCaptcha: true,
        });
        return;
    }

    // Clear pause if it has expired
    if (entry.pausedUntil && now >= entry.pausedUntil) {
        entry.pausedUntil = null;
    }

    // Clean old timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => now - t < WINDOW_MS);

    // Check if limit exceeded
    if (entry.timestamps.length >= MAX_PROMPTS) {
        entry.pausedUntil = now + PAUSE_DURATION_MS;
        logRateLimiterEvent(req, keyInfo, 'exceeded', 0);
        res.status(429).json({
            error: 'rate_limited',
            message: `You've sent too many messages. Please wait ${Math.ceil(PAUSE_DURATION_MS / 1000)} seconds.`,
            pauseDuration: Math.ceil(PAUSE_DURATION_MS / 1000),
            remainingSeconds: Math.ceil(PAUSE_DURATION_MS / 1000),
            requiresCaptcha: true,
        });
        return;
    }

    // Record this request
    entry.timestamps.push(now);
    logRateLimiterEvent(req, keyInfo, 'allowed', Math.max(0, MAX_PROMPTS - entry.timestamps.length));
    next();
}

/**
 * Reset rate limit for a specific client (after CAPTCHA verification).
 */
export function resetRateLimit(req: Request): void {
    const keyInfo = getClientKeyInfo(req);
    store.delete(keyInfo.key);
    logRateLimiterEvent(req, keyInfo, 'reset');
}
