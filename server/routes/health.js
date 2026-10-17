// Public operational endpoints: health check + frontend bootstrap config.
import { readFileSync } from 'node:fs';
import { Router } from 'express';

import { getSetting } from '../db.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const VERSION = pkg.version || '0.0.0';

export function healthRouter(db) {
  const router = Router();

  // Liveness/readiness probe. Never expose paths, Node version, or env.
  router.get('/health', (req, res) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
    } catch {
      return res.status(503).json({ status: 'error', db: 'fail' });
    }
    return res.json({
      status: 'ok',
      uptime: process.uptime(),
      db: 'ok',
      version: VERSION,
    });
  });

  // Public config for the frontend (no credentials, no secrets).
  router.get('/public/config', (req, res) => {
    let companyName = 'New Golden Bakery & Cakes';
    try {
      companyName = getSetting(db, 'company_name', companyName) || companyName;
    } catch {
      /* fall back to default */
    }
    return res.json({
      company_name: companyName,
      demo_mode: process.env.NODE_ENV !== 'production',
    });
  });

  return router;
}
