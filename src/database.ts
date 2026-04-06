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
  user_sessions: [],
  approval_requests: [],
  approval_audit_log: [],
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

    // WHERE session_id = ?
    const whereSessionId = sql.match(/WHERE\s+session_id\s*=\s*\?/i);
    if (whereSessionId && params.length > 0) return rows.filter(r => r.session_id === params[0]) as T[];

    // WHERE requested_by_user_id = ? AND request_type = ? AND status = ?
    const whereRequesterTypeStatus = sql.match(/WHERE\s+requested_by_user_id\s*=\s*\?\s+AND\s+request_type\s*=\s*\?\s+AND\s+status\s*=\s*\?/i);
    if (whereRequesterTypeStatus && params.length >= 3) {
      return rows.filter(r => r.requested_by_user_id === params[0] && r.request_type === params[1] && r.status === params[2]) as T[];
    }

    // WHERE role = ? (for admin/fieldman queries)
    const whereRole = sql.match(/WHERE\s+role\s*=\s*\?/i);
    if (whereRole && params.length > 0) return rows.filter(r => r.role === params[0]) as T[];

    // WHERE role IN (?, ?) (for all users query)
    const whereRoleIn = sql.match(/WHERE\s+role\s+IN\s*\(\s*\?\s*,\s*\?\s*\)/i);
    if (whereRoleIn && params.length >= 2) {
      return rows.filter(r => params.includes(r.role)) as T[];
    }

    // WHERE LOWER(username) LIKE ? (for user search)
    const whereUsernameLike = sql.match(/WHERE\s+LOWER\s*\(\s*username\s*\)\s+LIKE\s*\?/i);
    if (whereUsernameLike && params.length > 0) {
      const pattern = String(params[0]).replace(/%/g, '');
      return rows.filter(r => String(r.username || '').toLowerCase().includes(pattern.toLowerCase())) as T[];
    }

    // WHERE status = ?
    const whereStatus = sql.match(/WHERE\s+status\s*=\s*\?/i);
    if (whereStatus && params.length > 0) return rows.filter(r => r.status === params[0]) as T[];

    // WHERE conversation_id = ?
    const whereConv = sql.match(/WHERE\s+conversation_id\s*=\s*\?/i);
    if (whereConv && params.length > 0) return rows.filter(r => r.conversation_id === params[0]) as T[];

    // Special case: JOIN query for user location lookup
    // SELECT ... FROM users u INNER JOIN user_sessions us ON u.id = us.user_id WHERE LOWER(u.username) LIKE ?
    const isUserLocationJoin = sql.match(/FROM\s+users\s+\w+\s+INNER\s+JOIN\s+user_sessions/i);
    if (isUserLocationJoin && params.length > 0) {
      const users = memoryDB['users'] || [];
      const sessions = memoryDB['user_sessions'] || [];
      const searchPattern = String(params[0]).replace(/%/g, '').toLowerCase();
      const roleFilter = params.length > 1 ? params[1] : null;
      
      const results: Row[] = [];
      for (const user of users) {
        if (!String(user.username || '').toLowerCase().includes(searchPattern)) continue;
        if (roleFilter && user.role !== roleFilter) continue;
        
        // Find most recent session with location
        const userSessions = sessions
          .filter((s: Row) => s.user_id === user.id && s.location && s.location !== '')
          .sort((a: Row, b: Row) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        
        if (userSessions.length > 0) {
          const session = userSessions[0];
          results.push({
            user_id: user.id,
            username: user.username,
            role: user.role,
            location: session.location,
            updated_at: session.updated_at
          });
        }
      }
      return results as T[];
    }

    // ORDER BY updated_at DESC
    if (sql.match(/ORDER BY updated_at DESC/i)) {
      rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    // ORDER BY created_at ASC
    if (sql.match(/ORDER BY created_at ASC/i)) {
      rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    // ORDER BY created_at DESC
    if (sql.match(/ORDER BY created_at DESC/i)) {
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    // ORDER BY username ASC
    if (sql.match(/ORDER BY username ASC/i)) {
      rows.sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
    }

    // ORDER BY role ASC
    if (sql.match(/ORDER BY role ASC/i)) {
      rows.sort((a, b) => String(a.role || '').localeCompare(String(b.role || '')));
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
    // params: [id, username, email, role] or [id, username, email, role, lark_id, lark_avatar_url]
    const lark_id = params[4] || null;
    const lark_avatar_url = params[5] || null;
    memoryDB.users.push({
      id: params[0],
      username: params[1],
      email: params[2],
      role,
      lark_id,
      lark_avatar_url,
      custom_avatar_url: null,
      avatar_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    return [];
  }

  if (s.startsWith('INSERT INTO USER_SESSIONS')) {
    const now = new Date().toISOString();
    memoryDB.user_sessions.push({
      id: params[0],
      user_id: params[1],
      session_id: params[2],
      start_time: now,
      stop_time: null,
      duration: null,
      location: null,
      battery: null,
      device: null,
      created_at: now,
      updated_at: now,
    });
    return [];
  }

  if (s.startsWith('INSERT INTO APPROVAL_REQUESTS')) {
    const now = new Date().toISOString();
    memoryDB.approval_requests.push({
      id: params[0],
      request_type: params[1],
      requested_by_user_id: params[2],
      requested_by_lark_id: params[3],
      reason: params[4],
      payload_json: params[5] || null,
      status: params[6],
      reviewed_by_user_id: null,
      reviewed_at: null,
      decision_note: null,
      created_at: now,
      updated_at: now,
    });
    return [];
  }

  if (s.startsWith('INSERT INTO APPROVAL_AUDIT_LOG')) {
    const now = new Date().toISOString();
    memoryDB.approval_audit_log.push({
      id: params[0],
      approval_request_id: params[1],
      actor_user_id: params[2],
      action: params[3],
      metadata_json: params[4] || null,
      created_at: now,
    });
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
    const setLarkAvatar = sql.match(/SET\s+lark_avatar_url\s*=\s*\?/i);
    const setCustomAvatar = sql.match(/SET\s+custom_avatar_url\s*=\s*\?/i);
    const clearCustomAvatar = sql.match(/SET\s+custom_avatar_url\s*=\s*NULL/i);
    // Multi-column update: SET username = ?, email = ?, role = ?, updated_at = ...
    const setMultiple = sql.match(/SET username\s*=\s*\?.*email\s*=\s*\?.*role\s*=\s*\?/i);
    const setMultipleWithLarkAvatar = sql.match(/SET\s+username\s*=\s*\?.*email\s*=\s*\?.*role\s*=\s*\?.*lark_avatar_url\s*=\s*\?/i);
    const setUsernameEmailLarkAvatar = sql.match(/SET\s+username\s*=\s*\?.*email\s*=\s*\?.*lark_avatar_url\s*=\s*\?/i);
    const whereId = sql.match(/WHERE id\s*=\s*\?/i);
    const userId = whereId ? params[params.length - 1] : params[0];
    const idx = memoryDB.users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      if (setMultipleWithLarkAvatar) {
        memoryDB.users[idx].username = params[0];
        memoryDB.users[idx].email = params[1];
        memoryDB.users[idx].role = params[2];
        memoryDB.users[idx].lark_avatar_url = params[3] || null;
      } else if (setUsernameEmailLarkAvatar) {
        memoryDB.users[idx].username = params[0];
        memoryDB.users[idx].email = params[1];
        memoryDB.users[idx].lark_avatar_url = params[2] || null;
      } else if (setMultiple) {
        memoryDB.users[idx].username = params[0];
        memoryDB.users[idx].email = params[1];
        memoryDB.users[idx].role = params[2];
      } else if (setLarkAvatar) {
        memoryDB.users[idx].lark_avatar_url = params[0] || null;
      } else if (setCustomAvatar) {
        memoryDB.users[idx].custom_avatar_url = params[0] || null;
        memoryDB.users[idx].avatar_updated_at = new Date().toISOString();
      } else if (clearCustomAvatar) {
        memoryDB.users[idx].custom_avatar_url = null;
        memoryDB.users[idx].avatar_updated_at = new Date().toISOString();
      } else if (setRole) {
        memoryDB.users[idx].role = params[0];
      } else if (setUsername) {
        memoryDB.users[idx].username = params[0];
      }
      memoryDB.users[idx].updated_at = new Date().toISOString();
    }
    return [];
  }

  if (s.startsWith('UPDATE USER_SESSIONS')) {
    const whereSessionId = sql.match(/WHERE\s+session_id\s*=\s*\?/i);
    const sessionId = whereSessionId ? params[params.length - 1] : params[0];
    const idx = memoryDB.user_sessions.findIndex((session) => session.session_id === sessionId);
    if (idx !== -1) {
      const now = new Date().toISOString();
      let cursor = 0;

      if (sql.match(/SET\s+stop_time\s*=\s*CURRENT_TIMESTAMP/i)) {
        memoryDB.user_sessions[idx].stop_time = now;
      }

      if (sql.match(/duration\s*=\s*\?/i)) {
        memoryDB.user_sessions[idx].duration = params[cursor];
        cursor += 1;
      }

      if (sql.match(/location\s*=\s*\?/i)) {
        memoryDB.user_sessions[idx].location = params[cursor];
        cursor += 1;
      }

      if (sql.match(/battery\s*=\s*\?/i)) {
        memoryDB.user_sessions[idx].battery = params[cursor];
        cursor += 1;
      }

      if (sql.match(/device\s*=\s*\?/i)) {
        memoryDB.user_sessions[idx].device = params[cursor];
        cursor += 1;
      }

      memoryDB.user_sessions[idx].updated_at = now;
    }
    return [];
  }

  if (s.startsWith('UPDATE APPROVAL_REQUESTS')) {
    const whereId = sql.match(/WHERE id\s*=\s*\?/i);
    const whereStatus = sql.match(/AND\s+status\s*=\s*\?/i);
    const requestId = whereId
      ? (whereStatus ? params[params.length - 2] : params[params.length - 1])
      : params[0];
    const idx = memoryDB.approval_requests.findIndex(r => r.id === requestId);
    if (idx !== -1) {
      const expectedStatus = whereStatus ? params[params.length - 1] : null;
      if (expectedStatus && memoryDB.approval_requests[idx].status !== expectedStatus) {
        return [];
      }
      memoryDB.approval_requests[idx].status = params[0];
      memoryDB.approval_requests[idx].reviewed_by_user_id = params[1];
      memoryDB.approval_requests[idx].reviewed_at = new Date().toISOString();
      memoryDB.approval_requests[idx].decision_note = params[2] || null;
      memoryDB.approval_requests[idx].updated_at = new Date().toISOString();
    }
    return [];
  }

  if (s.startsWith('DELETE FROM CONVERSATIONS')) {
    memoryDB.conversations = memoryDB.conversations.filter(c => c.id !== params[0]);
    memoryDB.messages = memoryDB.messages.filter(m => m.conversation_id !== params[0]);
    return [];
  }

  if (s.startsWith('DELETE FROM APPROVAL_REQUESTS')) {
    memoryDB.approval_requests = memoryDB.approval_requests.filter(r => r.id !== params[0]);
    memoryDB.approval_audit_log = memoryDB.approval_audit_log.filter(a => a.approval_request_id !== params[0]);
    return [];
  }

  return [];
}

// ──────────────────────────────────────────────
//  PostgreSQL pool (only created if PG is available)
// ──────────────────────────────────────────────
let pool: any = null;
const DB_NOT_READY_CODE = 'DB_NOT_READY';

function createDatabaseNotReadyError(): Error {
  const error: any = new Error('Database is initializing');
  error.code = DB_NOT_READY_CODE;
  return error;
}

function ensurePoolReady(): void {
  if (useInMemory) {
    return;
  }

  if (!pool) {
    throw createDatabaseNotReadyError();
  }
}

export function isDatabaseNotReadyError(error: unknown): boolean {
  return (error as any)?.code === DB_NOT_READY_CODE;
}

async function tryLoadPg(config: any): Promise<boolean> {
  try {
    const { Pool, types } = await import('pg');

    // PostgreSQL TIMESTAMP (without timezone, OID 1114) should be interpreted as UTC.
    // Without this, Node may parse it in local server timezone and skew recency checks.
    types.setTypeParser(1114, (value: string) => new Date(`${value}Z`));

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
        lark_avatar_url TEXT,
        custom_avatar_url TEXT,
        avatar_updated_at TIMESTAMP,
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
      ALTER TABLE users ADD COLUMN IF NOT EXISTS lark_avatar_url TEXT
    `).catch(() => {
      // Column may already exist — ignore error
    });
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_avatar_url TEXT
    `).catch(() => {
      // Column may already exist — ignore error
    });
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMP
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        request_type TEXT NOT NULL,
        requested_by_user_id TEXT NOT NULL,
        requested_by_lark_id TEXT,
        reason TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by_user_id TEXT,
        reviewed_at TIMESTAMP,
        decision_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_audit_log (
        id TEXT PRIMARY KEY,
        approval_request_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        metadata_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
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
  ensurePoolReady();
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
  ensurePoolReady();
  const convertedSql = convertPlaceholders(sql);
  await pool.query(convertedSql, params);
}

export async function executeTransaction(
  statements: Array<{ sql: string; params?: any[] }>
): Promise<void> {
  if (!Array.isArray(statements) || statements.length === 0) {
    return;
  }

  if (useInMemory) {
    statements.forEach((statement) => {
      inMemoryQuery(statement.sql, statement.params || []);
    });
    return;
  }

  ensurePoolReady();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const statement of statements) {
      const convertedSql = convertPlaceholders(statement.sql);
      await client.query(convertedSql, statement.params || []);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
