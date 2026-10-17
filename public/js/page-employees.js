// Admin: employee list + CRUD.
import { initAdminPage, get, post, patch, del, escapeHtml, toast } from '../js/api.js';
import { fmtDate, confirmDialog } from '../js/ui.js';

initAdminPage(async () => {
  const tbody = document.getElementById('rows');
  const modal = document.getElementById('modal');
  const form = document.getElementById('emp-form');
  let branches = [];

  async function loadBranches() {
    const { branches: bs } = await get('/api/branches');
    branches = bs;
    const opts = bs.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    document.getElementById('branch').innerHTML = '<option value="">Semua Cabang</option>' + opts;
    document.getElementById('f-branch').innerHTML = '<option value="">-</option>' + opts;
  }

  async function load() {
    const q = new URLSearchParams();
    const s = document.getElementById('search').value.trim();
    const b = document.getElementById('branch').value;
    const a = document.getElementById('active').value;
    if (s) q.set('search', s);
    if (b) q.set('branch_id', b);
    if (a) q.set('active', a);
    const { employees } = await get(`/api/employees?${q}`);
    if (!employees.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Tidak ada karyawan</td></tr>';
      return;
    }
    tbody.innerHTML = employees.map((e) => `
      <tr>
        <td>${escapeHtml(e.employee_code)}</td>
        <td><a href="/admin/employee-detail.html?id=${e.id}">${escapeHtml(e.full_name)}</a></td>
        <td>${escapeHtml(e.username)}</td>
        <td>${escapeHtml(e.position || '-')}</td>
        <td>${escapeHtml(e.branch_name || '-')}</td>
        <td>${e.has_face ? '<span class="badge ok">Terdaftar</span>' : '<span class="badge gray">Belum</span>'}</td>
        <td>${e.is_active ? '<span class="badge ok">Aktif</span>' : '<span class="badge err">Nonaktif</span>'}</td>
        <td>
          <button class="sm secondary" data-edit="${e.id}">Edit</button>
          <button class="sm danger" data-del="${e.id}" data-name="${escapeHtml(e.full_name)}">Hapus</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-edit]').forEach((b2) => b2.addEventListener('click', () => openEdit(employees.find((x) => x.id === +b2.dataset.edit))));
    tbody.querySelectorAll('[data-del]').forEach((b2) => b2.addEventListener('click', () => removeEmp(+b2.dataset.del, b2.dataset.name)));
  }

  function openAdd() {
    document.getElementById('modal-title').textContent = 'Tambah Karyawan';
    form.reset();
    document.getElementById('emp-id').value = '';
    document.getElementById('f-username').disabled = false;
    document.getElementById('pw-hint').textContent = '*';
    document.getElementById('f-code').disabled = false;
    modal.classList.remove('hidden');
  }

  function openEdit(e) {
    if (!e) return;
    document.getElementById('modal-title').textContent = 'Edit Karyawan';
    document.getElementById('emp-id').value = e.id;
    document.getElementById('f-fullname').value = e.full_name;
    document.getElementById('f-username').value = e.username;
    document.getElementById('f-username').disabled = true;
    document.getElementById('f-password').value = '';
    document.getElementById('pw-hint').textContent = '(kosongkan jika tidak diubah)';
    document.getElementById('f-code').value = e.employee_code;
    document.getElementById('f-code').disabled = true;
    document.getElementById('f-position').value = e.position || '';
    document.getElementById('f-phone').value = e.phone || '';
    document.getElementById('f-join').value = e.join_date || '';
    document.getElementById('f-branch').value = e.branch_id || '';
    modal.classList.remove('hidden');
  }

  async function removeEmp(id, name) {
    if (!(await confirmDialog(`Hapus karyawan "${name}"? Semua data absensi dan wajah ikut terhapus.`))) return;
    try {
      await del(`/api/employees/${id}`);
      toast('Karyawan dihapus', 'ok');
      load();
    } catch (err) { toast(err.message, 'err'); }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = document.getElementById('emp-id').value;
    const payload = {
      full_name: document.getElementById('f-fullname').value.trim(),
      position: document.getElementById('f-position').value.trim() || null,
      phone: document.getElementById('f-phone').value.trim() || null,
      join_date: document.getElementById('f-join').value || null,
      branch_id: document.getElementById('f-branch').value || null,
    };
    const pw = document.getElementById('f-password').value;
    if (pw) payload.password = pw;
    try {
      if (id) {
        await patch(`/api/employees/${id}`, payload);
        toast('Karyawan diperbarui', 'ok');
      } else {
        payload.username = document.getElementById('f-username').value.trim();
        payload.password = pw;
        payload.employee_code = document.getElementById('f-code').value.trim() || undefined;
        await post('/api/employees', payload);
        toast('Karyawan ditambahkan', 'ok');
      }
      modal.classList.add('hidden');
      load();
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('add-btn').addEventListener('click', openAdd);
  document.getElementById('cancel-btn').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('search').addEventListener('input', debounce(load, 300));
  document.getElementById('branch').addEventListener('change', load);
  document.getElementById('active').addEventListener('change', load);

  await loadBranches();
  await load();
});

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
