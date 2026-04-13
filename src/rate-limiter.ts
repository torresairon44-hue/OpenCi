import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import Redis from 'ioredis';

/**
 * Chat-specific rate limiter middleware.
 * Limits users to a configurable number of chat prompts per time window.
 * Priority for identity key: user ID -> anonymous cookie -> IP fallback.
 */

interface RateLimitEntry {
    tokens: number;
    lastRefillMs: number;
    consecutiveViolations: number;
    pausedUntil: number | null;
}

interface ClientKeyInfo {
    key: string;
    keyType: 'user' | 'anonymous_cookie' | 'ip_fallback';
    rawValue: string;
}

const store = new Map<string, RateLimitEntry>();

// Config
const AUTH_CAPACITY = parseInt(process.env.CHAT_RATE_LIMIT_AUTH_CAPACITY || '12', 10);
const AUTH_REFILL_PER_SEC = parseFloat(process.env.CHAT_RATE_LIMIT_AUTH_REFILL_PER_SEC || '0.5'); // 1 token / 2 sec
const ANON_CAPACITY = parseInt(process.env.CHAT_RATE_LIMIT_ANON_CAPACITY || '8', 10);
const ANON_REFILL_PER_SEC = parseFloat(process.env.CHAT_RATE_LIMIT_ANON_REFILL_PER_SEC || '0.33'); // ~20/min
const IP_FALLBACK_CAPACITY = parseInt(process.env.CHAT_RATE_LIMIT_IP_CAPACITY || '5', 10);
const IP_FALLBACK_REFILL_PER_SEC = parseFloat(process.env.CHAT_RATE_LIMIT_IP_REFILL_PER_SEC || '0.25'); // 15/min
const BASE_PAUSE_DURATION_MS = parseInt(process.env.CHAT_RATE_LIMIT_BASE_PAUSE_MS || '10000', 10);
const ENABLE_RATE_LIMIT_LOGS = process.env.RATE_LIMIT_LOGS !== 'false';
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const CHAT_RATE_LIMIT_REDIS_PREFIX = String(process.env.CHAT_RATE_LIMIT_REDIS_PREFIX || 'openci:chatrl:').trim();

let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
        if (!REDIS_URL) {
                return null;
        }

        if (redisClient) {
                return redisClient;
        }

        redisClient = new Redis(REDIS_URL, {
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                enableReadyCheck: true,
        });

        redisClient.on('error', (error) => {
                if (ENABLE_RATE_LIMIT_LOGS) {
                        console.warn(`[chat-rate-limit] redis_error=${error?.message || 'unknown'}`);
                }
        });

        return redisClient;
}

const REDIS_TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerSec = tonumber(ARGV[3])
local basePauseMs = tonumber(ARGV[4])

local tokens = tonumber(redis.call('HGET', key, 'tokens'))
local lastRefillMs = tonumber(redis.call('HGET', key, 'lastRefillMs'))
local pausedUntil = tonumber(redis.call('HGET', key, 'pausedUntil'))
local violations = tonumber(redis.call('HGET', key, 'violations'))

if not tokens then tokens = capacity end
if not lastRefillMs then lastRefillMs = nowMs end
if not pausedUntil then pausedUntil = 0 end
if not violations then violations = 0 end

if pausedUntil > nowMs then
    local remainingSec = math.ceil((pausedUntil - nowMs) / 1000)
    redis.call('EXPIRE', key, math.max(remainingSec, 60))
    return {0, math.floor(tokens), remainingSec, math.ceil(basePauseMs / 1000)}
end

if pausedUntil > 0 and nowMs >= pausedUntil then
    pausedUntil = 0
    violations = 0
end

local elapsedSec = math.max(0, (nowMs - lastRefillMs) / 1000)
if elapsedSec > 0 then
    tokens = math.min(capacity, tokens + (elapsedSec * refillPerSec))
end
lastRefillMs = nowMs

if tokens < 1 then
    violations = violations + 1
    local mult = math.min(4, math.max(1, violations))
    local pauseMs = basePauseMs * mult
    pausedUntil = nowMs + pauseMs

    redis.call('HSET', key,
        'tokens', tokens,
        'lastRefillMs', lastRefillMs,
        'pausedUntil', pausedUntil,
        'violations', violations)
    redis.call('EXPIRE', key, math.max(math.ceil(pauseMs / 1000), 120))

    return {0, math.floor(tokens), math.ceil(pauseMs / 1000), math.ceil(pauseMs / 1000)}
end

tokens = tokens - 1
violations = 0
pausedUntil = 0

redis.call('HSET', key,
    'tokens', tokens,
    'lastRefillMs', lastRefillMs,
    'pausedUntil', pausedUntil,
    'violations', violations)
redis.call('EXPIRE', key, 600)

return {1, math.floor(tokens), 0, math.ceil(basePauseMs / 1000)}
`;

// Cleanup stale entries every 5 minutes.
// Use unref so this timer does not keep Node/Jest processes alive by itself.
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        // Remove stale entries with no active pause and no refill/update for 10 minutes.
        const hasRecentActivity = now - entry.lastRefillMs < 10 * 60 * 1000;
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

function getBucketConfig(keyType: ClientKeyInfo['keyType']): { capacity: number; refillPerSec: number } {
    if (keyType === 'user') {
        return { capacity: Math.max(1, AUTH_CAPACITY), refillPerSec: Math.max(0.01, AUTH_REFILL_PER_SEC) };
    }

    if (keyType === 'anonymous_cookie') {
        return { capacity: Math.max(1, ANON_CAPACITY), refillPerSec: Math.max(0.01, ANON_REFILL_PER_SEC) };
    }

    return { capacity: Math.max(1, IP_FALLBACK_CAPACITY), refillPerSec: Math.max(0.01, IP_FALLBACK_REFILL_PER_SEC) };
}

function refillTokens(entry: RateLimitEntry, capacity: number, refillPerSec: number, nowMs: number): void {
    if (entry.lastRefillMs <= 0) {
        entry.lastRefillMs = nowMs;
        entry.tokens = capacity;
        return;
    }

    const elapsedSeconds = Math.max(0, (nowMs - entry.lastRefillMs) / 1000);
    if (elapsedSeconds <= 0) {
        return;
    }

    entry.tokens = Math.min(capacity, entry.tokens + elapsedSeconds * refillPerSec);
    entry.lastRefillMs = nowMs;
}

async function applyRedisRateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
    keyInfo: ClientKeyInfo,
    now: number,
    capacity: number,
    refillPerSec: number
): Promise<void> {
    const client = getRedisClient();
    if (!client) {
        throw new Error('redis_not_configured');
    }

    if (client.status !== 'ready') {
        await client.connect().catch(() => {});
    }

    const redisKey = `${CHAT_RATE_LIMIT_REDIS_PREFIX}${keyInfo.key}`;
    const result = await client.eval(
        REDIS_TOKEN_BUCKET_LUA,
        1,
        redisKey,
        String(now),
        String(capacity),
        String(refillPerSec),
        String(BASE_PAUSE_DURATION_MS)
    ) as Array<number>;

    const allowed = Number(result?.[0] || 0) === 1;
    const remaining = Math.max(0, Number(result?.[1] || 0));
    const remainingSeconds = Math.max(0, Number(result?.[2] || 0));
    const pauseDuration = Math.max(1, Number(result?.[3] || Math.ceil(BASE_PAUSE_DURATION_MS / 1000)));

    if (allowed) {
        logRateLimiterEvent(req, keyInfo, 'allowed', remaining);
        next();
        return;
    }

    const event = remainingSeconds > 0 ? 'paused' : 'exceeded';
    logRateLimiterEvent(req, keyInfo, event, 0);
    res.status(429).json({
        error: 'rate_limited',
        message: `You've sent too many messages. Please wait ${Math.max(1, remainingSeconds)} seconds.`,
        pauseDuration,
        remainingSeconds: Math.max(1, remainingSeconds),
        requiresCaptcha: true,
    });
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
    const { capacity, refillPerSec } = getBucketConfig(keyInfo.keyType);

    const redis = getRedisClient();
    if (redis) {
        applyRedisRateLimit(req, res, next, keyInfo, now, capacity, refillPerSec).catch(() => {
            // If Redis path fails, gracefully fallback to local in-memory limiter.
            applyInMemoryRateLimit(req, res, next, keyInfo, now, capacity, refillPerSec);
        });
        return;
    }

    applyInMemoryRateLimit(req, res, next, keyInfo, now, capacity, refillPerSec);
}

function applyInMemoryRateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
    keyInfo: ClientKeyInfo,
    now: number,
    capacity: number,
    refillPerSec: number
): void {

    let entry = store.get(keyInfo.key);
    if (!entry) {
        entry = {
            tokens: capacity,
            lastRefillMs: now,
            consecutiveViolations: 0,
            pausedUntil: null,
        };
        store.set(keyInfo.key, entry);
    }

    refillTokens(entry, capacity, refillPerSec, now);

    // Check if user is currently paused
    if (entry.pausedUntil && now < entry.pausedUntil) {
        const remainingMs = entry.pausedUntil - now;
        const remainingSec = Math.ceil(remainingMs / 1000);
        logRateLimiterEvent(req, keyInfo, 'paused', 0);
        res.status(429).json({
            error: 'rate_limited',
            message: `You are currently paused. Please wait ${remainingSec} seconds.`,
            pauseDuration: Math.ceil(BASE_PAUSE_DURATION_MS / 1000),
            remainingSeconds: remainingSec,
            requiresCaptcha: true,
        });
        return;
    }

    // Clear pause if it has expired
    if (entry.pausedUntil && now >= entry.pausedUntil) {
        entry.pausedUntil = null;
        entry.consecutiveViolations = 0;
    }

    // Need at least one full token to proceed.
    if (entry.tokens < 1) {
        entry.consecutiveViolations += 1;
        const multiplier = Math.min(4, Math.max(1, entry.consecutiveViolations));
        const pauseMs = BASE_PAUSE_DURATION_MS * multiplier;
        entry.pausedUntil = now + pauseMs;
        logRateLimiterEvent(req, keyInfo, 'exceeded', 0);
        res.status(429).json({
            error: 'rate_limited',
            message: `You've sent too many messages. Please wait ${Math.ceil(pauseMs / 1000)} seconds.`,
            pauseDuration: Math.ceil(pauseMs / 1000),
            remainingSeconds: Math.ceil(pauseMs / 1000),
            requiresCaptcha: true,
        });
        return;
    }

    // Consume token and continue.
    entry.tokens = Math.max(0, entry.tokens - 1);
    entry.consecutiveViolations = 0;
    logRateLimiterEvent(req, keyInfo, 'allowed', Math.floor(entry.tokens));
    next();
}

/**
 * Reset rate limit for a specific client (after CAPTCHA verification).
 */
export function resetRateLimit(req: Request): void {
    const keyInfo = getClientKeyInfo(req);
    store.delete(keyInfo.key);
    const redis = getRedisClient();
    if (redis) {
        const redisKey = `${CHAT_RATE_LIMIT_REDIS_PREFIX}${keyInfo.key}`;
        redis.del(redisKey).catch(() => {
            // Best effort reset for distributed limiter.
        });
    }
    logRateLimiterEvent(req, keyInfo, 'reset');
}
