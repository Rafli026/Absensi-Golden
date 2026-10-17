// Attendance routes: QR check-in/out, face check-in/out, manual (admin), listing.
import { Router } from 'express';
import { isoUtc, jakartaDate, jakartaTime, minutesOfDay, formatDateDDMMYYYY, currentPeriod, isValidPeriod, shiftPeriod } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import { haversineMeters } from '../lib/geo.js';
import { bestMatch, isValidDescriptor } from '../lib/face.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { int, num, str, enumOf } from '../lib/validate.js';
import { getSetting } from '../db.js';
import { lateRulesFromSettings, computeLateDeduction } from '../lib/deduction.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

/**
 * Compute attendance status for a check-in.
 * Exported for unit testing.
 */
export function computeStatus(nowMinutes, schedule) {
  const start = minutesOfDay(schedule.work_start || '08:00');
  const tol = Number(schedule.late_tolerance_minutes ?? 15);
  return nowMinutes > start + tol ? 'Terlambat' : 'Hadir';
}

/** Load the active work schedule. */
export function activeSchedule(db) {
  const row = db.prepare('SELECT * FROM work_schedules WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  if (!row) {
    return { work_start: '08:00', work_end: '17:00', late_tolerance_minutes: 15, checkout_deadline: '23:59', work_days: [1, 2, 3, 4, 5, 6], holidays: [] };
  }
  return {
    ...row,
    work_days: safeJson(row.work_days, [1, 2, 3, 4, 5, 6]),
    holidays: safeJson(row.holidays, []),
  };
}

function safeJson(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Validate the scan location against the branch geofence.
 * Returns { validated, distance, locationName, lat, lng, accuracy } or throws ApiError.
 */
export function validateLocation(db, { branchId, latitude, longitude, accuracy }) {
  const enabled = String(getSetting(db, 'location_validation_enabled', 'true')) === 'true';
  const hasCoords = latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null;

  if (!enabled) {
    return { validated: false, distance: null, locationName: null, lat: hasCoords ? latitude : null, lng: hasCoords ? longitude : null, accuracy: accuracy ?? null };
  }

  const branch = branchId ? db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId) : null;
  if (!branch || branch.latitude === null || branch.longitude === null) {
    throw new ApiError(400, 'Cabang belum memiliki koordinat');
  }
  if (!hasCoords) {
    throw new ApiError(400, 'Lokasi tidak tersedia. Izinkan akses lokasi atau hubungi admin.');
  }
  const distance = haversineMeters(latitude, longitude, branch.latitude, branch.longitude);
  if (distance > branch.radius_meters) {
    throw new ApiError(400, `Anda berada ${Math.round(distance)} m dari toko (maks ${branch.radius_meters} m)`);
  }
  return { validated: true, distance, locationName: branch.name, lat: latitude, lng: longitude, accuracy: accuracy ?? null };
}

/** Enforce the per-employee attendance cooldown. Throws ApiError(429) if too fast. */
export function checkCooldown(db, employeeId) {
  const seconds = Number(getSetting(db, 'attendance_cooldown_seconds', '60'));
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const dateKey = jakartaDate();
  const last = db
    .prepare('SELECT created_at FROM attendance WHERE employee_id = ? AND date = ? ORDER BY id DESC LIMIT 1')
    .get(employeeId, dateKey);
  if (!last) return;
  const elapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
  if (elapsed < seconds) {
    const wait = Math.ceil(seconds - elapsed);
    throw new ApiError(429, `Scan terlalu cepat, tunggu ${wait} detik`);
  }
}

/** Determine the next attendance type for an employee today. Throws 409 if both exist. */
export function nextType(db, employeeId, dateKey) {
  const rows = db.prepare('SELECT type FROM attendance WHERE employee_id = ? AND date = ?').all(employeeId, dateKey);
  const hasMasuk = rows.some((r) => r.type === 'Masuk');
  const hasPulang = rows.some((r) => r.type === 'Pulang');
  if (hasMasuk && hasPulang) throw new ApiError(409, 'Sudah absen masuk dan pulang hari ini');
  if (!hasMasuk) return 'Masuk';
  return 'Pulang';
}

function mapAttendance(a) {
  return {
    ...a,
    date_display: formatDateDDMMYYYY(a.date),
    location_validated: !!a.location_validated,
  };
}

/**
 * Monthly recap for an employee (or all employees if employeeId is null).
 * Counts reset automatically each month because filtering is by 'YYYY-MM'.
 */
export function monthlyRecap(db, { employeeId = null, period = currentPeriod(), branchId = null } = {}) {
  const where = ['date LIKE ?'];
  const params = [`${period}-%`];
  if (employeeId) { where.push('employee_id = ?'); params.push(employeeId); }
  if (branchId) { where.push('branch_id = ?'); params.push(branchId); }
  const whereSql = ` WHERE ${where.join(' AND ')}`;

  const rows = db
    .prepare(
      `SELECT employee_id, employee_name, status, late_minutes
       FROM attendance${whereSql}`
    )
    .all(...params);

  const rules = lateRulesFromSettings((k, d) => getSetting(db, k, d));

  // Aggregate per employee, computing the deduction per late record.
  const agg = new Map();
  for (const r of rows) {
    let a = agg.get(r.employee_id);
    if (!a) {
      a = {
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        hadir_count: 0,
        late_count: 0,
        izin_count: 0,
        masuk_count: 0,
        late_minutes_total: 0,
        total_deduction: 0,
      };
      agg.set(r.employee_id, a);
    }
    if (r.status === 'Hadir') a.hadir_count += 1;
    if (r.status === 'Izin') a.izin_count += 1;
    if (r.status === 'Terlambat') {
      a.late_count += 1;
      const minutes = Number(r.late_minutes) || 0;
      a.late_minutes_total += minutes;
      a.total_deduction += computeLateDeduction(minutes, rules, { isLate: true }).deduction;
    }
    if (r.status !== 'Izin') a.masuk_count += 1;
  }

  // Include employees with zero records so admins see everyone.
  const empWhere = [];
  const empParams = [];
  if (employeeId) { empWhere.push('e.id = ?'); empParams.push(employeeId); }
  if (branchId) { empWhere.push('e.branch_id = ?'); empParams.push(branchId); }
  const employees = db
    .prepare(
      `SELECT e.id AS employee_id, u.full_name AS employee_name, e.employee_code, e.branch_id
       FROM employees e JOIN users u ON u.id = e.user_id
       ${empWhere.length ? `WHERE ${empWhere.join(' AND ')}` : ''}
       ORDER BY u.full_name`
    )
    .all(...empParams);

  const buildItem = (employeeId_, employeeName, employeeCode) => {
    const a = agg.get(employeeId_) || {};
    return {
      employee_id: employeeId_,
      employee_name: a.employee_name || employeeName,
      employee_code: employeeCode,
      period,
      hadir_count: a.hadir_count || 0,
      late_count: a.late_count || 0,
      izin_count: a.izin_count || 0,
      masuk_count: a.masuk_count || 0,
      late_minutes_total: a.late_minutes_total || 0,
      total_deduction: a.total_deduction || 0,
    };
  };

  const items = employees.map((emp) => buildItem(emp.employee_id, emp.employee_name, emp.employee_code));

  // Include any employee_id present in attendance but missing from the employees list.
  for (const [id, a] of agg) {
    if (!items.some((i) => i.employee_id === id)) {
      items.push(buildItem(id, a.employee_name, null));
    }
  }

  const totals = items.reduce(
    (acc, i) => ({
      late_count: acc.late_count + i.late_count,
      izin_count: acc.izin_count + i.izin_count,
      hadir_count: acc.hadir_count + i.hadir_count,
      late_minutes_total: acc.late_minutes_total + i.late_minutes_total,
      total_deduction: acc.total_deduction + i.total_deduction,
    }),
    { late_count: 0, izin_count: 0, hadir_count: 0, late_minutes_total: 0, total_deduction: 0 }
  );

  return {
    period,
    rules,
    // Kept for backwards compatibility with the UI.
    deduction_per_occurrence: rules.perOccurrence,
    items,
    totals,
  };
}

export function attendanceRouter(db) {
  const router = Router();
  router.use(requireAuth(db));

  const faceLimiter = rateLimit({
    windowMs: 10_000,
    max: 10,
    key: (req) => `face:${req.user.id}`,
    message: 'Terlalu banyak permintaan verifikasi, coba lagi sebentar lagi',
  });

  // Shared record creation for QR & face paths.
  function createRecord({ req, employee, method, latitude, longitude, accuracy, note = null }) {
    const dateKey = jakartaDate();
    const timeStr = jakartaTime();
    checkCooldown(db, employee.id);
    const type = nextType(db, employee.id, dateKey);
    const schedule = activeSchedule(db);
    const loc = validateLocation(db, {
      branchId: employee.branch_id,
      latitude,
      longitude,
      accuracy,
    });
    let status;
    let lateMinutes = 0;
    if (type === 'Pulang') {
      status = 'Pulang';
    } else {
      const nowMinutes = minutesOfDay(timeStr);
      status = computeStatus(nowMinutes, schedule);
      if (status === 'Terlambat') {
        lateMinutes = Math.max(0, nowMinutes - (minutesOfDay(schedule.work_start || '08:00') + Number(schedule.late_tolerance_minutes ?? 15)));
      }
    }
    const now = isoUtc();
    const id = db
      .prepare(
        `INSERT INTO attendance
          (employee_id, employee_name, branch_id, branch_name, date, time, type, method, status,
           location_name, latitude, longitude, accuracy, location_validated, distance_meters, late_minutes, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        employee.id, employee.full_name, employee.branch_id, loc.locationName,
        dateKey, timeStr, type, method, status,
        loc.locationName, loc.lat, loc.lng, loc.accuracy,
        loc.validated ? 1 : 0, loc.distance, lateMinutes, note, now, now
      ).lastInsertRowid;

    const message = type === 'Masuk'
      ? (status === 'Terlambat' ? `Absen masuk tercatat (Terlambat) untuk ${employee.full_name}` : `Absen masuk tercatat untuk ${employee.full_name}`)
      : `Absen pulang tercatat untuk ${employee.full_name}`;

    return { id, type, status, dateKey, timeStr, message, loc };
  }

  // --- QR check-in/out ---
  router.post('/qr', (req, res, next) => {
    try {
      const body = req.body || {};
      const code = str(body.code, 'code', { max: 200 });
      const employee = db
        .prepare(
          `SELECT e.*, u.full_name FROM employees e JOIN users u ON u.id = e.user_id
           WHERE e.qr_code = ? AND e.is_active = 1`
        )
        .get(code);
      if (!employee) throw new ApiError(404, 'QR Code tidak dikenali');
      if (req.user.role === 'employee' && employee.id !== req.user.employee_id) {
        throw new ApiError(403, 'QR Code bukan milik Anda');
      }
      const latitude = body.latitude !== undefined && body.latitude !== null && body.latitude !== '' ? num(body.latitude, 'latitude', { min: -90, max: 90 }) : null;
      const longitude = body.longitude !== undefined && body.longitude !== null && body.longitude !== '' ? num(body.longitude, 'longitude', { min: -180, max: 180 }) : null;
      const accuracy = body.accuracy !== undefined && body.accuracy !== null && body.accuracy !== '' ? num(body.accuracy, 'accuracy', { min: 0 }) : null;

      const result = createRecord({ req, employee, method: 'Barcode/QR', latitude, longitude, accuracy });
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'attendance_qr',
        entity: 'attendance', entityId: result.id, detail: { employee_id: employee.id, type: result.type, status: result.status }, ip: clientIp(req),
      });
      const attendance = mapAttendance(db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.id));
      return res.json({
        attendance,
        employee: { id: employee.id, full_name: employee.full_name, employee_code: employee.employee_code, photo: null },
        message: result.message,
      });
    } catch (err) {
      return next(err);
    }
  });

  // --- Face check-in/out ---
  router.post('/face', faceLimiter, (req, res, next) => {
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
        return res.json({ matched: false, error: 'Wajah tidak dikenali' });
      }
      const employee = db
        .prepare(
          `SELECT e.*, u.full_name FROM employees e JOIN users u ON u.id = e.user_id
           WHERE e.id = ? AND e.is_active = 1`
        )
        .get(match.profile.employee_id);
      if (!employee) {
        return res.json({ matched: false, error: 'Wajah tidak dikenali' });
      }
      const latitude = body.latitude !== undefined && body.latitude !== null && body.latitude !== '' ? num(body.latitude, 'latitude', { min: -90, max: 90 }) : null;
      const longitude = body.longitude !== undefined && body.longitude !== null && body.longitude !== '' ? num(body.longitude, 'longitude', { min: -180, max: 180 }) : null;
      const accuracy = body.accuracy !== undefined && body.accuracy !== null && body.accuracy !== '' ? num(body.accuracy, 'accuracy', { min: 0 }) : null;

      const result = createRecord({ req, employee, method: 'Face Recognition', latitude, longitude, accuracy });
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'attendance_face',
        entity: 'attendance', entityId: result.id, detail: { employee_id: employee.id, type: result.type, status: result.status, distance: match.distance }, ip: clientIp(req),
      });
      const attendance = mapAttendance(db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.id));
      return res.json({
        matched: true,
        distance: match.distance,
        attendance,
        employee: { id: employee.id, full_name: employee.full_name, employee_code: employee.employee_code, photo: null },
        message: result.message,
      });
    } catch (err) {
      return next(err);
    }
  });

  // --- Manual (admin) ---
  router.post('/manual', requireRole('admin'), (req, res, next) => {
    try {
      const body = req.body || {};
      const employeeId = int(body.employee_id, 'employee_id', { min: 1 });
      const employee = db
        .prepare('SELECT e.*, u.full_name FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = ?')
        .get(employeeId);
      if (!employee) throw new ApiError(404, 'Karyawan tidak ditemukan');
      const type = enumOf(body.type, 'type', ['Masuk', 'Pulang']);
      const status = enumOf(body.status, 'status', ['Hadir', 'Terlambat', 'Pulang', 'Izin']);
      const method = enumOf(body.method ?? 'Manual', 'method', ['Barcode/QR', 'Face Recognition', 'Manual']);
      const dateKey = body.date ? str(body.date, 'date', { max: 20 }) : jakartaDate();
      const timeStr = body.time ? str(body.time, 'time', { max: 20 }) : jakartaTime();
      const note = body.note ? str(body.note, 'note', { required: false, max: 500 }) : null;

      // Admin manual overrides: delete any conflicting same-type record first.
      db.prepare('DELETE FROM attendance WHERE employee_id = ? AND date = ? AND type = ?').run(employeeId, dateKey, type);
      const now = isoUtc();
      // Compute late minutes so the recap can apply per-minute deductions.
      let lateMinutes = 0;
      if (status === 'Terlambat') {
        const schedule = activeSchedule(db);
        const startMin = minutesOfDay(schedule.work_start || '08:00') + Number(schedule.late_tolerance_minutes ?? 15);
        lateMinutes = Math.max(0, minutesOfDay(timeStr) - startMin);
      }
      const branch = employee.branch_id ? db.prepare('SELECT name FROM branches WHERE id = ?').get(employee.branch_id) : null;
      const id = db
        .prepare(
          `INSERT INTO attendance
            (employee_id, employee_name, branch_id, branch_name, date, time, type, method, status,
             location_name, latitude, longitude, accuracy, location_validated, distance_meters, late_minutes, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, ?, ?, ?, ?)`
        )
        .run(employeeId, employee.full_name, employee.branch_id, branch?.name ?? null, dateKey, timeStr, type, method, status, lateMinutes, note, now, now).lastInsertRowid;
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'attendance_manual',
        entity: 'attendance', entityId: id, detail: { employee_id: employeeId, type, status, date: dateKey }, ip: clientIp(req),
      });
      const attendance = mapAttendance(db.prepare('SELECT * FROM attendance WHERE id = ?').get(id));
      return res.status(201).json({ attendance });
    } catch (err) {
      return next(err);
    }
  });

  // --- Listing (admin) ---
  router.get('/', requireRole('admin'), (req, res, next) => {
    try {
      const q = req.query;
      const where = [];
      const params = [];
      if (q.date_from) { where.push('date >= ?'); params.push(q.date_from); }
      if (q.date_to) { where.push('date <= ?'); params.push(q.date_to); }
      if (q.employee_id) { where.push('employee_id = ?'); params.push(Number(q.employee_id)); }
      if (q.status) { where.push('status = ?'); params.push(q.status); }
      if (q.method) { where.push('method = ?'); params.push(q.method); }
      if (q.branch_id) { where.push('branch_id = ?'); params.push(Number(q.branch_id)); }
      const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM attendance${whereSql}`).get(...params).n;
      const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
      const offset = Math.max(Number(q.offset) || 0, 0);
      const rows = db
        .prepare(`SELECT * FROM attendance${whereSql} ORDER BY date DESC, time DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);
      return res.json({ attendance: rows.map(mapAttendance), total });
    } catch (err) {
      return next(err);
    }
  });

  // --- Monthly recap (admin sees all + deductions; employee sees own counts only) ---
  router.get('/recap', (req, res, next) => {
    try {
      const period = req.query.period || currentPeriod();
      if (!isValidPeriod(period)) throw new ApiError(400, 'Format periode harus YYYY-MM');
      const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;

      if (req.user.role === 'admin') {
        const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;
        const recap = monthlyRecap(db, { period, branchId, employeeId });
        return res.json(recap);
      }
      // Employee: own counts only, WITHOUT any deduction figures.
      if (!req.user.employee_id) {
        return res.json({ period, items: [], totals: { late_count: 0, izin_count: 0, hadir_count: 0 } });
      }
      const recap = monthlyRecap(db, { employeeId: req.user.employee_id, period });
      const own = recap.items.find((i) => i.employee_id === req.user.employee_id) || {
        employee_id: req.user.employee_id, employee_name: req.user.full_name, period,
        hadir_count: 0, late_count: 0, izin_count: 0, masuk_count: 0,
      };
      return res.json({
        period,
        items: [{
          employee_id: own.employee_id,
          employee_name: own.employee_name,
          period: own.period,
          hadir_count: own.hadir_count,
          late_count: own.late_count,
          izin_count: own.izin_count,
          masuk_count: own.masuk_count,
        }],
      });
    } catch (err) {
      return next(err);
    }
  });

  // --- My attendance (employee or admin) ---
  router.get('/me', (req, res, next) => {
    try {
      if (!req.user.employee_id) {
        return res.json({ attendance: [], total: 0 });
      }
      const q = req.query;
      const where = ['employee_id = ?'];
      const params = [req.user.employee_id];
      if (q.date_from) { where.push('date >= ?'); params.push(q.date_from); }
      if (q.date_to) { where.push('date <= ?'); params.push(q.date_to); }
      const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
      const rows = db
        .prepare(`SELECT * FROM attendance WHERE ${where.join(' AND ')} ORDER BY date DESC, time DESC LIMIT ?`)
        .all(...params, limit);
      return res.json({ attendance: rows.map(mapAttendance), total: rows.length });
    } catch (err) {
      return next(err);
    }
  });

  // --- Today status ---
  router.get('/today', (req, res, next) => {
    try {
      const dateKey = jakartaDate();
      if (!req.user.employee_id) {
        return res.json({ status: 'Belum Absen', check_in: null, check_out: null });
      }
      const rows = db
        .prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ? ORDER BY time')
        .all(req.user.employee_id, dateKey);
      const checkIn = rows.find((r) => r.type === 'Masuk') || null;
      const checkOut = rows.find((r) => r.type === 'Pulang') || null;
      let status = 'Belum Absen';
      if (rows.some((r) => r.status === 'Izin')) status = 'Izin';
      else if (rows.length === 0) status = 'Belum Absen';
      else if (checkOut) status = 'Sudah Pulang';
      else if (checkIn && checkIn.status === 'Terlambat') status = 'Terlambat';
      else status = 'Sudah Masuk';
      const branch = db
        .prepare(
          `SELECT b.name FROM employees e LEFT JOIN branches b ON b.id = e.branch_id WHERE e.id = ?`
        )
        .get(req.user.employee_id);
      return res.json({
        status,
        date: dateKey,
        branch_name: branch?.name ?? null,
        check_in: checkIn ? mapAttendance(checkIn) : null,
        check_out: checkOut ? mapAttendance(checkOut) : null,
      });
    } catch (err) {
      return next(err);
    }
  });

  // --- Update (admin) ---
  router.patch('/:id', requireRole('admin'), (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const row = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
      if (!row) throw new ApiError(404, 'Data absensi tidak ditemukan');
      const body = req.body || {};
      const fields = {};
      if (body.status !== undefined) fields.status = enumOf(body.status, 'status', ['Hadir', 'Terlambat', 'Pulang', 'Izin']);
      if (body.type !== undefined) fields.type = enumOf(body.type, 'type', ['Masuk', 'Pulang']);
      if (body.time !== undefined) fields.time = str(body.time, 'time', { max: 20 });
      if (body.note !== undefined) fields.note = body.note ? str(body.note, 'note', { required: false, max: 500 }) : null;
      const keys = Object.keys(fields);
      if (keys.length === 0) throw new ApiError(400, 'Tidak ada field yang diubah');
      fields.updated_at = isoUtc();
      const setClause = keys.concat('updated_at').map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE attendance SET ${setClause} WHERE id = ?`).run(...keys.concat('updated_at').map((k) => fields[k]), id);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'attendance_update',
        entity: 'attendance', entityId: id, detail: fields, ip: clientIp(req),
      });
      const updated = mapAttendance(db.prepare('SELECT * FROM attendance WHERE id = ?').get(id));
      return res.json({ attendance: updated });
    } catch (err) {
      return next(err);
    }
  });

  // --- Delete (admin) ---
  router.delete('/:id', requireRole('admin'), (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const row = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
      if (!row) throw new ApiError(404, 'Data absensi tidak ditemukan');
      db.prepare('DELETE FROM attendance WHERE id = ?').run(id);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'attendance_delete',
        entity: 'attendance', entityId: id, ip: clientIp(req),
      });
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
