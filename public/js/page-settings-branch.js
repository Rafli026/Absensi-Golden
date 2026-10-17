// Admin: branch CRUD + location/general settings.
import { initAdminPage, get, post, patch, del, escapeHtml, toast } from '../js/api.js';
import { getPosition, confirmDialog, fmtRupiah } from '../js/ui.js';

initAdminPage(async () => {
  const modal = document.getElementById('modal');
  const form = document.getElementById('branch-form');
  const modeEl = document.getElementById('late-mode');
  const blockRow = document.getElementById('mode-block');
  const flatRow = document.getElementById('mode-flat');
  const simEl = document.getElementById('late-sim');
  let branches = [];

  function currentRules() {
    return {
      mode: modeEl.value,
      blockMinutes: Math.max(1, Number(document.getElementById('late-block-minutes').value) || 10),
      perBlock: Number(document.getElementById('late-per-block').value) || 0,
      perOccurrence: Number(document.getElementById('late-deduction').value) || 0,
    };
  }

  // Mirror of server/lib/deduction.js so the preview matches exactly.
  function computeDeduction(lateMinutes, rules) {
    const minutes = Math.max(0, Number(lateMinutes) || 0);
    if (minutes <= 0) return { deduction: 0, blocks: 0 };
    if (rules.mode === 'per_minute_block') {
      const blocks = Math.ceil(minutes / Math.max(1, rules.blockMinutes));
      return { deduction: blocks * Math.max(0, rules.perBlock), blocks };
    }
    return { deduction: Math.max(0, rules.perOccurrence), blocks: 0 };
  }

  function renderSim() {
    const rules = currentRules();
    if (rules.mode === 'per_minute_block') {
      const samples = [5, 10, 25].map((m) => {
        const r = computeDeduction(m, rules);
        return `${m} mnt → ${r.blocks} blok = ${fmtRupiah(r.deduction)}`;
      });
      simEl.textContent = `Setiap ${rules.blockMinutes} menit telat dipotong ${fmtRupiah(rules.perBlock)}. ` + samples.join(' • ');
    } else {
      simEl.textContent = `Setiap kejadian telat dipotong ${fmtRupiah(rules.perOccurrence)}, berapa pun menitnya.`;
    }
  }

  function toggleMode() {
    const isBlock = modeEl.value === 'per_minute_block';
    blockRow.classList.toggle('hidden', !isBlock);
    flatRow.classList.toggle('hidden', isBlock);
    renderSim();
  }

  async function loadSettings() {
    const s = await get('/api/settings/location');
    document.getElementById('cooldown').value = s.attendance_cooldown_seconds;
    document.getElementById('threshold').value = s.face_match_threshold;
    document.getElementById('late-deduction').value = s.late_deduction_per_occurrence ?? 0;
    document.getElementById('late-per-block').value = s.late_deduction_per_block ?? 0;
    document.getElementById('late-block-minutes').value = s.late_deduction_block_minutes ?? 10;
    modeEl.value = s.late_deduction_mode === 'per_minute_block' ? 'per_minute_block' : 'per_occurrence';
    document.getElementById('loc-enabled').checked = s.location_validation_enabled;
    document.getElementById('liveness-enabled').checked = s.liveness_enabled;
    toggleMode();
  }

  async function loadBranches() {
    const { branches: bs } = await get('/api/branches');
    branches = bs;
    const tbody = document.getElementById('branches');
    tbody.innerHTML = bs.map((b) => `
      <tr>
        <td>${escapeHtml(b.name)}</td>
        <td class="wrap">${escapeHtml(b.address || '-')}</td>
        <td>${b.latitude != null ? `${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}` : '<span class="muted">belum diset</span>'}</td>
        <td>${b.radius_meters}</td>
        <td>${b.is_active ? '<span class="badge ok">Aktif</span>' : '<span class="badge err">Nonaktif</span>'}</td>
        <td>
          <button class="sm secondary" data-edit="${b.id}">Edit</button>
          <button class="sm danger" data-del="${b.id}">Nonaktifkan</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openEdit(branches.find((x) => x.id === +btn.dataset.edit))));
    tbody.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Nonaktifkan cabang ini?'))) return;
      try { await del(`/api/branches/${btn.dataset.del}`); toast('Cabang dinonaktifkan', 'ok'); loadBranches(); }
      catch (err) { toast(err.message, 'err'); }
    }));

    document.getElementById('active-branch').innerHTML = bs.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    const s = await get('/api/settings/location');
    document.getElementById('active-branch').value = s.active_branch_id;
  }

  function openAdd() {
    document.getElementById('modal-title').textContent = 'Tambah Cabang';
    form.reset();
    document.getElementById('b-id').value = '';
    document.getElementById('b-radius').value = 100;
    modal.classList.remove('hidden');
  }

  function openEdit(b) {
    if (!b) return;
    document.getElementById('modal-title').textContent = 'Edit Cabang';
    document.getElementById('b-id').value = b.id;
    document.getElementById('b-name').value = b.name;
    document.getElementById('b-address').value = b.address || '';
    document.getElementById('b-lat').value = b.latitude ?? '';
    document.getElementById('b-lng').value = b.longitude ?? '';
    document.getElementById('b-radius').value = b.radius_meters;
    modal.classList.remove('hidden');
  }

  document.getElementById('add-branch').addEventListener('click', openAdd);
  document.getElementById('cancel-btn').addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('use-loc').addEventListener('click', async () => {
    const pos = await getPosition();
    if (!pos) { toast('Lokasi tidak tersedia. Izinkan akses lokasi di browser.', 'warn'); return; }
    document.getElementById('b-lat').value = pos.latitude;
    document.getElementById('b-lng').value = pos.longitude;
    toast('Koordinat diambil dari lokasi Anda', 'ok');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('b-id').value;
    const payload = {
      name: document.getElementById('b-name').value.trim(),
      address: document.getElementById('b-address').value.trim() || null,
      latitude: document.getElementById('b-lat').value === '' ? null : Number(document.getElementById('b-lat').value),
      longitude: document.getElementById('b-lng').value === '' ? null : Number(document.getElementById('b-lng').value),
      radius_meters: Number(document.getElementById('b-radius').value) || 100,
    };
    try {
      if (id) await patch(`/api/branches/${id}`, payload);
      else await post('/api/branches', payload);
      toast('Cabang disimpan', 'ok');
      modal.classList.add('hidden');
      loadBranches();
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('general-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      attendance_cooldown_seconds: Number(document.getElementById('cooldown').value),
      face_match_threshold: Number(document.getElementById('threshold').value),
      late_deduction_mode: modeEl.value,
      late_deduction_per_occurrence: Number(document.getElementById('late-deduction').value) || 0,
      late_deduction_per_block: Number(document.getElementById('late-per-block').value) || 0,
      late_deduction_block_minutes: Number(document.getElementById('late-block-minutes').value) || 10,
      active_branch_id: Number(document.getElementById('active-branch').value),
      location_validation_enabled: document.getElementById('loc-enabled').checked,
      liveness_enabled: document.getElementById('liveness-enabled').checked,
    };
    try {
      await patch('/api/settings/location', payload);
      toast('Pengaturan disimpan', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  // Live preview
  modeEl.addEventListener('change', toggleMode);
  for (const id of ['late-block-minutes', 'late-per-block', 'late-deduction']) {
    document.getElementById(id).addEventListener('input', renderSim);
  }

  await loadSettings();
  await loadBranches();
});
