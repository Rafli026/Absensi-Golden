// Admin: printable QR badges.
import { initAdminPage, get, escapeHtml, toast } from '../js/api.js';

initAdminPage(async () => {
  const { employees } = await get('/api/employees?active=true');
  const grid = document.getElementById('grid');
  if (!employees.length) {
    grid.innerHTML = '<div class="empty">Belum ada karyawan aktif</div>';
    return;
  }
  grid.innerHTML = employees.map((e) => `
    <div class="qr-badge">
      <div class="name">${escapeHtml(e.full_name)}</div>
      <div class="code">${escapeHtml(e.employee_code)}</div>
      <img src="/api/employees/${e.id}/qrcode.png?size=300" alt="QR ${escapeHtml(e.employee_code)}" />
      <div class="muted" style="font-size:0.75rem">${escapeHtml(e.branch_name || '')}</div>
    </div>`).join('');
  document.getElementById('print-btn').addEventListener('click', () => window.print());
});
