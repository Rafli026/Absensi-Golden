// Dashboard summary + chart (admin).
import { Router } from 'express';
import { jakartaDate, formatDateDDMMYYYY, currentPeriod, isValidPeriod } from '../lib/time.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { int } from '../lib/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import { monthlyRecap } from './attendance.js';

function shiftDateKey(dateKey, deltaDays) {
  const [y, m, d] = dateKey.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function dashboardRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('admin'));

  router.get('/summary', (req, res, next) => {
    try {
      const date = req.query.date || jakartaDate();
      const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;

      const empWhere = ['is_active = 1'];
      const empParams = [];
      if (branchId) { empWhere.push('branch_id = ?'); empParams.push(branchId); }
      const totalEmployees = db
        .prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${empWhere.join(' AND ')}`)
        .get(...empParams).n;

      const attWhere = ['date = ?'];
      const attParams = [date];
      if (branchId) { attWhere.push('branch_id = ?'); attParams.push(branchId); }
      const attWhereSql = ` WHERE ${attWhere.join(' AND ')}`;

      const distinctPresent = db
        .prepare(`SELECT COUNT(DISTINCT employee_id) AS n FROM attendance${attWhereSql}`)
        .get(...attParams).n;

      const countStatus = (status) =>
        db
          .prepare(`SELECT COUNT(DISTINCT employee_id) AS n FROM attendance${attWhereSql} AND status = ?`)
          .get(...attParams, status).n;

      const hadir = countStatus('Hadir');
      const terlambat = countStatus('Terlambat');
      const izin = countStatus('Izin');
      const sudahPulang = db
        .prepare(`SELECT COUNT(DISTINCT employee_id) AS n FROM attendance${attWhereSql} AND type = 'Pulang'`)
        .get(...attParams).n;

      const belumAbsen = Math.max(totalEmployees - distinctPresent, 0);

      const recent = db
        .prepare(`SELECT * FROM attendance${attWhereSql} ORDER BY time DESC, id DESC LIMIT 10`)
        .all(...attParams)
        .map((a) => ({ ...a, date_display: formatDateDDMMYYYY(a.date), location_validated: !!a.location_validated }));

      return res.json({
        total_employees: totalEmployees,
        hadir,
        terlambat,
        belum_absen: belumAbsen,
        sudah_pulang: sudahPulang,
        izin,
        recent,
        date,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/chart', (req, res, next) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 60);
      const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
      const today = jakartaDate();
      const labels = [];
      const hadir = [];
      const terlambat = [];
      for (let i = days - 1; i >= 0; i--) {
        const dateKey = shiftDateKey(today, -i);
        labels.push(formatDateDDMMYYYY(dateKey));
        const params = [dateKey];
        let branchSql = '';
        if (branchId) { branchSql = ' AND branch_id = ?'; params.push(branchId); }
        hadir.push(
          db.prepare(`SELECT COUNT(DISTINCT employee_id) AS n FROM attendance WHERE date = ? AND status = 'Hadir'${branchSql}`).get(...params).n
        );
        terlambat.push(
          db.prepare(`SELECT COUNT(DISTINCT employee_id) AS n FROM attendance WHERE date = ? AND status = 'Terlambat'${branchSql}`).get(...params).n
        );
      }
      return res.json({ labels, hadir, terlambat });
    } catch (err) {
      return next(err);
    }
  });

  // Monthly recap (late/izin counts + late deductions). Admin only.
  router.get('/recap', (req, res, next) => {
    try {
      const period = req.query.period || currentPeriod();
      if (!isValidPeriod(period)) throw new ApiError(400, 'Format periode harus YYYY-MM');
      const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
      const recap = monthlyRecap(db, { period, branchId });
      return res.json(recap);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
