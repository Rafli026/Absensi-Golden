// Auth routes: login, logout, me, change password.
import { Router } from 'express';
import {
  hashPassword,
  verifyPassword,
  signJwt,
  setAuthCookie,
  clearAuthCookie,
} from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { ApiError } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireFields, str } from '../lib/validate.js';

const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const TTL = () => Number(process.env.SESSION_TTL_HOURS || 12);

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

function loadUserPayload(db, userId) {
  const user = db
    .prepare('SELECT id, username, role, full_name, is_active, photo FROM users WHERE id = ?')
    .get(userId);
  if (!user || !user.is_active) return null;
  const emp = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(user.id);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name,
    photo: user.photo || null,
    employee_id: emp ? emp.id : null,
  };
}

export function authRouter(db) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 5 * 60_000,
    max: 10,
    key: (req) => clientIp(req),
    message: 'Terlalu banyak percobaan login, coba lagi beberapa menit lagi',
  });

  router.post('/login', loginLimiter, (req, res, next) => {
    try {
      const body = req.body || {};
      requireFields(body, ['username', 'password']);
      const username = str(body.username, 'username', { max: 100 });
      const password = String(body.password);
      const user = db
        .prepare('SELECT id, username, role, full_name, password_hash, is_active FROM users WHERE username = ?')
        .get(username);
      if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Username atau password salah' });
      }
      const token = signJwt(
        { sub: user.id, role: user.role, username: user.username },
        SECRET(),
        TTL()
      );
      setAuthCookie(res, token, TTL());
      const payload = loadUserPayload(db, user.id);
      writeAudit(db, {
        actorId: user.id,
        actorName: user.full_name,
        action: 'login',
        entity: 'user',
        entityId: user.id,
        ip: clientIp(req),
      });
      return res.json({ user: payload });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    return res.json({ ok: true });
  });

  router.get('/me', requireAuth(db), (req, res) => {
    return res.json({ user: req.user });
  });

  router.patch('/password', requireAuth(db), (req, res, next) => {
    try {
      const body = req.body || {};
      requireFields(body, ['old_password', 'new_password']);
      const oldPw = String(body.old_password);
      const newPw = String(body.new_password);
      if (newPw.length < 6) {
        throw new ApiError(400, 'Password baru minimal 6 karakter');
      }
      const user = db
        .prepare('SELECT id, password_hash, full_name FROM users WHERE id = ?')
        .get(req.user.id);
      if (!user || !verifyPassword(oldPw, user.password_hash)) {
        return res.status(400).json({ error: 'Password lama salah' });
      }
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        hashPassword(newPw),
        now,
        user.id
      );
      writeAudit(db, {
        actorId: req.user.id,
        actorName: user.full_name,
        action: 'password_change',
        entity: 'user',
        entityId: user.id,
        ip: clientIp(req),
      });
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  // Update own profile: full name and/or profile photo (data URL).
  router.patch('/profile', requireAuth(db), (req, res, next) => {
    try {
      const body = req.body || {};
      const fields = {};
      if (body.full_name !== undefined) {
        fields.full_name = str(body.full_name, 'full_name', { max: 150 });
      }
      if (body.photo !== undefined) {
        if (body.photo === null || body.photo === '') {
          fields.photo = null;
        } else {
          const photo = String(body.photo);
          if (!/^data:image\/(png|jpe?g|webp);base64,/.test(photo)) {
            throw new ApiError(400, 'Format foto tidak valid');
          }
          // ~700 KB of base64 is plenty for a 400x400 JPEG avatar.
          if (photo.length > 900_000) {
            throw new ApiError(400, 'Ukuran foto terlalu besar (maks ~650 KB)');
          }
          fields.photo = photo;
        }
      }
      const keys = Object.keys(fields);
      if (keys.length === 0) throw new ApiError(400, 'Tidak ada field yang diubah');

      const now = new Date().toISOString();
      fields.updated_at = now;
      const setClause = keys.concat('updated_at').map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(
        ...keys.concat('updated_at').map((k) => fields[k]),
        req.user.id
      );
      // Keep the employee snapshot name in sync for future attendance rows.
      if (fields.full_name) {
        db.prepare(
          `UPDATE employees SET updated_at = ? WHERE user_id = ?`
        ).run(now, req.user.id);
      }
      writeAudit(db, {
        actorId: req.user.id,
        actorName: fields.full_name || req.user.full_name,
        action: 'profile_update',
        entity: 'user',
        entityId: req.user.id,
        detail: { fields: keys },
        ip: clientIp(req),
      });
      const payload = loadUserPayload(db, req.user.id);
      return res.json({ ok: true, user: payload });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
