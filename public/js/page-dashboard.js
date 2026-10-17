// Admin dashboard.
import { initAdminPage, get, escapeHtml, toast } from '../js/api.js';
import { fmtDate, fmtTime, statusBadge, fmtRupiah, fmtPeriod } from '../js/ui.js';

initAdminPage(async () => {
  const dateEl = document.getElementById('date');
  const branchEl = document.getElementById('branch');
  const periodEl = document.getElementById('period');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  dateEl.value = today;
  periodEl.value = today.slice(0, 7);

  // Load branches for the filter.
  try {
    const { branches } = await get('/api/branches');
    branchEl.innerHTML = '<option value="">Semua Cabang</option>' +
      branches.filter((b) => b.is_active).map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  } catch { /* ignore */ }

  async function loadSummary() {
    const q = new URLSearchParams();
    if (dateEl.value) q.set('date', dateEl.value);
    if (branchEl.value) q.set('branch_id', branchEl.value);
    const s = await get(`/api/dashboard/summary?${q}`);
    renderStats(s);
    renderRecent(s.recent);
  }

  async function loadChart() {
    const q = new URLSearchParams({ days: '7' });
    if (branchEl.value) q.set('branch_id', branchEl.value);
    const c = await get(`/api/dashboard/chart?${q}`);
    renderChart(c);
  }

  async function loadRecap() {
    const q = new URLSearchParams();
    if (periodEl.value) q.set('period', periodEl.value);
    if (branchEl.value) q.set('branch_id', branchEl.value);
    const r = await get(`/api/dashboard/recap?${q}`);
    renderRecap(r);
  }

  function renderRecap(r) {
    const tbody = document.getElementById('recap-rows');
    const note = document.getElementById('recap-note');
    let ruleText;
    if (r.rules && r.rules.mode === 'per_minute_block') {
      ruleText = `Denda: ${fmtRupiah(r.rules.perBlock)} setiap ${r.rules.blockMinutes} menit telat`;
    } else {
      ruleText = `Denda: ${fmtRupiah(r.rules ? r.rules.perOccurrence : r.deduction_per_occurrence)} per kejadian telat`;
    }
    note.textContent = `Periode: ${fmtPeriod(r.period)} • ${ruleText}`;
    if (!r.items || r.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Belum ada karyawan</td></tr>';
      document.getElementById('recap-foot').innerHTML = '';
      return;
    }
    tbody.innerHTML = r.items.map((i) => `
      <tr>
        <td>${escapeHtml(i.employee_name)}</td>
        <td>${escapeHtml(i.employee_code || '-')}</td>
        <td>${i.hadir_count}</td>
        <td>${i.late_count > 0 ? `<span class="badge warn">${i.late_count}</span>` : '0'}</td>
        <td>${i.late_minutes_total > 0 ? `${i.late_minutes_total} mnt` : '-'}</td>
        <td>${i.izin_count > 0 ? `<span class="badge gray">${i.izin_count}</span>` : '0'}</td>
        <td><b>${i.total_deduction > 0 ? `<span class="badge err">${fmtRupiah(i.total_deduction)}</span>` : fmtRupiah(0)}</b></td>
        <td><a href="/admin/employee-detail.html?id=${i.employee_id}" class="btn sm secondary">Detail</a></td>
      </tr>`).join('');
    document.getElementById('recap-foot').innerHTML = `
      <tr style="font-weight:700;background:var(--panel-2)">
        <td colspan="3">TOTAL</td>
        <td>${r.totals.late_count}</td>
        <td>${r.totals.late_minutes_total || 0} mnt</td>
        <td>${r.totals.izin_count}</td>
        <td>${fmtRupiah(r.totals.total_deduction)}</td>
        <td></td>
      </tr>`;
  }

  function renderStats(s) {
    const items = [
      { label: 'Total Karyawan', value: s.total_employees, cls: '' },
      { label: 'Hadir', value: s.hadir, cls: 'ok' },
      { label: 'Terlambat', value: s.terlambat, cls: 'warn' },
      { label: 'Belum Absen', value: s.belum_absen, cls: 'err' },
      { label: 'Sudah Pulang', value: s.sudah_pulang, cls: 'info' },
      { label: 'Izin', value: s.izin, cls: '' },
    ];
    document.getElementById('stats').innerHTML = items.map((i) =>
      `<div class="stat ${i.cls}"><div class="label">${i.label}</div><div class="value">${i.value}</div></div>`
    ).join('');
  }

  function renderRecent(rows) {
    const tbody = document.getElementById('recent');
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Belum ada data absensi</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.employee_name)}</td>
        <td>${fmtDate(r.date)}</td>
        <td>${fmtTime(r.time)}</td>
        <td>${escapeHtml(r.type)}</td>
        <td>${escapeHtml(r.method)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`).join('');
  }

  function renderChart(c) {
    const max = Math.max(1, ...c.hadir, ...c.terlambat);
    document.getElementById('chart').innerHTML = c.labels.map((label, i) => {
      const hPct = Math.round((c.hadir[i] / max) * 100);
      const tPct = Math.round((c.terlambat[i] / max) * 100);
      return `<div class="bar-col">
        <div class="bars">
          <div class="bar" style="height:${hPct}%" title="Hadir: ${c.hadir[i]}"></div>
          <div class="bar terlambat" style="height:${tPct}%" title="Terlambat: ${c.terlambat[i]}"></div>
        </div>
        <div class="bar-label">${label.slice(0, 5)}</div>
      </div>`;
    }).join('');
  }

  async function reload() {
    try {
      await Promise.all([loadSummary(), loadChart(), loadRecap()]);
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  document.getElementById('refresh').addEventListener('click', reload);
  document.getElementById('recap-refresh').addEventListener('click', loadRecap);
  dateEl.addEventListener('change', loadSummary);
  periodEl.addEventListener('change', loadRecap);
  branchEl.addEventListener('change', reload);

  await reload();
});
