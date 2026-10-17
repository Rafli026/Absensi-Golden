// Face recognition helpers: load face-api, detect descriptors, weak liveness.

let faceapiModule = null;

/** Load and initialize face-api.js (models + nets). Cached after first call. */
export async function loadFaceApi(onProgress) {
  if (faceapiModule) return faceapiModule;
  if (onProgress) onProgress('Memuat library face-api...');
  const faceapi = await import('/vendor/face-api/dist/face-api.esm.js');
  const MODEL_URL = '/vendor/face-api/model';
  if (onProgress) onProgress('Memuat model deteksi wajah...');
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  if (onProgress) onProgress('Memuat model landmark wajah...');
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
  if (onProgress) onProgress('Memuat model pengenalan wajah...');
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  faceapiModule = faceapi;
  return faceapi;
}

const DETECTOR_OPTIONS = () => ({ inputSize: 320, scoreThreshold: 0.5 });

/** Detect a single face descriptor from a video element. Returns 128-array or null. */
export async function detectDescriptor(videoEl) {
  const faceapi = faceapiModule;
  if (!faceapi) throw new Error('face-api belum dimuat');
  const result = await faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions(DETECTOR_OPTIONS()))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!result || !result.descriptor) return null;
  return {
    descriptor: Array.from(result.descriptor),
    box: result.detection ? result.detection.box : null,
  };
}

/**
 * Weak liveness heuristic: require a face in N consecutive frames and that the
 * face center moves more than `minMovementPx` between the first and last sample
 * over a window (~1s). Rejects a static held photo. NOT true anti-spoofing.
 */
export async function checkLiveness(videoEl, { frames = 3, minMovementPx = 4, onProgress } = {}) {
  const samples = [];
  const required = Math.max(frames, 2);
  const startedAt = Date.now();
  while (samples.length < required && Date.now() - startedAt < 5000) {
    const det = await detectDescriptor(videoEl);
    if (det && det.box) samples.push(det.box);
    if (onProgress) onProgress(samples.length, required);
    if (samples.length < required) await sleep(220);
  }
  if (samples.length < required) return { ok: false, reason: 'Wajah tidak terdeteksi dengan stabil' };
  const first = samples[0];
  const last = samples[samples.length - 1];
  const c1 = { x: first.x + first.width / 2, y: first.y + first.height / 2 };
  const c2 = { x: last.x + last.width / 2, y: last.y + last.height / 2 };
  const moved = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (moved < minMovementPx) {
    return { ok: false, reason: 'Tidak ada gerakan terdeteksi. Pastikan wajah Anda bergerak sedikit (bukan foto).' };
  }
  return { ok: true, moved };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
