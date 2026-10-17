// Settings routes: work schedule + location/general settings (admin).
import { Router } from 'express';
import { isoUtc } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { setSettings, getSetting } from '../db.js';
import { str, int, bool, num, enumOf } from '../lib/validate.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

function safeJson(s, fb) {
  try { return JSON.parse(s) ?? fb; } catch { return fb; }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATEKEY = /^\d{4}-\d{2}-\d{2}$/;

export function settingsRouter(db) {
  const router = Router();

  // Public (any authenticated user) subset.
  router.get('/public', requireAuth(db), (req, res) => {
    res.json({
      company_name: getSetting(db, 'company_name', 'New Golden Bakery & Cakes'),
      liveness_enabled: String(getSetting(db, 'liveness_enabled', 'true')) === 'true',
    });
  });

  router.use(requireAuth(db), requireRole('admin'));

  // --- Work schedule ---
  router.get('/work', (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM work_schedules WHERE is_active = 1 ORDER BY id LIMIT 1').get();
      if (!row) throw new ApiError(404, 'Jadwal kerja tidak ditemukan');
      return res.json({
        work_start: row.work_start,
        work_end: row.work_end,
        late_tolerance_minutes: row.late_tolerance_minutes,
        checkout_deadline: row.checkout_deadline,
        work_days: safeJson(row.work_days, [1, 2, 3, 4, 5, 6]),
        holidays: safeJson(row.holidays, []),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/work', (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM work_schedules WHERE is_active = 1 ORDER BY id LIMIT 1').get();
      if (!row) throw new ApiError(404, 'Jadwal kerja tidak ditemukan');
      const body = req.body || {};
      const fields = {};
      if (body.work_start !== undefined) {
        const v = str(body.work_start, 'work_start', { max: 5 });
        if (!HHMM.test(v)) throw new ApiError(400, 'Format jam kerja harus HH:mm');
        fields.work_start = v;
      }
      if (body.work_end !== undefined) {
        const v = str(body.work_end, 'work_end', { max: 5 });
        if (!HHMM.test(v)) throw new ApiError(400, 'Format jam kerja harus HH:mm');
        fields.work_end = v;
      }
      if (body.checkout_deadline !== undefined) {
        const v = str(body.checkout_deadline, 'checkout_deadline', { max: 5 });
        if (!HHMM.test(v)) throw new ApiError(400, 'Format jam pulang harus HH:mm');
        fields.checkout_deadline = v;
      }
      if (body.late_tolerance_minutes !== undefined) {
        fields.late_tolerance_minutes = int(body.late_tolerance_minutes, 'late_tolerance_minutes', { min: 0, max: 240 });
      }
      if (body.work_days !== undefined) {
        if (!Array.isArray(body.work_days)) throw new ApiError(400, 'work_days harus berupa array');
        const days = body.work_days.map((d) => {
          const n = Number(d);
          if (!Number.isInteger(n) || n < 1 || n > 7) throw new ApiError(400, 'work_days harus berisi angka 1-7');
          return n;
        });
        fields.work_days = JSON.stringify([...new Set(days)].sort((a, b) => a - b));
      }
      if (body.holidays !== undefined) {
        if (!Array.isArray(body.holidays)) throw new ApiError(400, 'holidays harus berupa array');
        for (const h of body.holidays) {
          if (typeof h !== 'string' || !DATEKEY.test(h)) throw new ApiError(400, 'Format tanggal libur harus YYYY-MM-DD');
        }
        fields.holidays = JSON.stringify(body.holidays);
      }
      const keys = Object.keys(fields);
      if (keys.length === 0) throw new ApiError(400, 'Tidak ada field yang diubah');
      fields.updated_at = isoUtc();
      const setClause = keys.concat('updated_at').map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE work_schedules SET ${setClause} WHERE id = ?`).run(...keys.concat('updated_at').map((k) => fields[k]), row.id);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'settings_work',
        entity: 'work_schedule', entityId: row.id, detail: fields, ip: clientIp(req),
      });
      const updated = db.prepare('SELECT * FROM work_schedules WHERE id = ?').get(row.id);
      return res.json({
        work_start: updated.work_start,
        work_end: updated.work_end,
        late_tolerance_minutes: updated.late_tolerance_minutes,
        checkout_deadline: updated.checkout_deadline,
        work_days: safeJson(updated.work_days, []),
        holidays: safeJson(updated.holidays, []),
      });
    } catch (err) {
      return next(err);
    }
  });

  // --- Location / general settings ---
  const locationSettings = () => ({
    location_validation_enabled: String(getSetting(db, 'location_validation_enabled', 'true')) === 'true',
    active_branch_id: Number(getSetting(db, 'active_branch_id', '1')),
    face_match_threshold: Number(getSetting(db, 'face_match_threshold', '0.5')),
    attendance_cooldown_seconds: Number(getSetting(db, 'attendance_cooldown_seconds', '60')),
    liveness_enabled: String(getSetting(db, 'liveness_enabled', 'true')) === 'true',
    late_deduction_mode: String(getSetting(db, 'late_deduction_mode', 'per_occurrence')),
    late_deduction_per_occurrence: Number(getSetting(db, 'late_deduction_per_occurrence', '0')),
    late_deduction_per_block: Number(getSetting(db, 'late_deduction_per_block', '0')),
    late_deduction_block_minutes: Number(getSetting(db, 'late_deduction_block_minutes', '10')),
  });

  router.get('/location', (req, res, next) => {
    try {
      return res.json(locationSettings());
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/location', (req, res, next) => {
    try {
      const body = req.body || {};
      const kv = {};
      if (body.location_validation_enabled !== undefined) {
        kv.location_validation_enabled = String(bool(body.location_validation_enabled, 'location_validation_enabled'));
      }
      if (body.liveness_enabled !== undefined) {
        kv.liveness_enabled = String(bool(body.liveness_enabled, 'liveness_enabled'));
      }
      if (body.active_branch_id !== undefined) {
        kv.active_branch_id = String(int(body.active_branch_id, 'active_branch_id', { min: 1 }));
      }
      if (body.face_match_threshold !== undefined) {
        kv.face_match_threshold = String(num(body.face_match_threshold, 'face_match_threshold', { min: 0.1, max: 2 }));
      }
      if (body.attendance_cooldown_seconds !== undefined) {
        kv.attendance_cooldown_seconds = String(int(body.attendance_cooldown_seconds, 'attendance_cooldown_seconds', { min: 0, max: 3600 }));
      }
      if (body.late_deduction_per_occurrence !== undefined) {
        kv.late_deduction_per_occurrence = String(int(body.late_deduction_per_occurrence, 'late_deduction_per_occurrence', { min: 0, max: 100000000 }));
      }
      if (body.late_deduction_mode !== undefined) {
        kv.late_deduction_mode = enumOf(body.late_deduction_mode, 'late_deduction_mode', ['per_occurrence', 'per_minute_block']);
      }
      if (body.late_deduction_per_block !== undefined) {
        kv.late_deduction_per_block = String(int(body.late_deduction_per_block, 'late_deduction_per_block', { min: 0, max: 100000000 }));
      }
      if (body.late_deduction_block_minutes !== undefined) {
        kv.late_deduction_block_minutes = String(int(body.late_deduction_block_minutes, 'late_deduction_block_minutes', { min: 1, max: 1440 }));
      }
      if (Object.keys(kv).length === 0) throw new ApiError(400, 'Tidak ada field yang diubah');
      setSettings(db, kv);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'settings_location',
        entity: 'settings', detail: kv, ip: clientIp(req),
      });
      return res.json(locationSettings());
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
