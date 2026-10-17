// Branch management (admin only).
import { Router } from 'express';
import { isoUtc } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { str, int, num } from '../lib/validate.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

function mapBranch(b) {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    latitude: b.latitude,
    longitude: b.longitude,
    radius_meters: b.radius_meters,
    is_active: !!b.is_active,
  };
}

export function branchesRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('admin'));

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM branches ORDER BY id').all();
    return res.json({ branches: rows.map(mapBranch) });
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body || {};
      const name = str(body.name, 'name', { max: 150 });
      const address = body.address ? str(body.address, 'address', { required: false, max: 255 }) : null;
      const latitude = body.latitude !== undefined && body.latitude !== null && body.latitude !== ''
        ? num(body.latitude, 'latitude', { min: -90, max: 90 })
        : null;
      const longitude = body.longitude !== undefined && body.longitude !== null && body.longitude !== ''
        ? num(body.longitude, 'longitude', { min: -180, max: 180 })
        : null;
      const radius = body.radius_meters !== undefined
        ? int(body.radius_meters, 'radius_meters', { min: 1, max: 100000 })
        : 100;
      const now = isoUtc();
      const id = db
        .prepare(
          `INSERT INTO branches (name, address, latitude, longitude, radius_meters, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(name, address, latitude, longitude, radius, now, now).lastInsertRowid;
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'branch_create',
        entity: 'branch', entityId: id, detail: { name }, ip: clientIp(req),
      });
      const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
      return res.status(201).json({ branch: mapBranch(branch) });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
      if (!branch) throw new ApiError(404, 'Cabang tidak ditemukan');
      const body = req.body || {};
      const fields = {};
      if (body.name !== undefined) fields.name = str(body.name, 'name', { max: 150 });
      if (body.address !== undefined) fields.address = body.address ? str(body.address, 'address', { required: false, max: 255 }) : null;
      if (body.latitude !== undefined) fields.latitude = body.latitude === null || body.latitude === '' ? null : num(body.latitude, 'latitude', { min: -90, max: 90 });
      if (body.longitude !== undefined) fields.longitude = body.longitude === null || body.longitude === '' ? null : num(body.longitude, 'longitude', { min: -180, max: 180 });
      if (body.radius_meters !== undefined) fields.radius_meters = int(body.radius_meters, 'radius_meters', { min: 1, max: 100000 });
      if (body.is_active !== undefined) fields.is_active = body.is_active ? 1 : 0;

      const keys = Object.keys(fields);
      if (keys.length === 0) throw new ApiError(400, 'Tidak ada field yang diubah');
      fields.updated_at = isoUtc();
      const setClause = keys.concat('updated_at').map((k) => `${k} = ?`).join(', ');
      const values = keys.concat('updated_at').map((k) => fields[k]);
      db.prepare(`UPDATE branches SET ${setClause} WHERE id = ?`).run(...values, id);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'branch_update',
        entity: 'branch', entityId: id, detail: fields, ip: clientIp(req),
      });
      const updated = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
      return res.json({ branch: mapBranch(updated) });
    } catch (err) {
      return next(err);
    }
  });

  // Soft delete.
  router.delete('/:id', (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
      if (!branch) throw new ApiError(404, 'Cabang tidak ditemukan');
      db.prepare('UPDATE branches SET is_active = 0, updated_at = ? WHERE id = ?').run(isoUtc(), id);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'branch_delete',
        entity: 'branch', entityId: id, ip: clientIp(req),
      });
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
