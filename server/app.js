// Express app factory. createApp(db) -> app (used by both index.js and tests).
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { errorHandler } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { checkOrigin } from './middleware/checkOrigin.js';
import { rateLimit } from './middleware/rateLimit.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { employeesRouter } from './routes/employees.js';
import { branchesRouter } from './routes/branches.js';
import { attendanceRouter } from './routes/attendance.js';
import { faceRouter } from './routes/face.js';
import { dashboardRouter } from './routes/dashboard.js';
import { settingsRouter } from './routes/settings.js';
import { exportRouter } from './routes/export.js';
import { auditRouter } from './routes/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export function createApp(db) {
  const app = express();

  app.disable('x-powered-by');
  // One reverse-proxy hop (Caddy/Nginx) in front: trust X-Forwarded-* so
  // req.ip is the client IP and Secure cookies work over HTTPS.
  const hops = Number(process.env.TRUST_PROXY ?? 1);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));

  // Static assets
  app.use(express.static(resolve(ROOT, 'public')));
  app.use(
    '/vendor/face-api',
    express.static(resolve(ROOT, 'node_modules/@vladmandic/face-api'))
  );
  app.use('/vendor/jsqr', express.static(resolve(ROOT, 'node_modules/jsqr/dist')));

  // API routes
  // Global safety net so no API endpoint is unbounded; per-route limiters
  // (login, face verify) stay stricter.
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600 }));
  app.use('/api', checkOrigin);
  app.use('/api', healthRouter(db));
  app.use('/api/auth', authRouter(db));
  app.use('/api/employees', employeesRouter(db));
  app.use('/api/branches', branchesRouter(db));
  app.use('/api/attendance', attendanceRouter(db));
  app.use('/api/face', faceRouter(db));
  app.use('/api/dashboard', dashboardRouter(db));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/export', exportRouter(db));
  app.use('/api/audit-logs', auditRouter(db));

  // 404 for unknown API paths
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan' });
  });

  // HTML 404 fallback for non-API GET requests
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.status(404).sendFile(resolve(ROOT, 'public/404.html'));
    }
    return next();
  });

  // Error handler (last)
  app.use(errorHandler);

  return app;
}
