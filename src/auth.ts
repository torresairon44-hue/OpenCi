import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { runQuery, executeQuery } from './database';
import { startSession, updateSessionInfo, stopSession } from './session-service';

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const LARK_APP_ID = process.env.LARK_APP_ID || '';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || '';
let JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET || JWT_SECRET === 'change-this-secret-in-production') {
  console.error('⚠ JWT_SECRET is missing or using a placeholder. Using an in-memory fallback secret for this runtime.');
  console.error('⚠ Set a strong JWT_SECRET in Railway Variables to avoid session invalidation on restart.');
  JWT_SECRET = randomBytes(32).toString('hex');
}
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export const authRouter = Router();

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

// ─────────────────────────────────────────────────────────────
// GET /api/auth/lark — Redirect user to Lark OAuth consent page
// ─────────────────────────────────────────────────────────────
authRouter.get('/lark', (req: Request, res: Response) => {
  if (!LARK_APP_ID) {
    res.status(503).json({ error: 'Lark authentication is not configured. Set LARK_APP_ID in .env' });
    return;
  }
  // Build redirect URI from the actual request host so it works on LAN devices
  const protocol = req.protocol;
  const host = req.get('host');
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

    // Step 4: Upsert user in database
    const existing = await runQuery<any>(
      `SELECT id, role FROM users WHERE lark_id = ?`,
      [larkId]
    );

    let userId: string;
    let role: string;
    if (existing.length > 0) {
      userId = existing[0].id;
      role = existing[0].role || 'unknown'; // Keep existing role
      await executeQuery(
        `UPDATE users SET username = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [name, email, userId]
      );
    } else {
      userId = uuidv4();
      role = 'unknown'; // New user — role will be selected after login
      await executeQuery(
        `INSERT INTO users (id, username, email, role, lark_id) VALUES (?, ?, ?, ?, ?)`,
        [userId, name, email, role, larkId]
      );
    }

    // Step 5: Issue JWT and set as httpOnly cookie
    // Also start a tracking session
    const sessionId = await startSession(userId);
    const token = issueJwt({ userId, name, email, role, larkId, sessionId });
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
authRouter.get('/me', (req: Request, res: Response) => {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    res.json({ loggedIn: false });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    res.json({
      loggedIn: true,
      userId: payload.userId,
      name: payload.name,
      role: payload.role,
      email: payload.email,
      sessionId: payload.sessionId,
    });
  } catch {
    res.json({ loggedIn: false });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/logout — Clear JWT cookie
// ─────────────────────────────────────────────────────────────
authRouter.post('/logout', (_req: Request, res: Response) => {
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

  const { role } = req.body;
  if (role !== 'admin' && role !== 'fieldman') {
    res.status(400).json({ error: 'Role must be admin or fieldman' });
    return;
  }

  // Update role in DB
  await executeQuery(
    `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [role, payload.userId]
  );

  // Reissue JWT with updated role
  const newToken = issueJwt({
    userId: payload.userId,
    name: payload.name,
    email: payload.email,
    role,
    larkId: payload.larkId,
  });
  setAuthCookie(res, newToken);
  res.json({ success: true, role });
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

  if (!payload.sessionId) {
    res.status(400).json({ error: 'No active session' });
    return;
  }

  const { location, battery, device } = req.body;
  
  try {
    await updateSessionInfo(payload.sessionId, {
      location: location ? JSON.stringify(location) : undefined,
      battery: battery ? String(battery) : undefined,
      device: device ? JSON.stringify(device) : undefined,
    });
    res.json({ success: true });
  } catch (error) {
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

  if (!payload.sessionId) {
    res.status(400).json({ error: 'No active session' });
    return;
  }

  try {
    await stopSession(payload.sessionId);
    res.json({ success: true });
  } catch (error) {
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
  if (token) {
    try {
      (req as any).user = jwt.verify(token, JWT_SECRET);
    } catch {
      // Invalid/expired — treat as anonymous
    }
  }
  next();
}

// ─────────────────────────────────────────────────────────────
// Middleware: requireAuth
// Rejects unauthenticated requests with 401.
// ─────────────────────────────────────────────────────────────
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = (req as any).cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    (req as any).user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}
