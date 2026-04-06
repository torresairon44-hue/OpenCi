/**
 * USER DATA SERVICE
 * Provides REAL user data from the database for AI responses.
 * This prevents hallucination by grounding responses in actual data.
 */

import { runQuery } from './database';

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'fieldman' | 'unknown';
  lark_id: string | null;
  created_at: string;
}

export interface UserListResult {
  success: boolean;
  data: UserRecord[];
  total: number;
  message: string;
}

/**
 * Get all admins from the database
 */
export async function getAdmins(): Promise<UserListResult> {
  try {
    const rows = await runQuery<UserRecord>(
      `SELECT id, username, email, role, lark_id, created_at 
       FROM users 
       WHERE role = ? 
       ORDER BY username ASC`,
      ['admin']
    );
    
    return {
      success: true,
      data: rows,
      total: rows.length,
      message: rows.length > 0 
        ? `Found ${rows.length} admin(s) in the system.`
        : 'No admins found in the system.'
    };
  } catch (error) {
    console.error('Error fetching admins:', error);
    return {
      success: false,
      data: [],
      total: 0,
      message: 'Unable to retrieve admin list at this time.'
    };
  }
}

/**
 * Get all fieldmen from the database
 */
export async function getFieldmen(): Promise<UserListResult> {
  try {
    const rows = await runQuery<UserRecord>(
      `SELECT id, username, email, role, lark_id, created_at 
       FROM users 
       WHERE role = ? 
       ORDER BY username ASC`,
      ['fieldman']
    );
    
    return {
      success: true,
      data: rows,
      total: rows.length,
      message: rows.length > 0 
        ? `Found ${rows.length} fieldman/fieldmen in the system.`
        : 'No fieldmen found in the system.'
    };
  } catch (error) {
    console.error('Error fetching fieldmen:', error);
    return {
      success: false,
      data: [],
      total: 0,
      message: 'Unable to retrieve fieldman list at this time.'
    };
  }
}

/**
 * Get all users (admins + fieldmen) from the database
 */
export async function getAllUsers(): Promise<UserListResult> {
  try {
    const rows = await runQuery<UserRecord>(
      `SELECT id, username, email, role, lark_id, created_at 
       FROM users 
       WHERE role IN (?, ?) 
       ORDER BY role ASC, username ASC`,
      ['admin', 'fieldman']
    );
    
    return {
      success: true,
      data: rows,
      total: rows.length,
      message: rows.length > 0 
        ? `Found ${rows.length} user(s) in the system.`
        : 'No users found in the system.'
    };
  } catch (error) {
    console.error('Error fetching all users:', error);
    return {
      success: false,
      data: [],
      total: 0,
      message: 'Unable to retrieve user list at this time.'
    };
  }
}

/**
 * Search users by name
 */
export async function searchUsersByName(nameQuery: string): Promise<UserListResult> {
  try {
    const searchPattern = `%${nameQuery.toLowerCase()}%`;
    const rows = await runQuery<UserRecord>(
      `SELECT id, username, email, role, lark_id, created_at 
       FROM users 
       WHERE LOWER(username) LIKE ? 
       ORDER BY username ASC`,
      [searchPattern]
    );
    
    return {
      success: true,
      data: rows,
      total: rows.length,
      message: rows.length > 0 
        ? `Found ${rows.length} user(s) matching "${nameQuery}".`
        : `No users found matching "${nameQuery}".`
    };
  } catch (error) {
    console.error('Error searching users:', error);
    return {
      success: false,
      data: [],
      total: 0,
      message: 'Unable to search users at this time.'
    };
  }
}

/**
 * Format user list for AI context injection
 * Returns a string suitable for including in AI prompts
 */
export function formatUserListForAI(result: UserListResult): string {
  if (!result.success) {
    return `[DATABASE ERROR: ${result.message}]`;
  }
  
  if (result.data.length === 0) {
    return `[NO DATA: ${result.message}]`;
  }
  
  const formatted = result.data.map((user, index) => {
    const roleLabel = user.role === 'admin' ? 'Admin' : 'Fieldman';
    return `${index + 1}. ${user.username} - ${roleLabel}`;
  }).join('\n');
  
  return `[VERIFIED DATABASE DATA - ${result.total} users]\n${formatted}`;
}

/**
 * Detect if a user message is asking for user/admin/fieldman lists
 */
export function detectsUserListRequest(message: string): {
  isUserListRequest: boolean;
  requestType: 'admins' | 'fieldmen' | 'all' | 'search' | null;
  searchQuery: string | null;
} {
  const lower = message.toLowerCase();
  
  // Check for admin list requests
  if (/\b(list|give|show|who\s+are|sino|ilan)\b.*\b(all\s+)?(the\s+)?admins?\b/i.test(lower) ||
      /\badmins?\b.*\b(list|names?|sino)\b/i.test(lower)) {
    return { isUserListRequest: true, requestType: 'admins', searchQuery: null };
  }
  
  // Check for fieldman/fieldmen list requests
  if (/\b(list|give|show|who\s+are|sino|ilan)\b.*\b(all\s+)?(the\s+)?field\s*m[ae]n\b/i.test(lower) ||
      /\bfield\s*m[ae]n\b.*\b(list|names?|sino)\b/i.test(lower)) {
    return { isUserListRequest: true, requestType: 'fieldmen', searchQuery: null };
  }
  
  // Check for all users request
  if (/\b(list|give|show)\b.*\b(all\s+)?(the\s+)?(users?|employees?|staff|agents?)\b/i.test(lower) ||
      /\b(admins?\s+and\s+field\s*m[ae]n|field\s*m[ae]n\s+and\s+admins?)\b/i.test(lower)) {
    return { isUserListRequest: true, requestType: 'all', searchQuery: null };
  }
  
  return { isUserListRequest: false, requestType: null, searchQuery: null };
}
