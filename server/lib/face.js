// Face descriptor math: euclidean distance and best match.

/** Euclidean distance between two equal-length numeric arrays. */
export function euclideanDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return Infinity;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Find the closest profile.
 * descriptors: [{ employee_id, employee_name, descriptor: number[] }]
 * target: number[]
 * threshold: number
 * Returns { matched, profile, distance } or { matched:false, distance }.
 */
export function bestMatch(descriptors, target, threshold) {
  let best = null;
  let bestDist = Infinity;
  for (const row of descriptors) {
    const dist = euclideanDistance(row.descriptor, target);
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }
  if (best && bestDist <= threshold) {
    return { matched: true, profile: best, distance: bestDist };
  }
  return { matched: false, profile: best, distance: bestDist };
}

/** Validate a descriptor: array of exactly 128 finite numbers. */
export function isValidDescriptor(d) {
  if (!Array.isArray(d) || d.length !== 128) return false;
  for (const n of d) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  }
  return true;
}
