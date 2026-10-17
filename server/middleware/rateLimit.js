// In-memory sliding-window rate limiter.

/**
 * Factory for an Express middleware that limits requests per key within a window.
 * key(req) -> string
 */
export function rateLimit({ windowMs = 60_000, max = 60, key = (req) => req.ip, message } = {}) {
  const buckets = new Map(); // key -> number[] timestamps

  // Periodic cleanup to avoid unbounded growth.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of buckets) {
      const kept = arr.filter((t) => now - t < windowMs);
      if (kept.length === 0) buckets.delete(k);
      else buckets.set(k, kept);
    }
  }, Math.max(windowMs, 60_000));
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    try {
      const k = String(key(req));
      const now = Date.now();
      const arr = (buckets.get(k) || []).filter((t) => now - t < windowMs);
      if (arr.length >= max) {
        return res
          .status(429)
          .json({ error: message || 'Terlalu banyak permintaan, coba lagi sebentar lagi' });
      }
      arr.push(now);
      buckets.set(k, arr);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
