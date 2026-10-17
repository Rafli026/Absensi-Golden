// Audit log listing (admin).
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

export function auditRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('admin'));

  router.get('/', (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const total = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
      const logs = db
        .prepare(
          `SELECT id, actor_id, actor_name, action, entity, entity_id, detail, ip, created_at
           FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?`
        )
        .all(limit, offset);
      return res.json({ logs, total });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
