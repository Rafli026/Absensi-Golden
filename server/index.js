// Server bootstrap: load .env, validate env, migrate DB, listen, graceful shutdown.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Minimal .env loader (no dotenv dependency).
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

const { openDb, migrate, seedSettings } = await import('./db.js');
const { createApp } = await import('./app.js');
const { createShutdown } = await import('./lib/shutdown.js');

const IS_PROD = process.env.NODE_ENV === 'production';

// --- Environment validation (fail fast) -------------------------------------

const WEAK_SECRETS = new Set(['change-me-in-production', 'dev-secret-change-me']);

function fail(message) {
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  fail('JWT_SECRET belum diset. Salin .env.example ke .env dan isi JWT_SECRET.');
}
if (JWT_SECRET.length < 32) {
  if (IS_PROD && WEAK_SECRETS.has(JWT_SECRET)) {
    fail('JWT_SECRET masih memakai nilai contoh. Ganti dengan nilai acak sebelum produksi.');
  }
  fail('JWT_SECRET terlalu pendek (minimal 32 karakter). Buat nilai acak, mis. `openssl rand -hex 32`.');
}
if (IS_PROD && WEAK_SECRETS.has(JWT_SECRET)) {
  fail('JWT_SECRET masih memakai nilai contoh. Ganti dengan nilai acak sebelum produksi.');
}

const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  fail(`PORT tidak valid: "${process.env.PORT}". Harus bilangan bulat 1-65535.`);
}

const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
if (!Number.isFinite(SESSION_TTL_HOURS) || SESSION_TTL_HOURS <= 0) {
  fail(`SESSION_TTL_HOURS tidak valid: "${process.env.SESSION_TTL_HOURS}". Harus angka > 0.`);
}

// --- Database ---------------------------------------------------------------

const DB_PATH = process.env.DB_PATH || resolve(ROOT, 'data/absensi.db');

const db = openDb(resolve(ROOT, DB_PATH));
migrate(db);
seedSettings(db);

// --- Production warnings (non-fatal) ----------------------------------------

if (IS_PROD) {
  try {
    const { verifyPassword } = await import('./lib/auth.js');
    const admin = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('admin');
    if (admin && verifyPassword('admin123', admin.password_hash)) {
      console.warn('============================================================');
      console.warn('PERINGATAN: password admin masih default (admin123).');
      console.warn('Segera ganti sebelum dipakai produksi.');
      console.warn('============================================================');
    }
  } catch (err) {
    console.error('[warn] Gagal memeriksa password admin default:', err);
  }
}

// --- HTTP server + graceful shutdown ----------------------------------------

const app = createApp(db);
const server = app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});

const shutdown = createShutdown({ server, db, timeoutMs: 10_000 });

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});
