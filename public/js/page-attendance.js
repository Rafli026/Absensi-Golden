// Admin: attendance listing + edit/delete + manual entry.
import { initAdminPage, get, post, patch, del, escapeHtml, toast } from '../js/api.js';
import { fmtDate, fmtTime, statusBadge, confirmDialog } from '../js/ui.js';

initAdminPage(async () => {
  const tbody = document.getElementById('rows');
  const limit = 25;
  let offset = 0;
  let total = 0;
  let employees = [];

  async function loadFilters() {
    const [emp, br] = await Promise.all([get('/api/employees'), get('/api/branches')]);
    employees = emp.employees;
    const empOpts = employees.map((e) => `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`).join('');
    document.getElementById('employee').innerHTML = '<option value="">Semua</option>' + empOpts;
    document.getElementById('m-employee').innerHTML = '<option value="">- pilih -</option>' + empOpts;
    document.getElementById('branch').innerHTML = '<option value="">Semua</option>' +
      br.branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  }

  function query() {
    const q = new URLSearchParams();
    for (const id of ['date_from', 'date_to', 'employee', 'status', 'method', 'branch']) {
      const v = document.getElementById(id).value;
      if (v) q.set(id === 'employee' ? 'employee_id' : id === 'branch' ? 'branch_id' : id, v);
    }
    q.set('limit', limit);
    q.set('offset', offset);
    return q;
  }

  async function load() {
    const data = await get(`/api/attendance?${query()}`);
    total = data.total;
    if (!data.attendance.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">Tidak ada data</td></tr>';
    } else {
      tbody.innerHTML = data.attendance.map((r) => `
        <tr>
          <td>${escapeHtml(r.employee_name)}</td>
          <td>${fmtDate(r.date)}</td>
          <td>${fmtTime(r.time)}</td>
          <td>${escapeHtml(r.type)}</td>
          <td>${escapeHtml(r.method)}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${escapeHtml(r.location_name || '-')}</td>
          <td class="wrap">${escapeHtml(r.note || '-')}</td>
          <td>
            <button class="sm secondary" data-edit="${r.id}">Edit</button>
            <button class="sm danger" data-del="${r.id}">Hapus</button>
          </td>
        </tr>`).join('');
      tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog('Hapus data absensi ini?'))) return;
        try { await del(`/api/attendance/${b.dataset.del}`); toast('Dihapus', 'ok'); load(); }
        catch (err) { toast(err.message, 'err'); }
      }));
      tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editRow(data.attendance.find((x) => x.id === +b.dataset.edit))));
    }
    document.getElementById('total-info').textContent = `Menampilkan ${offset + 1}-${Math.min(offset + limit, total)} dari ${total}`;
    document.getElementById('prev-btn').disabled = offset === 0;
    document.getElementById('next-btn').disabled = offset + limit >= total;
  }

  async function editRow(r) {
    const status = prompt(`Status baru untuk ${r.employee_name} (Hadir/Terlambat/Pulang/Izin):`, r.status);
    if (status === null) return;
    const time = prompt('Waktu (HH:mm:ss):', r.time);
    if (time === null) return;
    const note = prompt('Catatan:', r.note || '');
    if (note === null) return;
    try {
      await patch(`/api/attendance/${r.id}`, { status, time, note });
      toast('Diperbarui', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  }

  document.getElementById('filter-btn').addEventListener('click', () => { offset = 0; load(); });
  document.getElementById('reset-btn').addEventListener('click', () => {
    for (const id of ['date_from', 'date_to', 'employee', 'status', 'method', 'branch']) document.getElementById(id).value = '';
    offset = 0; load();
  });
  document.getElementById('prev-btn').addEventListener('click', () => { offset = Math.max(0, offset - limit); load(); });
  document.getElementById('next-btn').addEventListener('click', () => { offset += limit; load(); });

  document.getElementById('manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      employee_id: Number(document.getElementById('m-employee').value),
      type: document.getElementById('m-type').value,
      status: document.getElementById('m-status').value,
      note: document.getElementById('m-note').value.trim() || null,
    };
    if (!payload.employee_id) { toast('Pilih karyawan', 'warn'); return; }
    const d = document.getElementById('m-date').value;
    const t = document.getElementById('m-time').value;
    if (d) payload.date = d;
    if (t) payload.time = t.length === 5 ? `${t}:00` : t;
    try {
      await post('/api/attendance/manual', payload);
      toast('Absensi manual disimpan', 'ok');
      document.getElementById('manual-form').reset();
      load();
    } catch (err) { toast(err.message, 'err'); }
  });

  await loadFilters();
  await load();
});
