// Employee: attendance home.
import { initAuthPage, get, escapeHtml } from '../js/api.js';
import { startClock, fmtDate, fmtTime, statusBadge } from '../js/ui.js';

initAuthPage(async () => {
  startClock(document.getElementById('clock'), document.getElementById('clock-date'));

  async function loadToday() {
    const t = await get('/api/attendance/today');
    const banner = document.getElementById('today-status');
    const map = {
      'Belum Absen': 'gray', 'Sudah Masuk': 'ok', 'Terlambat': 'warn', 'Sudah Pulang': 'ok', 'Izin': 'gray',
    };
    banner.className = `status-banner ${map[t.status] || 'gray'}`;
    banner.textContent = `Status hari ini: ${t.status}`;

    const rows = [
      ['Tanggal', t.date ? fmtDate(t.date) : '-'],
      ['Absen Masuk', t.check_in ? `${fmtTime(t.check_in.time)} — ${t.check_in.status}` : 'Belum'],
      ['Absen Pulang', t.check_out ? `${fmtTime(t.check_out.time)}` : 'Belum'],
    ];
    document.getElementById('today-detail').innerHTML = rows.map(([k, v]) =>
      `<div class="stat"><div class="label">${k}</div><div class="value" style="font-size:1.1rem">${escapeHtml(String(v))}</div></div>`
    ).join('');

    if (t.branch_name) {
      document.getElementById('branch-info').textContent = `📍 Cabang: ${t.branch_name}`;
    }
  }

  // Branch info comes from the /today response (employees cannot read /api/branches).

  async function loadRecap() {
    const r = await get('/api/attendance/recap');
    const own = (r.items && r.items[0]) || { hadir_count: 0, late_count: 0, izin_count: 0 };
    const cards = [
      { label: 'Hadir', value: own.hadir_count, cls: 'ok' },
      { label: 'Telat', value: own.late_count, cls: 'warn' },
      { label: 'Izin', value: own.izin_count, cls: '' },
    ];
    document.getElementById('month-recap').innerHTML = cards.map((c) =>
      `<div class="stat ${c.cls}"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`
    ).join('');
  }

  document.getElementById('btn-in').addEventListener('click', () => { window.location.href = '/scan.html?mode=masuk'; });
  document.getElementById('btn-out').addEventListener('click', () => { window.location.href = '/scan.html?mode=pulang'; });

  await loadToday();
  await loadRecap().catch(() => {});
  // Refresh today status every 30s.
  setInterval(loadToday, 30000);
});
