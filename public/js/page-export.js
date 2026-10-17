// Admin: export CSV.
import { initAdminPage, get, escapeHtml } from '../js/api.js';

initAdminPage(async () => {
  const [emp, br] = await Promise.all([get('/api/employees'), get('/api/branches')]);
  document.getElementById('employee').innerHTML = '<option value="">Semua</option>' +
    emp.employees.map((e) => `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`).join('');
  document.getElementById('branch').innerHTML = '<option value="">Semua</option>' +
    br.branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');

  document.getElementById('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new URLSearchParams();
    const map = { date_from: 'date_from', date_to: 'date_to', employee: 'employee_id', status: 'status', method: 'method', branch: 'branch_id' };
    for (const [id, key] of Object.entries(map)) {
      const v = document.getElementById(id).value;
      if (v) q.set(key, v);
    }
    window.location.href = `/api/export/attendance.csv?${q}`;
  });
});
