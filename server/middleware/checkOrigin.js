// Lightweight CSRF defense for state-changing API requests.
//
// The auth cookie is HttpOnly + SameSite=Lax, which already blocks most
// cross-site form posts. As an extra layer, if a browser sends an Origin
// header on a mutating /api request, it must match the Host we are serving.
// Requests without Origin (curl, server-to-server, tests) are allowed.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function checkOrigin(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  // This middleware is mounted at /api, so req.path is already stripped.
  if (!req.originalUrl.startsWith('/api/')) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Origin tidak diizinkan' });
  }

  const host = req.headers.host;
  if (!host || originHost !== host) {
    return res.status(403).json({ error: 'Origin tidak diizinkan' });
  }

  return next();
}
