// Admin: register face descriptors via camera.
import { initAdminPage, get, post, del, escapeHtml, toast } from '../js/api.js';
import { loadFaceApi, detectDescriptor } from '../js/face.js';
import { confirmDialog } from '../js/ui.js';

initAdminPage(async () => {
  const video = document.getElementById('video');
  const placeholder = document.getElementById('placeholder');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('start-btn');
  const captureBtn = document.getElementById('capture-btn');
  const empSelect = document.getElementById('employee');
  let stream = null;
  let faceapiReady = false;

  // Pre-select employee from query.
  const preId = new URLSearchParams(window.location.search).get('employee_id');

  async function loadEmployees() {
    const { employees } = await get('/api/employees?active=true');
    empSelect.innerHTML = '<option value="">- pilih -</option>' +
      employees.map((e) => `<option value="${e.id}">${escapeHtml(e.full_name)} (${escapeHtml(e.employee_code)})</option>`).join('');
    if (preId) empSelect.value = preId;
  }

  async function loadProfiles() {
    const { profiles } = await get('/api/face/profiles');
    const tbody = document.getElementById('profiles');
    if (!profiles.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Belum ada profil wajah</td></tr>';
      return;
    }
    tbody.innerHTML = profiles.map((p) => `
      <tr>
        <td>${escapeHtml(p.employee_name)}</td>
        <td>${escapeHtml(p.employee_code)}</td>
        <td>${p.sample_count}</td>
        <td><button class="sm danger" data-del="${p.employee_id}" data-name="${escapeHtml(p.employee_name)}">Hapus</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog(`Hapus profil wajah "${b.dataset.name}"?`))) return;
      try { await del(`/api/face/profiles/${b.dataset.del}`); toast('Profil dihapus', 'ok'); loadProfiles(); }
      catch (err) { toast(err.message, 'err'); }
    }));
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
      statusEl.textContent = 'Meminta akses kamera...';
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      video.srcObject = stream;
      await video.play();
      placeholder.classList.add('hidden');
      statusEl.textContent = 'Memuat model wajah (bisa butuh beberapa detik)...';
      await loadFaceApi((msg) => { statusEl.textContent = msg; });
      faceapiReady = true;
      captureBtn.disabled = false;
      statusEl.textContent = 'Kamera siap. Posisikan wajah di dalam kotak lalu klik "Ambil & Simpan Wajah".';
    } catch (err) {
      startBtn.disabled = false;
      statusEl.textContent = '';
      toast(`Gagal memuat: ${err.message}. Gunakan browser Chrome/Edge terbaru.`, 'err', 8000);
      placeholder.textContent = 'Kamera/model gagal dimuat. Lihat pesan kesalahan di atas.';
    }
  });

  captureBtn.addEventListener('click', async () => {
    const empId = empSelect.value;
    if (!empId) { toast('Pilih karyawan terlebih dahulu', 'warn'); return; }
    if (!faceapiReady) { toast('Kamera belum siap', 'warn'); return; }
    captureBtn.disabled = true;
    try {
      statusEl.textContent = 'Mendeteksi wajah...';
      const det = await detectDescriptor(video);
      if (!det) {
        toast('Wajah tidak terdeteksi. Pastikan pencahayaan cukup dan wajah terlihat jelas.', 'warn');
        statusEl.textContent = 'Wajah tidak terdeteksi. Coba lagi.';
        captureBtn.disabled = false;
        return;
      }
      const res = await post('/api/face/register', { employee_id: Number(empId), descriptor: det.descriptor });
      toast(`Wajah tersimpan (sampel: ${res.sample_count})`, 'ok');
      statusEl.textContent = 'Wajah berhasil disimpan.';
      loadProfiles();
    } catch (err) {
      toast(err.message, 'err');
      statusEl.textContent = '';
    } finally {
      captureBtn.disabled = false;
    }
  });

  window.addEventListener('beforeunload', () => {
    if (stream) for (const t of stream.getTracks()) t.stop();
  });

  await loadEmployees();
  await loadProfiles();
});
