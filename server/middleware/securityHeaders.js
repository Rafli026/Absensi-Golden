// Security headers for every response (no external dependencies).
//
// CSP notes:
// - 'unsafe-inline' for script-src is required: pages ship a small inline
//   theme bootstrap and use <script type="module">.
// - 'unsafe-inline' for style-src is required for inline style attributes
//   used by the UI.
// - 'unsafe-eval' is NOT allowed. 'wasm-unsafe-eval' is required because
//   tfjs probes/loads its WebAssembly backend (Chromium reports this as a
//   script-src violation otherwise); it permits WASM compilation only,
//   not JavaScript eval.
// - worker-src/connect-src allow blob: because tfjs/face-api may spawn
//   blob workers and read model weights from the same origin.

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const HSTS = 'max-age=31536000; includeSubDomains';

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);

  // Only send HSTS in production: it would break plain-HTTP localhost in dev.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', HSTS);
  }

  return next();
}
