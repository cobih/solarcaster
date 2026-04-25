/**
 * Solarcaster Security Utilities
 * Centralized sanitization for all external data inputs.
 */

/**
 * Strips HTML tags and trims whitespace from a string.
 */
export const sanitizeString = (val) => {
  if (typeof val !== 'string') return "";
  return val.replace(/<[^>]*>?/gm, '').trim();
};

/**
 * Ensures coordinates are valid numbers and within geographical bounds.
 */
export const sanitizeCoords = (lat, long) => {
  const sLat = parseFloat(lat);
  const sLong = parseFloat(long);
  
  if (isNaN(sLat) || sLat < -90 || sLat > 90) return { lat: 53.3767, long: -6.3286 }; // Fallback to default
  if (isNaN(sLong) || sLong < -180 || sLong > 180) return { lat: 53.3767, long: -6.3286 };
  
  return { lat: sLat, long: sLong };
};

/**
 * Validates a configuration object before saving to cloud.
 */
export const sanitizeConfig = (config) => {
  return {
    ...config,
    lat: parseFloat(config.lat) || 53.3767,
    long: parseFloat(config.long) || -6.3286,
    eff: Math.min(1, Math.max(0.1, parseFloat(config.eff) || 0.85)),
    locationName: sanitizeString(config.locationName || "Unknown"),
    locationSet: !!config.locationSet, // Track if user has completed setup
    arraysSet: !!config.arraysSet,
    apiEnabled: !!config.apiEnabled,
    excludedDays: Array.isArray(config.excludedDays) ? config.excludedDays : [],
    acknowledgedOutliers: Array.isArray(config.acknowledgedOutliers) ? config.acknowledgedOutliers : [],
    schemaVersion: 2, // Force current schema
    strings: (config.strings || []).map(s => ({
      ...s,
      name: sanitizeString(s.name),
      azimuth: parseInt(s.azimuth) || 0,
      tilt: Math.min(90, Math.max(0, parseInt(s.tilt) || 35)),
      count: Math.max(0, parseInt(s.count) || 0)
    }))
  };
};
