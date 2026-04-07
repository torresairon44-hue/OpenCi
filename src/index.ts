import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';
import { initializeDatabase, getPool } from './database';
import { chatRouter } from './routes';
import { authRouter, optionalAuth } from './auth';
import demoRouter from './demo-endpoints';
import adminApprovalsRouter from './admin-approvals';
import { testConnection, isGoogleAIConnected, initializeVectorStore, initializeOpenCIAPI, getVectorStore, getOpenCIAPI } from './ai-service';
import { initializeAll } from './init-utils';
import { shouldEnableChatbotLocationScraper, startChatbotLocationScraper } from './chatbot-location-scraper';

// Load environment variables
dotenv.config();

process.on('unhandledRejection', (reason) => {
  console.error('⚠ Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('⚠ Uncaught exception:', error);
});

const app: Express = express();
const requestedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PORT = requestedPort === 3100 ? 3000 : requestedPort;
const IS_PRODUCTION = (process.env.NODE_ENV || 'development') === 'production';
const IS_TEST_ENV = (process.env.NODE_ENV || '').toLowerCase() === 'test';
const LARK_AVATAR_ALLOWED_HOST_SUFFIXES = String(process.env.LARK_AVATAR_ALLOWED_HOST_SUFFIXES || 'larksuite.com,feishu.cn,byteimg.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.length > 0);
const CSP_TRUSTED_LARK_IMG_SOURCES = Array.from(
  new Set(
    LARK_AVATAR_ALLOWED_HOST_SUFFIXES.flatMap((suffix) => [
      `https://${suffix}`,
      `https://*.${suffix}`,
    ])
  )
);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

if (requestedPort === 3100) {
  console.warn('⚠ PORT=3100 is blocked by project policy. Falling back to port 3000.');
}

function parseTrustProxy(value?: string): boolean | number {
  if (!value || value.trim() === '') return 1;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

function normalizeOrigin(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return null;
  }
}

function parseAllowedOrigins(value?: string): Set<string> {
  const origins = new Set<string>();
  String(value || '')
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => Boolean(item))
    .forEach((item) => origins.add(item));
  return origins;
}

function getRequestOrigin(req: Request): string {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host') || '';
  return normalizeOrigin(`${protocol}://${host}`) || '';
}

function readRequesterOrigin(req: Request): string | null {
  const origin = normalizeOrigin(req.get('origin') || '');
  if (origin) {
    return origin;
  }
  return normalizeOrigin(req.get('referer') || '');
}

function createAnonymousId(): string {
  return randomUUID();
}

app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// Platform health endpoint kept outside rate limits and auth to avoid false restarts.
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path === '/healthz' || req.path === '/' || req.path === '/api/health') {
    console.log(`📡 Request received: ${req.method} ${req.path}`);
  }
  next();
});

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.google.com", "https://www.gstatic.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https://cdnjs.cloudflare.com", "https://a.tile.openstreetmap.org", "https://b.tile.openstreetmap.org", "https://c.tile.openstreetmap.org", "https://*.public.blob.vercel-storage.com", ...CSP_TRUSTED_LARK_IMG_SOURCES],
      connectSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com", "https://cdnjs.cloudflare.com"],
      frameSrc: ["'self'", "https://www.google.com", "https://recaptcha.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(cookieParser());

// Ensure anonymous users get a stable per-browser identity for rate limiting.
app.use((req: Request, res: Response, next: NextFunction) => {
  const cookies = (req as any).cookies || {};
  const hasAuthToken = Boolean(cookies.auth_token);
  const hasAnonId = Boolean(cookies.anon_id);

  if (!hasAuthToken && !hasAnonId) {
    res.cookie('anon_id', createAnonymousId(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    });
  }

  next();
});

// Rate limiting
const limiter = IS_TEST_ENV
  ? null
  : rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 600, // Limit each IP to 600 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });
const disableGlobalRateLimit = process.env.DISABLE_GLOBAL_RATE_LIMIT === 'true';
if (IS_TEST_ENV) {
  console.log('ℹ Global IP rate limiter skipped in test environment');
} else if (disableGlobalRateLimit) {
  console.warn('⚠ Global IP rate limiter is disabled via DISABLE_GLOBAL_RATE_LIMIT=true');
} else {
  app.use(limiter!);
}

// API rate limiting (stricter)
const apiLimiter = IS_TEST_ENV
  ? ((_req: Request, _res: Response, next: NextFunction) => next())
  : rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1200, // Increased for shared-IP production traffic
    message: 'Too many API requests, please try again later.',
  });

// Middleware
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const baseUrlOrigin = normalizeOrigin(process.env.BASE_URL || '');
if (baseUrlOrigin) {
  allowedOrigins.add(baseUrlOrigin);
}

const csrfTrustedOrigins = parseAllowedOrigins(process.env.CSRF_TRUSTED_ORIGINS);
allowedOrigins.forEach((origin) => csrfTrustedOrigins.add(origin));

const allowAllOriginsInDev = !IS_PRODUCTION && allowedOrigins.size === 0;
if (IS_PRODUCTION && allowedOrigins.size === 0) {
  console.warn('⚠ ALLOWED_ORIGINS is empty in production. Cross-origin browser requests will be rejected.');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalized = normalizeOrigin(origin);
    if (!normalized) {
      callback(new Error('Invalid CORS origin'));
      return;
    }

    if (allowAllOriginsInDev || allowedOrigins.has(normalized)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS policy'));
  },
  credentials: true,
  optionsSuccessStatus: 200,
}));

const disableCsrfOriginCheck = process.env.DISABLE_CSRF_ORIGIN_CHECK === 'true';
if (disableCsrfOriginCheck) {
  console.warn('⚠ CSRF origin check is disabled via DISABLE_CSRF_ORIGIN_CHECK=true');
}

// Additional CSRF guard for cookie-authenticated mutating API requests.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (disableCsrfOriginCheck) {
    next();
    return;
  }

  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  const authToken = String(((req as any).cookies || {}).auth_token || '').trim();
  if (!authToken) {
    next();
    return;
  }

  const requesterOrigin = readRequesterOrigin(req);
  if (!requesterOrigin) {
    res.status(403).json({ error: 'Blocked by CSRF protection: missing Origin/Referer header' });
    return;
  }

  const requestOrigin = getRequestOrigin(req);
  if (requesterOrigin === requestOrigin || csrfTrustedOrigins.has(requesterOrigin)) {
    next();
    return;
  }

  res.status(403).json({ error: 'Blocked by CSRF protection: untrusted request origin' });
});

app.use(bodyParser.json({ limit: '10mb' })); // Reduced from 50mb
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Serve static files (frontend)
function resolvePublicDir(): string {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '../public'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'dist', 'public'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(process.cwd(), 'public');
}

const publicDir = resolvePublicDir();
app.use(express.static(publicDir));

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Dev-only DB inspector endpoint.
// Access from browser: http://localhost:3000/api/dev/db/tables
app.get('/api/dev/db/tables', async (req: Request, res: Response) => {
  if ((process.env.NODE_ENV || 'development') === 'production') {
    return res.status(403).json({ error: 'DB inspector is disabled in production' });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(503).json({
      error: 'PostgreSQL is not connected. App is likely in in-memory mode.',
    });
  }

  const allowedTables = [
    'users',
    'conversations',
    'messages',
    'openci_documents',
    'conversation_embeddings',
  ];

  const tableParam = typeof req.query.table === 'string' ? req.query.table : undefined;
  const tableFilter = tableParam && allowedTables.includes(tableParam) ? tableParam : undefined;

  const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;

  try {
    const tableRows = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    const existingTables: string[] = tableRows.rows.map((r: any) => r.table_name);
    const selectedTables = tableFilter ? [tableFilter] : allowedTables;

    const details: Array<{
      table: string;
      exists: boolean;
      count: number | null;
      sample: any[];
      error?: string;
    }> = [];

    for (const table of selectedTables) {
      if (!existingTables.includes(table)) {
        details.push({ table, exists: false, count: null, sample: [] });
        continue;
      }

      try {
        const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
        const sampleResult = await pool.query(`SELECT * FROM ${table} ORDER BY 1 DESC LIMIT ${limit}`);
        details.push({
          table,
          exists: true,
          count: countResult.rows[0]?.count ?? 0,
          sample: sampleResult.rows,
        });
      } catch (error: any) {
        details.push({
          table,
          exists: true,
          count: null,
          sample: [],
          error: error?.message || 'Query failed',
        });
      }
    }

    return res.json({
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432', 10),
      database: process.env.PG_DATABASE || 'chatbot',
      schema: 'public',
      endpoint: '/api/dev/db/tables',
      availableTables: existingTables,
      details,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to inspect database' });
  }
});

// Routes (with API rate limiting)
app.use('/api/auth', authRouter);
app.use('/api', apiLimiter, chatRouter);
app.use('/api', adminApprovalsRouter);

// Demo endpoints (for testing v2.0 features)
const demoEndpointsEnabled =
  process.env.ENABLE_DEMO_ENDPOINTS === 'true' ||
  (process.env.NODE_ENV || 'development') !== 'production';

if (demoEndpointsEnabled) {
  app.use('/api', demoRouter);
  console.log('Demo endpoints enabled under /api/demo/* (admin-auth required)');
} else {
  console.log('Demo endpoints disabled (set ENABLE_DEMO_ENDPOINTS=true to enable)');
}

// Return JSON 404 for unknown API routes instead of falling through to index.html.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API route not found' });
});

// Dedicated admin dashboard pages.
app.get([
  '/admin',
  '/admin/dashboard',
  '/admin/learn',
  '/admin/fieldman-location',
  '/admin/prepare',
  '/admin/admin-approve',
  '/admin/add-sensor',
  '/admin/activity-log',
  '/admin/execute',
], optionalAuth, (req: Request, res: Response) => {
  const role = (((req as any).user?.role) || '').toLowerCase();
  if (role !== 'admin') {
    res.redirect('/?error=unauthorized_role');
    return;
  }
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Serve index.html for all non-API routes
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

async function initializeEnhancedServices(): Promise<void> {
  // Database is a critical dependency in production and may throw if unavailable.
  await initializeDatabase();
  console.log('✅ Database initialized successfully');

  try {
    // Test AI connection
    await testConnection();
    if (isGoogleAIConnected()) {
      console.log('✅ Groq AI connected successfully');
    } else {
      console.log('ℹ️  Running in fallback mode - using demo responses');
    }

    // OPTION B: Initialize Vector Store with pgvector
    console.log('\n📚 Initializing enhanced services...');
    const pool = getPool();
    const hasGoogleEmbeddingKey = Boolean((process.env.GOOGLE_AI_API_KEY || '').trim());
    if (pool && hasGoogleEmbeddingKey) {
      await initializeVectorStore(pool);
    } else if (pool && !hasGoogleEmbeddingKey) {
      console.log('ℹ Vector Store: skipped (GOOGLE_AI_API_KEY not configured; Groq-only mode)');
    } else {
      console.log('⚠  Vector Store: PostgreSQL not available (in-memory mode)');
    }

    // OPTION C: Initialize OpenCI API Integration
    await initializeOpenCIAPI();

    // Run full initialization with all services
    await initializeAll({
      vectorStore: getVectorStore(),
      openCIAPI: getOpenCIAPI(),
      loadSampleDocs: hasGoogleEmbeddingKey, // Load sample docs only when embedding key exists
    });
  } catch (error) {
    // Keep HTTP service alive even if optional integrations fail.
    console.error('⚠ Startup integrations failed, continuing in degraded mode:', error);
  }
}

let enhancedServicesInitPromise: Promise<void> | null = null;

export function ensureEnhancedServicesInitialized(): Promise<void> {
  if (!enhancedServicesInitPromise) {
    enhancedServicesInitPromise = initializeEnhancedServices();
  }
  return enhancedServicesInitPromise;
}

// Start HTTP server first so platform health checks can pass while integrations warm up.
function startServer() {
  const onListening = (bindLabel: string) => {
    console.log(`\n🚀 Server is running on port ${PORT} (${bindLabel})`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✨ Version: OpenCI ChatBot v2.0 (Icio) with enhanced capabilities`);
  };

  const startIPv4Fallback = () => {
    const fallbackServer = app.listen(PORT, '0.0.0.0', () => onListening('ipv4'));
    fallbackServer.on('error', (error) => {
      console.error('❌ HTTP server failed to start (ipv4):', error);
      process.exit(1);
    });
  };

  const server = app.listen(PORT, '::', () => onListening('ipv6'));

  server.on('error', (error) => {
    const anyError = error as any;
    if (anyError?.code === 'EAFNOSUPPORT' || anyError?.code === 'EADDRNOTAVAIL') {
      console.warn('⚠ IPv6 bind unavailable, retrying on IPv4...');
      startIPv4Fallback();
      return;
    }
    console.error('❌ HTTP server failed to start (ipv6):', error);
    process.exit(1);
  });

  ensureEnhancedServicesInitialized()
    .then(() => {
      if (shouldEnableChatbotLocationScraper()) {
        const started = startChatbotLocationScraper();
        if (started) {
          console.log('🛰 Chatbot location scraper enabled');
        } else {
          console.warn('⚠ Chatbot location scraper failed to start (check INTERNAL_SCRAPER_API_KEY)');
        }
      }

      if (!isGoogleAIConnected()) {
        console.log('💡 To enable real AI, add your GROQ_API_KEY to .env');
      }
    })
    .catch((error) => {
      console.error('❌ Critical startup initialization failed:', error);
      if (IS_PRODUCTION) {
        process.exit(1);
      }
    });
}

if (require.main === module) {
  startServer();
}

export default app;
