// Haversine great-circle distance in meters.

const EARTH_RADIUS_M = 6371008.8;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Distance in meters between two lat/lng points.
 */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
