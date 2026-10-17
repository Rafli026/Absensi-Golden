// Employee: own attendance history + monthly recap (no money figures).
import { initAuthPage, get, escapeHtml, toast } from '../js/api.js';
import { fmtDate, fmtTime, statusBadge } from '../js/ui.js';

initAuthPage(async () => {
  const tbody = document.getElementById('rows');
  const periodEl = document.getElementById('recap-period');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  periodEl.value = today.slice(0, 7);

  async function loadRecap() {
    const q = new URLSearchParams();
    if (periodEl.value) q.set('period', periodEl.value);
    const r = await get(`/api/attendance/recap?${q}`);
    const own = (r.items && r.items[0]) || { hadir_count: 0, late_count: 0, izin_count: 0 };
    const cards = [
      { label: 'Hadir', value: own.hadir_count, cls: 'ok' },
      { label: 'Telat', value: own.late_count, cls: 'warn' },
      { label: 'Izin', value: own.izin_count, cls: '' },
    ];
    document.getElementById('recap-stats').innerHTML = cards.map((c) =>
      `<div class="stat ${c.cls}"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`
    ).join('');
  }

  async function load() {
    const q = new URLSearchParams();
    const from = document.getElementById('date_from').value;
    const to = document.getElementById('date_to').value;
    if (from) q.set('date_from', from);
    if (to) q.set('date_to', to);
    const data = await get(`/api/attendance/me?${q}`);
    if (!data.attendance.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Belum ada data absensi</td></tr>';
      return;
    }
    tbody.innerHTML = data.attendance.map((r) => `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td>${fmtTime(r.time)}</td>
        <td>${escapeHtml(r.type)}</td>
        <td>${escapeHtml(r.method)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${escapeHtml(r.location_name || '-')}</td>
      </tr>`).join('');
  }

  document.getElementById('filter-btn').addEventListener('click', () => load().catch((e) => toast(e.message, 'err')));
  document.getElementById('reset-btn').addEventListener('click', () => {
    document.getElementById('date_from').value = '';
    document.getElementById('date_to').value = '';
    load().catch((e) => toast(e.message, 'err'));
  });
  periodEl.addEventListener('change', () => loadRecap().catch((e) => toast(e.message, 'err')));

  await Promise.all([
    load(),
    loadRecap().catch((e) => toast(e.message, 'err')),
  ]);
});
