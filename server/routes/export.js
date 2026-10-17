// CSV export (admin).
import { Router } from 'express';
import { toCsv } from '../lib/csv.js';
import { jakartaDate, formatDateDDMMYYYY } from '../lib/time.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

export function exportRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('admin'));

  router.get('/attendance.csv', (req, res, next) => {
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
      const rows = db
        .prepare(`SELECT * FROM attendance${whereSql} ORDER BY date ASC, time ASC`)
        .all(...params);

      const columns = [
        { header: 'ID Absensi', key: 'id' },
        { header: 'ID Karyawan', key: 'employee_id' },
        { header: 'Nama Karyawan', key: 'employee_name' },
        { header: 'Tanggal', value: (r) => formatDateDDMMYYYY(r.date) },
        { header: 'Waktu', key: 'time' },
        { header: 'Tipe', key: 'type' },
        { header: 'Metode', key: 'method' },
        { header: 'Status', key: 'status' },
        { header: 'Lokasi', key: 'location_name' },
        { header: 'Catatan', key: 'note' },
        { header: 'Created At', key: 'created_at' },
        { header: 'Updated At', key: 'updated_at' },
      ];
      const csv = toCsv(rows, columns);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="absensi-${jakartaDate()}.csv"`);
      return res.send(csv);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
