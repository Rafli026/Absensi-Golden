// Face profile management + verification.
import { Router } from 'express';
import { isoUtc } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import { bestMatch, isValidDescriptor } from '../lib/face.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { int } from '../lib/validate.js';
import { getSetting } from '../db.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

function safeJson(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function faceRouter(db) {
  const router = Router();
  router.use(requireAuth(db));

  const verifyLimiter = rateLimit({
    windowMs: 10_000,
    max: 10,
    key: (req) => `face-verify:${req.user.id}`,
    message: 'Terlalu banyak permintaan verifikasi, coba lagi sebentar lagi',
  });

  // Register / update a face descriptor (admin).
  router.post('/register', requireRole('admin'), (req, res, next) => {
    try {
      const body = req.body || {};
      const employeeId = int(body.employee_id, 'employee_id', { min: 1 });
      if (!isValidDescriptor(body.descriptor)) {
        throw new ApiError(400, 'Descriptor wajah harus berupa 128 angka yang valid');
      }
      const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
      if (!employee) throw new ApiError(404, 'Karyawan tidak ditemukan');

      const descriptorJson = JSON.stringify(body.descriptor);
      const now = isoUtc();
      const existing = db.prepare('SELECT * FROM face_profiles WHERE employee_id = ?').get(employeeId);
      let sampleCount = 1;
      if (existing) {
        sampleCount = (existing.sample_count || 1) + 1;
        db.prepare('UPDATE face_profiles SET descriptor = ?, sample_count = ?, updated_at = ? WHERE employee_id = ?')
          .run(descriptorJson, sampleCount, now, employeeId);
      } else {
        db.prepare('INSERT INTO face_profiles (employee_id, descriptor, sample_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(employeeId, descriptorJson, 1, now, now);
      }
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'face_register',
        entity: 'face_profile', entityId: employeeId, detail: { employee_id: employeeId }, ip: clientIp(req),
      });
      return res.json({ ok: true, sample_count: sampleCount });
    } catch (err) {
      return next(err);
    }
  });

  // List profiles (admin) - never returns descriptors.
  router.get('/profiles', requireRole('admin'), (req, res, next) => {
    try {
      const rows = db
        .prepare(
          `SELECT fp.employee_id, e.employee_code, u.full_name AS employee_name, fp.sample_count, fp.updated_at
           FROM face_profiles fp
           JOIN employees e ON e.id = fp.employee_id
           JOIN users u ON u.id = e.user_id
           ORDER BY u.full_name`
        )
        .all();
      return res.json({ profiles: rows });
    } catch (err) {
      return next(err);
    }
  });

  // Delete a profile (admin).
  router.delete('/profiles/:employeeId', requireRole('admin'), (req, res, next) => {
    try {
      const employeeId = int(req.params.employeeId, 'employeeId', { min: 1 });
      const existing = db.prepare('SELECT id FROM face_profiles WHERE employee_id = ?').get(employeeId);
      if (!existing) throw new ApiError(404, 'Profil wajah tidak ditemukan');
      db.prepare('DELETE FROM face_profiles WHERE employee_id = ?').run(employeeId);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'face_delete',
        entity: 'face_profile', entityId: employeeId, ip: clientIp(req),
      });
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  // Verify a descriptor (any auth). Does NOT create attendance.
  router.post('/verify', verifyLimiter, (req, res, next) => {
    try {
      const body = req.body || {};
      if (!isValidDescriptor(body.descriptor)) {
        throw new ApiError(400, 'Data wajah tidak valid');
      }
      const threshold = Number(getSetting(db, 'face_match_threshold', '0.5'));
      const profiles = db.prepare('SELECT employee_id, descriptor FROM face_profiles').all().map((p) => ({
        employee_id: p.employee_id,
        descriptor: safeJson(p.descriptor, []),
      }));
      const match = bestMatch(profiles, body.descriptor, threshold);
      if (!match.matched) {
        return res.json({ matched: false, distance: Number.isFinite(match.distance) ? match.distance : null });
      }
      const employee = db
        .prepare(
          `SELECT e.id, e.employee_code, u.full_name
           FROM employees e JOIN users u ON u.id = e.user_id
           WHERE e.id = ? AND e.is_active = 1`
        )
        .get(match.profile.employee_id);
      if (!employee) {
        return res.json({ matched: false });
      }
      return res.json({
        matched: true,
        employee: { id: employee.id, full_name: employee.full_name, employee_code: employee.employee_code },
        distance: match.distance,
      });
    } catch (err) {
      return next(err);
    }
  });

  // Self status (auth).
  router.get('/status', (req, res, next) => {
    try {
      if (!req.user.employee_id) {
        return res.json({ registered: false, employee_id: null });
      }
      const row = db.prepare('SELECT id FROM face_profiles WHERE employee_id = ?').get(req.user.employee_id);
      return res.json({ registered: !!row, employee_id: req.user.employee_id });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
