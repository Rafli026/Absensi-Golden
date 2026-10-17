// Face recognition attendance page.
import { requireLogin, renderNav, post, get, escapeHtml, toast } from './api.js';
import { getPosition, loading } from './ui.js';
import { loadFaceApi, detectDescriptor, checkLiveness } from './face.js';

(async () => {
  let user;
  try {
    user = await requireLogin();
    renderNav(user);
  } catch { return; }

  const video = document.getElementById('video');
  const placeholder = document.getElementById('placeholder');
  const resultEl = document.getElementById('result');
  const statusEl = document.getElementById('status');
  const scanBtn = document.getElementById('scan-btn');
  const retryBtn = document.getElementById('retry-btn');
  let stream = null;
  let ready = false;
  let livenessEnabled = true;

  // Fetch liveness setting.
  try {
    const s = await get('/api/settings/public');
    if (s && typeof s.liveness_enabled === 'boolean') livenessEnabled = s.liveness_enabled;
  } catch { /* ignore */ }

  async function init() {
    resultEl.innerHTML = '';
    retryBtn.classList.add('hidden');
    try {
      placeholder.classList.remove('hidden');
      placeholder.textContent = 'Meminta akses kamera...';
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      video.srcObject = stream;
      await video.play();

      statusEl.textContent = 'Memuat model pengenalan wajah (~7 MB, mohon tunggu)...';
      await loadFaceApi((msg) => { statusEl.textContent = msg; });
      ready = true;
      placeholder.classList.add('hidden');
      statusEl.textContent = 'Model siap. Klik "Absen Sekarang" dan pastikan wajah terlihat jelas.';
      scanBtn.disabled = false;
    } catch (err) {
      ready = false;
      scanBtn.disabled = true;
      placeholder.textContent = 'Kamera/model gagal dimuat.';
      showError(`${err.message}. Gunakan browser Chrome/Edge terbaru, atau pakai QR Code sebagai alternatif.`);
      statusEl.textContent = '';
    }
  }

  function showError(msg) {
    resultEl.innerHTML = `<div class="confirm-card fail"><div class="name">Gagal</div><div>${escapeHtml(msg)}</div></div>`;
  }

  function showNoMatch() {
    resultEl.innerHTML = `<div class="confirm-card fail">
      <div class="name">Wajah tidak dikenali</div>
      <div>Wajah Anda belum terdaftar atau tidak cocok. Hubungi admin untuk mendaftarkan wajah.</div>
    </div>`;
  }

  function showSuccess(data) {
    const a = data.attendance;
    resultEl.innerHTML = `<div class="confirm-card">
      <div class="muted">${escapeHtml(a.type)}</div>
      <div class="name">${escapeHtml(data.employee.full_name)}</div>
      <div class="muted">${escapeHtml(data.employee.employee_code)}</div>
      <div class="mt-1">${escapeHtml(data.message)}</div>
      <div class="mt-1"><span class="badge ${a.status === 'Terlambat' ? 'warn' : 'ok'}">${escapeHtml(a.status)}</span>
        <span class="badge gray">${escapeHtml(a.time)}</span></div>
    </div>`;
  }

  scanBtn.addEventListener('click', async () => {
    if (!ready) return;
    scanBtn.disabled = true;
    resultEl.innerHTML = '';
    loading(true);
    try {
      // Weak liveness (movement) check.
      if (livenessEnabled) {
        statusEl.textContent = 'Memeriksa kehadiran langsung (liveness)...';
        const live = await checkLiveness(video, { frames: 3, minMovementPx: 4, onProgress: (n, t) => { statusEl.textContent = `Liveness: ${n}/${t}`; } });
        if (!live.ok) {
          showError(live.reason);
          statusEl.textContent = '';
          return;
        }
      }
      statusEl.textContent = 'Mengambil data wajah...';
      const det = await detectDescriptor(video);
      if (!det) {
        showError('Wajah tidak terdeteksi. Pastikan pencahayaan cukup.');
        statusEl.textContent = '';
        return;
      }
      const pos = await getPosition();
      const payload = { descriptor: det.descriptor };
      if (pos) { payload.latitude = pos.latitude; payload.longitude = pos.longitude; payload.accuracy = pos.accuracy; }

      statusEl.textContent = 'Mencocokkan dengan data server...';
      const data = await post('/api/attendance/face', payload);
      if (!data.matched) {
        showNoMatch();
        toast('Wajah tidak dikenali', 'warn');
      } else {
        showSuccess(data);
        toast(data.message, 'ok');
      }
      statusEl.textContent = '';
    } catch (err) {
      showError(err.message);
      statusEl.textContent = '';
      toast(err.message, 'err');
    } finally {
      loading(false);
      scanBtn.disabled = false;
      retryBtn.classList.remove('hidden');
    }
  });

  retryBtn.addEventListener('click', () => { resultEl.innerHTML = ''; statusEl.textContent = ''; retryBtn.classList.add('hidden'); });
  window.addEventListener('beforeunload', () => { if (stream) for (const t of stream.getTracks()) t.stop(); });

  await init();
})();
