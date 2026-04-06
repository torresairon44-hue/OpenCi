/**
 * USER LOCATION SERVICE
 * Provides real user location data from the database (from geolocation).
 * This replaces the scraper-based approach with direct database queries.
 */

import { runQuery } from './database';
import { getLocationFromCoordinates } from './location-service';

export interface UserLocationRecord {
  userId: string;
  username: string;
  role: 'admin' | 'fieldman' | 'unknown';
  latitude: number;
  longitude: number;
  address: string | null;
  lastUpdated: string;
}

export interface LocationLookupResult {
  found: boolean;
  data: UserLocationRecord | null;
  message: string;
}

interface SessionRow {
  user_id: string;
  username: string;
  role: string;
  location: string;
  updated_at: string;
}

/**
 * Parse location JSON from session
 */
function parseLocationJson(locationJson: string): { latitude: number; longitude: number } | null {
  if (!locationJson) return null;
  
  try {
    const parsed = JSON.parse(locationJson);
    
    // Handle format: { latitude: x, longitude: y }
    if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
      return { latitude: parsed.latitude, longitude: parsed.longitude };
    }
    
    // Handle format: { lat: x, lng: y }
    if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
      return { latitude: parsed.lat, longitude: parsed.lng };
    }
    
    // Handle format: { coords: { latitude: x, longitude: y } }
    if (parsed.coords && typeof parsed.coords.latitude === 'number') {
      return { latitude: parsed.coords.latitude, longitude: parsed.coords.longitude };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Get a user's most recent location by their name
 */
export async function getUserLocationByName(
  nameQuery: string,
  requestedRole?: 'admin' | 'fieldman'
): Promise<LocationLookupResult> {
  try {
    const searchPattern = `%${nameQuery.toLowerCase()}%`;
    
    // Query to get the most recent session with location for matching users
    let query = `
      SELECT 
        u.id as user_id,
        u.username,
        u.role,
        us.location,
        us.updated_at
      FROM users u
      INNER JOIN user_sessions us ON u.id = us.user_id
      WHERE LOWER(u.username) LIKE ?
        AND us.location IS NOT NULL
        AND us.location != ''
    `;
    
    const params: any[] = [searchPattern];
    
    if (requestedRole) {
      query += ` AND u.role = ?`;
      params.push(requestedRole);
    }
    
    query += ` ORDER BY us.updated_at DESC LIMIT 1`;
    
    const rows = await runQuery<SessionRow>(query, params);
    
    if (rows.length === 0) {
      // Check if user exists but has no location
      const userCheck = await runQuery<{ username: string; role: string }>(
        `SELECT username, role FROM users WHERE LOWER(username) LIKE ?`,
        [searchPattern]
      );
      
      if (userCheck.length > 0) {
        return {
          found: false,
          data: null,
          message: `${userCheck[0].username} is registered but hasn't shared their location yet.`
        };
      }
      
      return {
        found: false,
        data: null,
        message: `No user found matching "${nameQuery}". Please check the spelling.`
      };
    }
    
    const row = rows[0];
    const coords = parseLocationJson(row.location);
    
    if (!coords) {
      return {
        found: false,
        data: null,
        message: `${row.username}'s location data is invalid or incomplete.`
      };
    }
    
    // Reverse geocode to get address
    let address: string | null = null;
    try {
      const locationDetails = await getLocationFromCoordinates(coords.latitude, coords.longitude);
      if (locationDetails?.address) {
        address = locationDetails.address;
      }
    } catch (err) {
      console.log('Reverse geocoding failed:', err);
    }
    
    return {
      found: true,
      data: {
        userId: row.user_id,
        username: row.username,
        role: row.role as 'admin' | 'fieldman' | 'unknown',
        latitude: coords.latitude,
        longitude: coords.longitude,
        address,
        lastUpdated: row.updated_at
      },
      message: 'Location found.'
    };
  } catch (error) {
    console.error('Error fetching user location:', error);
    return {
      found: false,
      data: null,
      message: 'Unable to retrieve location data at this time.'
    };
  }
}

/**
 * Get all users with their most recent locations
 */
export async function getAllUserLocations(
  roleFilter?: 'admin' | 'fieldman'
): Promise<UserLocationRecord[]> {
  try {
    let query = `
      SELECT DISTINCT ON (u.id)
        u.id as user_id,
        u.username,
        u.role,
        us.location,
        us.updated_at
      FROM users u
      INNER JOIN user_sessions us ON u.id = us.user_id
      WHERE us.location IS NOT NULL
        AND us.location != ''
    `;
    
    const params: any[] = [];
    
    if (roleFilter) {
      query += ` AND u.role = ?`;
      params.push(roleFilter);
    }
    
    query += ` ORDER BY u.id, us.updated_at DESC`;
    
    const rows = await runQuery<SessionRow>(query, params);
    
    const results: UserLocationRecord[] = [];
    
    for (const row of rows) {
      const coords = parseLocationJson(row.location);
      if (!coords) continue;
      
      results.push({
        userId: row.user_id,
        username: row.username,
        role: row.role as 'admin' | 'fieldman' | 'unknown',
        latitude: coords.latitude,
        longitude: coords.longitude,
        address: null, // Skip reverse geocoding for bulk queries
        lastUpdated: row.updated_at
      });
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching all user locations:', error);
    return [];
  }
}

/**
 * Format location for display in chat
 */
export function formatLocationResponse(
  result: LocationLookupResult,
  includeAddress: boolean = true
): string {
  if (!result.found || !result.data) {
    return result.message;
  }
  
  const { username, role, latitude, longitude, address, lastUpdated } = result.data;
  const coords = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  const roleLabel = role === 'admin' ? 'Admin' : role === 'fieldman' ? 'Fieldman' : role;
  
  // Calculate how fresh the location is
  const updatedDate = new Date(lastUpdated);
  const now = new Date();
  const minutesAgo = Math.floor((now.getTime() - updatedDate.getTime()) / 60000);
  
  let freshnessNote = '';
  if (minutesAgo < 5) {
    freshnessNote = ' (just now)';
  } else if (minutesAgo < 60) {
    freshnessNote = ` (${minutesAgo} minutes ago)`;
  } else if (minutesAgo < 1440) {
    const hoursAgo = Math.floor(minutesAgo / 60);
    freshnessNote = ` (${hoursAgo} hour${hoursAgo > 1 ? 's' : ''} ago)`;
  }
  
  if (includeAddress && address) {
    return `${username} (${roleLabel}) is located at: ${address}. Coordinates: ${coords}${freshnessNote}`;
  }
  
  return `${username} (${roleLabel}) coordinates: ${coords}${freshnessNote}`;
}
