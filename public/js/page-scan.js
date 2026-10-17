// QR scan attendance page.
import { requireLogin, renderNav, post, escapeHtml, toast } from './api.js';
import { getPosition, loading } from './ui.js';
import { startScanner, stopScanner, listCameras } from './qr-scan.js';

(async () => {
  let user;
  try {
    user = await requireLogin();
    renderNav(user);
  } catch { return; }

  const video = document.getElementById('video');
  const placeholder = document.getElementById('placeholder');
  const resultEl = document.getElementById('result');
  const rescanBtn = document.getElementById('rescan-btn');
  const camSelect = document.getElementById('camera-select');
  const switchBtn = document.getElementById('switch-btn');
  let processing = false;
  let starting = false;

  async function handleCode(code) {
    if (processing) return;
    processing = true;
    loading(true);
    resultEl.innerHTML = '';
    try {
      const pos = await getPosition();
      const payload = { code };
      if (pos) {
        payload.latitude = pos.latitude;
        payload.longitude = pos.longitude;
        payload.accuracy = pos.accuracy;
      }
      const data = await post('/api/attendance/qr', payload);
      showSuccess(data);
      toast(data.message, 'ok');
    } catch (err) {
      showError(err.message);
      toast(err.message, 'err');
    } finally {
      loading(false);
      processing = false;
      rescanBtn.classList.remove('hidden');
    }
  }

  function showSuccess(data) {
    const e = data.employee;
    const a = data.attendance;
    resultEl.innerHTML = `
      <div class="confirm-card">
        <div class="muted">${escapeHtml(a.type)}</div>
        <div class="name">${escapeHtml(e.full_name)}</div>
        <div class="muted">${escapeHtml(e.employee_code)}</div>
        <div class="mt-1">${escapeHtml(data.message)}</div>
        <div class="mt-1"><span class="badge ${a.status === 'Terlambat' ? 'warn' : 'ok'}">${escapeHtml(a.status)}</span>
          <span class="badge gray">${escapeHtml(a.time)}</span></div>
      </div>`;
    stopScanner();
  }

  function showError(msg) {
    resultEl.innerHTML = `
      <div class="confirm-card fail">
        <div class="name">Gagal</div>
        <div>${escapeHtml(msg)}</div>
      </div>`;
  }

  // Refresh the camera dropdown from the device list (labels need permission).
  async function refreshCameraList() {
    const cams = await listCameras();
    if (cams.length === 0) return;
    // Keep the manual "Belakang/Depan" choices, and add named devices.
    const current = camSelect.value;
    const manual = `
      <option value="environment">📷 Kamera Belakang</option>
      <option value="user">🤳 Kamera Depan</option>`;
    const named = cams
      .map((c, i) => `<option value="device:${c.deviceId}">🎥 ${escapeHtml(c.label || `Kamera ${i + 1}`)}</option>`)
      .join('');
    camSelect.innerHTML = manual + named;
    // Restore selection if still present.
    if ([...camSelect.options].some((o) => o.value === current)) camSelect.value = current;
  }

  async function start() {
    if (starting) return;
    starting = true;
    resultEl.innerHTML = '';
    rescanBtn.classList.add('hidden');
    placeholder.classList.remove('hidden');
    placeholder.textContent = 'Meminta akses kamera...';

    const sel = camSelect.value;
    const opts = sel.startsWith('device:')
      ? { deviceId: sel.slice('device:'.length) }
      : { facingMode: sel };

    const ok = await startScanner({
      videoEl: video,
      onResult: handleCode,
      onError: (err) => {
        placeholder.textContent = 'Kamera tidak tersedia.';
        showError(`${err.message}. Coba pilih kamera lain, atau gunakan Face Recognition.`);
      },
      ...opts,
    });
    if (ok) placeholder.classList.add('hidden');
    // After permission is granted, device labels become available.
    await refreshCameraList();
    starting = false;
  }

  rescanBtn.addEventListener('click', start);
  switchBtn.addEventListener('click', start);
  camSelect.addEventListener('change', start);

  await start();
})();
