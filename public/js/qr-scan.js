// QR scanner: getUserMedia + canvas + jsQR loop.

let stream = null;
let rafId = null;
let lastCode = null;
let lastCodeAt = 0;

/**
 * List available video input devices.
 * NOTE: labels are only filled after camera permission has been granted.
 */
export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
  } catch {
    return [];
  }
}

/**
 * Start scanning from the camera into videoEl.
 * Options:
 *   facingMode: 'environment' (kamera belakang) | 'user' (kamera depan)
 *   deviceId:   specific camera id (overrides facingMode when set)
 * Calls onResult(code) for decoded QR codes (debounced 2s per duplicate).
 */
export async function startScanner({ videoEl, onResult, onError, facingMode = 'environment', deviceId } = {}) {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser tidak mendukung akses kamera (getUserMedia)');
    }

    // Stop any previous stream before opening a new one.
    stopScanner();

    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } };

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      // If the requested facing mode is unavailable, fall back to any camera.
      if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw err;
      }
    }

    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', 'true');
    await videoEl.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const jsQR = window.jsQR;
    if (typeof jsQR !== 'function') {
      throw new Error('Library pemindai QR (jsQR) gagal dimuat');
    }

    const tick = () => {
      if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA && videoEl.videoWidth) {
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(videoEl, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          const now = Date.now();
          if (code.data !== lastCode || now - lastCodeAt > 2000) {
            lastCode = code.data;
            lastCodeAt = now;
            onResult(code.data);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return true;
  } catch (err) {
    if (onError) onError(err);
    else throw err;
    return false;
  }
}

/** Stop the camera and scanning loop. */
export function stopScanner() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
}
