// Employee management (admin only) + QR code PNG generation.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import QR from 'qrcode';
import { isoUtc, formatDateDDMMYYYY } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import { hashPassword } from '../lib/auth.js';
import { transaction } from '../db.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { str, int, bool } from '../lib/validate.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

function nextEmployeeCode(db) {
  const row = db
    .prepare("SELECT employee_code FROM employees WHERE employee_code LIKE 'KRY-%' ORDER BY employee_code DESC LIMIT 1")
    .get();
  let n = 1;
  if (row) {
    const m = /KRY-(\d+)/.exec(row.employee_code);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `KRY-${String(n).padStart(3, '0')}`;
}

function mapEmployeeRow(r) {
  return {
    id: r.id,
    employee_code: r.employee_code,
    full_name: r.full_name,
    username: r.username,
    position: r.position,
    phone: r.phone,
    join_date: r.join_date,
    branch_id: r.branch_id,
    branch_name: r.branch_name || null,
    is_active: !!r.is_active,
    has_face: !!r.has_face,
    has_qr: !!r.qr_code,
  };
}

const EMPLOYEE_SELECT = `
  SELECT e.*, u.full_name, u.username, u.is_active,
         b.name AS branch_name,
         (SELECT COUNT(*) FROM face_profiles fp WHERE fp.employee_id = e.id) AS has_face
  FROM employees e
  JOIN users u ON u.id = e.user_id
  LEFT JOIN branches b ON b.id = e.branch_id
`;

export function employeesRouter(db) {
  const router = Router();
  router.use(requireAuth(db));

  // List (admin)
  router.get('/', requireRole('admin'), (req, res, next) => {
    try {
      const { search = '', branch_id, active } = req.query;
      const where = [];
      const params = [];
      if (search) {
        where.push('(u.full_name LIKE ? OR u.username LIKE ? OR e.employee_code LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (branch_id !== undefined && branch_id !== '') {
        where.push('e.branch_id = ?');
        params.push(Number(branch_id));
      }
      if (active !== undefined && active !== '') {
        where.push('e.is_active = ?');
        params.push(active === 'true' || active === '1' ? 1 : 0);
      }
      const sql = EMPLOYEE_SELECT + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY e.employee_code';
      const rows = db.prepare(sql).all(...params);
      return res.json({ employees: rows.map(mapEmployeeRow) });
    } catch (err) {
      return next(err);
    }
  });

  // Create (admin)
  router.post('/', requireRole('admin'), (req, res, next) => {
    try {
      const body = req.body || {};
      const fullName = str(body.full_name, 'full_name', { max: 150 });
      const username = str(body.username, 'username', { max: 100 });
      const password = str(body.password, 'password', { max: 200 });
      if (password.length < 6) throw new ApiError(400, 'Password minimal 6 karakter');

      const dupUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (dupUser) throw new ApiError(409, 'Username sudah digunakan');

      const code = body.employee_code ? str(body.employee_code, 'employee_code', { max: 50 }) : nextEmployeeCode(db);
      const dupCode = db.prepare('SELECT id FROM employees WHERE employee_code = ?').get(code);
      if (dupCode) throw new ApiError(409, 'Kode karyawan sudah digunakan');

      const position = body.position ? str(body.position, 'position', { required: false, max: 100 }) : null;
      const phone = body.phone ? str(body.phone, 'phone', { required: false, max: 30 }) : null;
      const joinDate = body.join_date ? str(body.join_date, 'join_date', { required: false, max: 20 }) : null;
      const branchId = body.branch_id !== undefined && body.branch_id !== null && body.branch_id !== ''
        ? int(body.branch_id, 'branch_id', { min: 1 })
        : null;

      const now = isoUtc();
      const qrCode = `ROTIABS-${randomUUID()}`;

      const { empId } = transaction(db, () => {
        const userId = db
          .prepare(
            `INSERT INTO users (username, password_hash, role, full_name, is_active, created_at, updated_at)
             VALUES (?, ?, 'employee', ?, 1, ?, ?)`
          )
          .run(username, hashPassword(password), fullName, now, now).lastInsertRowid;
        const empId = db
          .prepare(
            `INSERT INTO employees (user_id, employee_code, qr_code, branch_id, position, phone, join_date, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
          )
          .run(userId, code, qrCode, branchId, position, phone, joinDate, now, now).lastInsertRowid;
        return { userId, empId };
      });
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'employee_create',
        entity: 'employee', entityId: empId, detail: { username, full_name: fullName, employee_code: code }, ip: clientIp(req),
      });
      const row = db.prepare(EMPLOYEE_SELECT + ' WHERE e.id = ?').get(empId);
      return res.status(201).json({ employee: { ...mapEmployeeRow(row), qr_code: row.qr_code } });
    } catch (err) {
      return next(err);
    }
  });

  // Detail (admin)
  router.get('/:id', requireRole('admin'), (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const row = db.prepare(EMPLOYEE_SELECT + ' WHERE e.id = ?').get(id);
      if (!row) throw new ApiError(404, 'Karyawan tidak ditemukan');
      const branch = row.branch_id ? db.prepare('SELECT * FROM branches WHERE id = ?').get(row.branch_id) : null;
      const recent = db
        .prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date DESC, time DESC LIMIT 10')
        .all(id)
        .map((a) => ({ ...a, date_display: formatDateDDMMYYYY(a.date), location_validated: !!a.location_validated }));
      return res.json({
        employee: { ...mapEmployeeRow(row), qr_code: row.qr_code, branch, recent_attendance: recent },
      });
    } catch (err) {
      return next(err);
    }
  });

  // Update (admin)
  router.patch('/:id', requireRole('admin'), (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
      if (!row) throw new ApiError(404, 'Karyawan tidak ditemukan');
      const body = req.body || {};
      const now = isoUtc();

      const empFields = {};
      if (body.position !== undefined) empFields.position = body.position ? str(body.position, 'position', { required: false, max: 100 }) : null;
      if (body.phone !== undefined) empFields.phone = body.phone ? str(body.phone, 'phone', { required: false, max: 30 }) : null;
      if (body.join_date !== undefined) empFields.join_date = body.join_date ? str(body.join_date, 'join_date', { required: false, max: 20 }) : null;
      if (body.branch_id !== undefined) empFields.branch_id = body.branch_id === null || body.branch_id === '' ? null : int(body.branch_id, 'branch_id', { min: 1 });
      if (body.is_active !== undefined) empFields.is_active = bool(body.is_active, 'is_active') ? 1 : 0;

      const userFields = {};
      if (body.full_name !== undefined) userFields.full_name = str(body.full_name, 'full_name', { max: 150 });
      if (body.password !== undefined && body.password !== '') {
        const pw = str(body.password, 'password', { max: 200 });
        if (pw.length < 6) throw new ApiError(400, 'Password minimal 6 karakter');
        userFields.password_hash = hashPassword(pw);
      }

      transaction(db, () => {
        const ek = Object.keys(empFields);
        if (ek.length) {
          const set = ek.concat('updated_at').map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE employees SET ${set} WHERE id = ?`).run(...ek.map((k) => empFields[k]), now, id);
        }
        const uk = Object.keys(userFields);
        if (uk.length) {
          const set = uk.concat('updated_at').map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE users SET ${set} WHERE id = ?`).run(...uk.map((k) => userFields[k]), now, row.user_id);
        }
      });
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'employee_update',
        entity: 'employee', entityId: id, detail: { ...empFields, ...(userFields.password_hash ? { password: '***' } : userFields) }, ip: clientIp(req),
      });
      const updated = db.prepare(EMPLOYEE_SELECT + ' WHERE e.id = ?').get(id);
      return res.json({ employee: mapEmployeeRow(updated) });
    } catch (err) {
      return next(err);
    }
  });

  // Delete (admin) - cascade removes employee, attendance, face profile.
  router.delete('/:id', requireRole('admin'), (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
      if (!row) throw new ApiError(404, 'Karyawan tidak ditemukan');
      db.prepare('DELETE FROM users WHERE id = ?').run(row.user_id);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'employee_delete',
        entity: 'employee', entityId: id, ip: clientIp(req),
      });
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  // Regenerate QR (admin)
  router.post('/:id/qrcode/regenerate', requireRole('admin'), (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
      if (!row) throw new ApiError(404, 'Karyawan tidak ditemukan');
      const qrCode = `ROTIABS-${randomUUID()}`;
      db.prepare('UPDATE employees SET qr_code = ?, updated_at = ? WHERE id = ?').run(qrCode, isoUtc(), id);
      writeAudit(db, {
        actorId: req.user.id, actorName: req.user.full_name, action: 'qr_regenerate',
        entity: 'employee', entityId: id, ip: clientIp(req),
      });
      return res.json({ qr_code: qrCode });
    } catch (err) {
      return next(err);
    }
  });

  // QR PNG (any logged-in user, so badges can be printed).
  router.get('/:id/qrcode.png', (req, res, next) => {
    try {
      const id = int(req.params.id, 'id', { min: 1 });
      const row = db.prepare('SELECT qr_code FROM employees WHERE id = ?').get(id);
      if (!row) throw new ApiError(404, 'Karyawan tidak ditemukan');
      const size = Math.min(Math.max(Number(req.query.size) || 300, 64), 1024);
      QR.toBuffer(row.qr_code, { width: size, margin: 1 })
        .then((buf) => {
          res.set('Content-Type', 'image/png');
          res.set('Cache-Control', 'no-store');
          res.send(buf);
        })
        .catch(next);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
