import axios from 'axios';

interface LocationCoordinates {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  country?: string;
}

/**
 * Get coordinates from location name using Nominatim (OpenStreetMap)
 * Free to use, no API key required
 */
export async function getCoordinates(locationName: string): Promise<LocationCoordinates | null> {
  if (!locationName || locationName.trim().length === 0) {
    return null;
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: locationName,
        format: 'json',
        limit: 1
      },
      timeout: 5000,
      headers: {
        'User-Agent': 'OpenCI-Chatbot/1.0'
      }
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        address: result.display_name,
        city: extractCity(result.display_name),
        country: extractCountry(result.display_name)
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching coordinates:', error);
    return null;
  }
}

/**
 * Build a clean street-level address from Nominatim's structured address object.
 * This intentionally excludes commercial POI names (restaurants, stores, etc.)
 * by only using geographic components like road, suburb, city, etc.
 */
function buildCleanAddress(addressObj: Record<string, string | undefined>): string {
  if (!addressObj || typeof addressObj !== 'object') return '';

  const parts: string[] = [];

  // House number + road
  if (addressObj.house_number) parts.push(addressObj.house_number);
  if (addressObj.road) parts.push(addressObj.road);

  // Neighbourhood / suburb / barangay
  if (addressObj.neighbourhood) parts.push(addressObj.neighbourhood);
  else if (addressObj.suburb) parts.push(addressObj.suburb);

  // City / town / municipality
  const city = addressObj.city || addressObj.town || addressObj.municipality || addressObj.village;
  if (city) parts.push(city);

  // State / region / province
  if (addressObj.state) parts.push(addressObj.state);

  // Country
  if (addressObj.country) parts.push(addressObj.country);

  return parts.join(', ');
}

/**
 * Get location from coordinates (reverse geocoding).
 * Uses structured address fields to produce clean street addresses
 * that exclude commercial establishment names.
 */
export async function getLocationFromCoordinates(
  latitude: number,
  longitude: number
): Promise<LocationCoordinates | null> {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat: latitude,
        lon: longitude,
        format: 'json',
        addressdetails: 1,
      },
      timeout: 5000,
      headers: {
        'User-Agent': 'OpenCI-Chatbot/1.0'
      }
    });

    if (response.data) {
      const result = response.data;
      const structuredAddr = result.address || {};

      // Build clean address from structured components (no POI names)
      const cleanAddress = buildCleanAddress(structuredAddr);
      const finalAddress = cleanAddress || result.display_name || '';

      const city = structuredAddr.city || structuredAddr.town || structuredAddr.municipality || extractCity(result.display_name || '');
      const country = structuredAddr.country || extractCountry(result.display_name || '');

      return {
        latitude,
        longitude,
        address: finalAddress,
        city,
        country
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting location from coordinates:', error);
    return null;
  }
}

/**
 * Format coordinates for display
 */
export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * Helper to extract city from address
 */
function extractCity(address: string): string {
  const parts = address.split(',');
  // Typically city is in the second or third part
  if (parts.length >= 2) {
    return parts[parts.length - 3]?.trim() || '';
  }
  return '';
}

/**
 * Helper to extract country from address
 */
function extractCountry(address: string): string {
  const parts = address.split(',');
  // Country is typically the last part
  if (parts.length > 0) {
    return parts[parts.length - 1]?.trim() || '';
  }
  return '';
}
