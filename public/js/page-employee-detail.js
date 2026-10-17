// Admin: employee detail.
import { initAdminPage, get, post, patch, escapeHtml, toast } from '../js/api.js';
import { fmtDate, fmtTime, statusBadge, fmtRupiah } from '../js/ui.js';

initAdminPage(async () => {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) { window.location.href = '/admin/employees.html'; return; }
  let employee = null;
  let branches = [];

  const { branches: bs } = await get('/api/branches');
  branches = bs;
  document.getElementById('e-branch').innerHTML = '<option value="">-</option>' +
    bs.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');

  async function load() {
    const data = await get(`/api/employees/${id}`);
    employee = data.employee;
    document.getElementById('title').textContent = employee.full_name;
    document.getElementById('qr-link').href = `/api/employees/${id}/qrcode.png?size=300`;
    document.getElementById('face-link').href = `/admin/face-register.html?employee_id=${id}`;
    document.getElementById('qr-img').src = `/api/employees/${id}/qrcode.png?size=300`;
    document.getElementById('qr-code').textContent = employee.qr_code;

    const p = employee;
    document.getElementById('profile').innerHTML = `
      <tr><th>Kode</th><td>${escapeHtml(p.employee_code)}</td></tr>
      <tr><th>Username</th><td>${escapeHtml(p.username)}</td></tr>
      <tr><th>Jabatan</th><td>${escapeHtml(p.position || '-')}</td></tr>
      <tr><th>Telepon</th><td>${escapeHtml(p.phone || '-')}</td></tr>
      <tr><th>Tgl Masuk</th><td>${p.join_date ? fmtDate(p.join_date) : '-'}</td></tr>
      <tr><th>Cabang</th><td>${escapeHtml(p.branch_name || '-')}</td></tr>
      <tr><th>Wajah</th><td>${p.has_face ? '<span class="badge ok">Terdaftar</span>' : '<span class="badge gray">Belum terdaftar</span>'}</td></tr>
      <tr><th>Status</th><td>${p.is_active ? '<span class="badge ok">Aktif</span>' : '<span class="badge err">Nonaktif</span>'}</td></tr>`;

    const tbody = document.getElementById('recent');
    const rows = p.recent_attendance || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Belum ada absensi</td></tr>';
    } else {
      tbody.innerHTML = rows.map((r) => `
        <tr><td>${fmtDate(r.date)}</td><td>${fmtTime(r.time)}</td><td>${escapeHtml(r.type)}</td>
        <td>${escapeHtml(r.method)}</td><td>${statusBadge(r.status)}</td><td>${escapeHtml(r.location_name || '-')}</td></tr>`).join('');
    }

    await loadRecap();
  }

  async function loadRecap() {
    try {
      const r = await get(`/api/attendance/recap?employee_id=${id}`);
      const own = (r.items && r.items[0]) || { hadir_count: 0, late_count: 0, izin_count: 0, total_deduction: 0 };
      const cards = [
        { label: 'Hadir', value: own.hadir_count, cls: 'ok' },
        { label: 'Telat', value: own.late_count, cls: 'warn' },
        { label: 'Izin', value: own.izin_count, cls: '' },
        { label: 'Total Potongan', value: fmtRupiah(own.total_deduction), cls: 'err', small: true },
      ];
      document.getElementById('emp-recap').innerHTML = cards.map((c) =>
        `<div class="stat ${c.cls}"><div class="label">${c.label}</div><div class="value"${c.small ? ' style="font-size:1.2rem"' : ''}>${c.value}</div></div>`
      ).join('');
    } catch { /* ignore */ }
  }

  document.getElementById('edit-btn').addEventListener('click', () => {
    document.getElementById('e-fullname').value = employee.full_name;
    document.getElementById('e-position').value = employee.position || '';
    document.getElementById('e-phone').value = employee.phone || '';
    document.getElementById('e-join').value = employee.join_date || '';
    document.getElementById('e-branch').value = employee.branch_id || '';
    document.getElementById('e-active').checked = employee.is_active;
    document.getElementById('e-password').value = '';
    document.getElementById('modal').classList.remove('hidden');
  });
  document.getElementById('cancel-btn').addEventListener('click', () => document.getElementById('modal').classList.add('hidden'));

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      full_name: document.getElementById('e-fullname').value.trim(),
      position: document.getElementById('e-position').value.trim() || null,
      phone: document.getElementById('e-phone').value.trim() || null,
      join_date: document.getElementById('e-join').value || null,
      branch_id: document.getElementById('e-branch').value || null,
      is_active: document.getElementById('e-active').checked,
    };
    const pw = document.getElementById('e-password').value;
    if (pw) payload.password = pw;
    try {
      await patch(`/api/employees/${id}`, payload);
      toast('Data diperbarui', 'ok');
      document.getElementById('modal').classList.add('hidden');
      load();
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('regen-btn').addEventListener('click', async () => {
    try {
      const r = await post(`/api/employees/${id}/qrcode/regenerate`);
      toast('QR Code diperbarui', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  });

  await load();
});
