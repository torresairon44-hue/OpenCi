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
import { authRouter } from './auth';
import demoRouter from './demo-endpoints';
import { testConnection, isGoogleAIConnected, initializeVectorStore, initializeOpenCIAPI, getVectorStore, getOpenCIAPI } from './ai-service';
import { initializeAll } from './init-utils';

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
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
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
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// API rate limiting (stricter)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // Increased from 30 to 300 for normal usage
  message: 'Too many API requests, please try again later.',
});

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(o => o.length > 0)
  : [];
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  credentials: true,
  optionsSuccessStatus: 200,
}));
app.use(bodyParser.json({ limit: '10mb' })); // Reduced from 50mb
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Serve static files (frontend)
const bundledPublicDir = path.join(__dirname, 'public');
const sourcePublicDir = path.join(__dirname, '../public');
const publicDir = fs.existsSync(bundledPublicDir) ? bundledPublicDir : sourcePublicDir;
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

// Serve index.html for all non-API routes
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

async function initializeEnhancedServices(): Promise<void> {
  try {
    await initializeDatabase();
    console.log('✅ Database initialized successfully');

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
    if (pool) {
      await initializeVectorStore(pool);
    } else {
      console.log('⚠  Vector Store: PostgreSQL not available (in-memory mode)');
    }

    // OPTION C: Initialize OpenCI API Integration
    await initializeOpenCIAPI();

    // Run full initialization with all services
    await initializeAll({
      vectorStore: getVectorStore(),
      openCIAPI: getOpenCIAPI(),
      loadSampleDocs: true, // Load sample documents on startup
    });
  } catch (error) {
    // Keep HTTP service alive even if optional integrations fail.
    console.error('⚠ Startup integrations failed, continuing in degraded mode:', error);
  }
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

  initializeEnhancedServices().finally(() => {
    if (!isGoogleAIConnected()) {
      console.log('💡 To enable real AI, add your GROQ_API_KEY to .env');
    }
  });
}

if (require.main === module) {
  startServer();
}

export default app;
