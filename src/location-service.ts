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
 * Get location from coordinates (reverse geocoding)
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
        format: 'json'
      },
      timeout: 5000,
      headers: {
        'User-Agent': 'OpenCI-Chatbot/1.0'
      }
    });

    if (response.data) {
      const result = response.data;
      return {
        latitude,
        longitude,
        address: result.display_name,
        city: extractCity(result.display_name),
        country: extractCountry(result.display_name)
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
