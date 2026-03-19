import dotenv from 'dotenv';

dotenv.config();

// ──────────────────────────────────────────────
//  In-memory fallback store (used when PostgreSQL is not available)
// ──────────────────────────────────────────────
let useInMemory = false;

interface Row {
  [key: string]: any;
}

const memoryDB: { [table: string]: Row[] } = {
  conversations: [],
  messages: [],
  users: [],
};

function inMemoryQuery<T = any>(sql: string, params: any[] = []): T[] {
  const s = sql.trim().toUpperCase();

  if (s.startsWith('SELECT')) {
    // Detect table
    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    if (!tableMatch) return [];
    const table = tableMatch[1].toLowerCase();
    const rows: Row[] = memoryDB[table] ? [...memoryDB[table]] : [];

    // WHERE id = ?
    const whereId = sql.match(/WHERE\s+id\s*=\s*\?/i);
    if (whereId && params.length > 0) return rows.filter(r => r.id === params[0]) as T[];

    // WHERE lark_id = ?
    const whereLarkId = sql.match(/WHERE\s+lark_id\s*=\s*\?/i);
    if (whereLarkId && params.length > 0) return rows.filter(r => r.lark_id === params[0]) as T[];

    // WHERE user_id = ?
    const whereUserId = sql.match(/WHERE\s+user_id\s*=\s*\?/i);
    if (whereUserId && params.length > 0) return rows.filter(r => r.user_id === params[0]) as T[];

    // WHERE conversation_id = ?
    const whereConv = sql.match(/WHERE\s+conversation_id\s*=\s*\?/i);
    if (whereConv && params.length > 0) return rows.filter(r => r.conversation_id === params[0]) as T[];

    // ORDER BY updated_at DESC
    if (sql.match(/ORDER BY updated_at DESC/i)) {
      rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    // ORDER BY created_at ASC
    if (sql.match(/ORDER BY created_at ASC/i)) {
      rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    return rows as T[];
  }

  if (s.startsWith('INSERT INTO CONVERSATIONS')) {
    // INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)
    const now = new Date().toISOString();
    memoryDB.conversations.push({ id: params[0], user_id: params[1], title: params[2], created_at: now, updated_at: now });
    return [];
  }

  if (s.startsWith('INSERT INTO MESSAGES')) {
    // INSERT INTO messages (...) VALUES (?, ?, ?, ?, ...)
    const now = new Date().toISOString();
    memoryDB.messages.push({
      id: params[0],
      conversation_id: params[1],
      role: params[2],
      content: params[3],
      attachment_name: params[4] || null,
      attachment_mime: params[5] || null,
      attachment_size: params[6] || 0,
      attachment_list_json: params[7] || null,
      created_at: now,
    });
    return [];
  }

  if (s.startsWith('INSERT INTO USERS')) {
    const now = new Date().toISOString();
    const role = params[3] || 'unknown';
    // params: [id, username, email, role] or [id, username, email, role, lark_id]
    const lark_id = params[4] || null;
    memoryDB.users.push({ id: params[0], username: params[1], email: params[2], role, lark_id, created_at: now, updated_at: now });
    return [];
  }

  if (s.startsWith('UPDATE CONVERSATIONS')) {
    const setTitle = sql.match(/SET title\s*=\s*\?/i);
    const setTs = sql.match(/SET updated_at/i) || sql.match(/updated_at\s*=\s*CURRENT_TIMESTAMP/i);
    const whereId = sql.match(/WHERE id\s*=\s*\?/i);
    // When WHERE id = ? exists, the conversation ID is the last parameter
    const conversationId = whereId ? params[params.length - 1] : params[0];
    const idx = memoryDB.conversations.findIndex(c => c.id === conversationId);
    if (idx !== -1) {
      if (setTitle) memoryDB.conversations[idx].title = params[0];
      memoryDB.conversations[idx].updated_at = new Date().toISOString();
    }
    return [];
  }

  if (s.startsWith('UPDATE USERS')) {
    const setRole = sql.match(/SET role\s*=\s*\?/i);
    const setUsername = sql.match(/SET username\s*=\s*\?/i);
    // Multi-column update: SET username = ?, email = ?, role = ?, updated_at = ...
    const setMultiple = sql.match(/SET username\s*=\s*\?.*email\s*=\s*\?.*role\s*=\s*\?/i);
    const whereId = sql.match(/WHERE id\s*=\s*\?/i);
    const userId = whereId ? params[params.length - 1] : params[0];
    const idx = memoryDB.users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      if (setMultiple) {
        memoryDB.users[idx].username = params[0];
        memoryDB.users[idx].email = params[1];
        memoryDB.users[idx].role = params[2];
      } else if (setRole) {
        memoryDB.users[idx].role = params[0];
      } else if (setUsername) {
        memoryDB.users[idx].username = params[0];
      }
      memoryDB.users[idx].updated_at = new Date().toISOString();
    }
    return [];
  }

  if (s.startsWith('DELETE FROM CONVERSATIONS')) {
    memoryDB.conversations = memoryDB.conversations.filter(c => c.id !== params[0]);
    memoryDB.messages = memoryDB.messages.filter(m => m.conversation_id !== params[0]);
    return [];
  }

  return [];
}

// ──────────────────────────────────────────────
//  PostgreSQL pool (only created if PG is available)
// ──────────────────────────────────────────────
let pool: any = null;

async function tryLoadPg(config: any): Promise<boolean> {
  try {
    const { Pool } = await import('pg');
    const testPool = new Pool(config);
    const client = await testPool.connect();
    client.release();
    pool = testPool;
    return true;
  } catch {
    return false;
  }
}

export async function initializeDatabase(): Promise<void> {
  const pgHost = process.env.PG_HOST || 'localhost';
  const useSSL =
    process.env.PG_SSL === 'true' ||
    /supabase\.co$/i.test(pgHost);

  const config = {
    host: pgHost,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: process.env.PG_DATABASE || 'chatbot',
    ssl: useSSL
      ? {
          rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true',
        }
      : undefined,
  };

  console.log('🔌 Attempting to connect to PostgreSQL...');
  const connected = await tryLoadPg(config);

  if (connected) {
    console.log(`✅ Connected to PostgreSQL database: ${config.database}`);
    await createTables();
  } else {
    console.log('⚠️  PostgreSQL unavailable — switching to in-memory store.');
    console.log('💡 Data will be lost when the server restarts. Install PostgreSQL for persistence.');
    useInMemory = true;
  }
}

async function createTables(): Promise<void> {
  if (useInMemory || !pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        email TEXT UNIQUE,
        role TEXT DEFAULT 'unknown',
        lark_id TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Add lark_id column if upgrading from an older schema
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_id TEXT UNIQUE
    `).catch(() => {
      // Column may already exist — ignore error
    });
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachment_name TEXT,
        attachment_mime TEXT,
        attachment_size INTEGER DEFAULT 0,
        attachment_list_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT
    `).catch(() => {
      // Column may already exist — ignore error
    });
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT
    `).catch(() => {
      // Column may already exist — ignore error
    });
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size INTEGER DEFAULT 0
    `).catch(() => {
      // Column may already exist — ignore error
    });
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_list_json TEXT
    `).catch(() => {
      // Column may already exist — ignore error
    });
    
    // User Session Tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT UNIQUE NOT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        stop_time TIMESTAMP,
        duration INTEGER,
        location TEXT,
        battery TEXT,
        device TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await client.query('COMMIT');
    console.log('✅ All PostgreSQL tables created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Helper: convert ? placeholders to $1, $2 ...
function convertPlaceholders(sql: string): string {
  let count = 1;
  return sql.replace(/\?/g, () => `$${count++}`);
}

// Run SELECT queries, returns rows
export async function runQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (useInMemory) return inMemoryQuery<T>(sql, params);
  const convertedSql = convertPlaceholders(sql);
  const result = await pool.query(convertedSql, params);
  return (result.rows as T[]) || [];
}

// Run INSERT / UPDATE / DELETE
export async function executeQuery(sql: string, params: any[] = []): Promise<void> {
  if (useInMemory) {
    inMemoryQuery(sql, params);
    return;
  }
  const convertedSql = convertPlaceholders(sql);
  await pool.query(convertedSql, params);
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    console.log('PostgreSQL connection pool closed');
  }
}

export function getPool(): any {
  return pool;
}
