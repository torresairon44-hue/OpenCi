import { v4 as uuidv4 } from 'uuid';
import { executeQuery, runQuery } from './database';

export interface SessionInfo {
  location?: string; // JSON string
  battery?: string;
  device?: string; // JSON string
}

/**
 * Starts a new user tracking session in the database.
 * @param userId The ID of the user starting the session.
 * @returns The unique session ID.
 */
export async function startSession(userId: string): Promise<string> {
  const sessionId = uuidv4();
  const id = uuidv4();
  
  await executeQuery(
    `INSERT INTO user_sessions (id, user_id, session_id) VALUES (?, ?, ?)`,
    [id, userId, sessionId]
  );
  
  return sessionId;
}

/**
 * Updates an active session with new environmental metadata.
 * @param sessionId The active session ID.
 * @param info The data to update (location, battery, device).
 */
export async function updateSessionInfo(sessionId: string, info: SessionInfo): Promise<void> {
  // Use coalesce or similar logic to only update provided fields
  // Since we don't have a sophisticated ORM, we'll build the query dynamically
  const updates: string[] = [];
  const params: any[] = [];
  
  if (info.location !== undefined) {
    updates.push('location = ?');
    params.push(info.location);
  }
  
  if (info.battery !== undefined) {
    updates.push('battery = ?');
    params.push(info.battery);
  }
  
  if (info.device !== undefined) {
    updates.push('device = ?');
    params.push(info.device);
  }
  
  if (updates.length === 0) return;
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(sessionId);
  
  const setClause = updates.join(', ');
  
  await executeQuery(
    `UPDATE user_sessions SET ${setClause} WHERE session_id = ?`,
    params
  );
}

/**
 * Stops an active session, calculating its duration.
 * @param sessionId The session ID to stop.
 */
export async function stopSession(sessionId: string): Promise<void> {
  const records = await runQuery<any>(
    `SELECT start_time FROM user_sessions WHERE session_id = ?`,
    [sessionId]
  );
  
  if (records.length === 0 || !records[0].start_time) {
    console.warn(`Attempted to stop non-existent or invalid session: ${sessionId}`);
    return; // Fast fail without throwing 500
  }
  
  const startTime = new Date(records[0].start_time);
  const stopTime = new Date();
  const durationSeconds = Math.floor((stopTime.getTime() - startTime.getTime()) / 1000);
  
  await executeQuery(
    `UPDATE user_sessions 
     SET stop_time = CURRENT_TIMESTAMP, duration = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE session_id = ?`,
    [durationSeconds, sessionId]
  );
}
