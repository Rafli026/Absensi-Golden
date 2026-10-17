// Require a valid JWT cookie -> req.user.
import { verifyJwt, parseCookies, COOKIE_NAME } from '../lib/auth.js';

const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-me';

export function requireAuth(db) {
  return (req, res, next) => {
    try {
      const cookies = parseCookies(req);
      const token = cookies[COOKIE_NAME];
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      const payload = verifyJwt(token, SECRET());
      if (!payload) return res.status(401).json({ error: 'Unauthorized' });
      const user = db
        .prepare('SELECT id, username, role, full_name, is_active, photo FROM users WHERE id = ?')
        .get(payload.sub);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const employee = db
        .prepare('SELECT id FROM employees WHERE user_id = ? AND is_active = 1')
        .get(user.id);
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        full_name: user.full_name,
        photo: user.photo || null,
        employee_id: employee ? employee.id : null,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
