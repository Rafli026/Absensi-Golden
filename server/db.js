// Database access using node:sqlite (built-in). Requires Node >= 22.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoUtc } from './lib/time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let DatabaseSyncCtor = DatabaseSync;
if (typeof DatabaseSyncCtor !== 'function') {
  throw new Error(
    'node:sqlite tidak tersedia. Sistem ini membutuhkan Node.js versi 22 atau lebih baru. Silakan upgrade Node.'
  );
}

/**
 * Open a SQLite database and apply pragmas.
 * Pass ':memory:' for an in-memory database.
 */
export function openDb(path = ':memory:') {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

const activeTx = new WeakSet();

/**
 * Run a function inside a transaction. Commits on success, rolls back on error.
 * Supports nested calls via savepoints.
 */
export function transaction(db, fn) {
  const inTx = activeTx.has(db);
  const sp = `sp_${Math.random().toString(36).slice(2, 10)}`;
  if (inTx) {
    db.exec(`SAVEPOINT ${sp}`);
  } else {
    db.exec('BEGIN');
    activeTx.add(db);
  }
  try {
    const result = fn();
    if (inTx) db.exec(`RELEASE ${sp}`);
    else {
      db.exec('COMMIT');
      activeTx.delete(db);
    }
    return result;
  } catch (err) {
    try {
      if (inTx) db.exec(`ROLLBACK TO ${sp}`);
      else {
        db.exec('ROLLBACK');
        activeTx.delete(db);
      }
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}

/** Run the schema DDL (idempotent). */
export function migrate(db) {
  const sql = readFileSync(resolve(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  // Incremental migrations for databases created by older versions.
  addColumnIfMissing(db, 'attendance', 'late_minutes', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'users', 'photo', 'TEXT');
  return db;
}

/** Add a column if it does not exist yet (SQLite has no IF NOT EXISTS for ALTER). */
function addColumnIfMissing(db, table, column, definition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch {
    /* table may not exist yet; ignore */
  }
}

const DEFAULT_SETTINGS = {
  location_validation_enabled: 'true',
  attendance_cooldown_seconds: '60',
  face_match_threshold: '0.5',
  liveness_enabled: 'true',
  active_branch_id: '1',
  company_name: 'New Golden Bakery & Cakes',
  // Late deduction rules.
  // mode: 'per_occurrence' = flat per late event; 'per_minute_block' = every N minutes.
  late_deduction_mode: 'per_occurrence',
  late_deduction_per_occurrence: '0',   // rupiah per late event (mode A)
  late_deduction_per_block: '0',        // rupiah per block (mode B)
  late_deduction_block_minutes: '10',   // minutes per block (mode B)
};

/** Insert any missing default settings rows. */
export function seedSettings(db) {
  const now = isoUtc();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
  );
  const defaults = { ...DEFAULT_SETTINGS };
  // .env overrides for initial values (only applied on first seed).
  if (process.env.LOCATION_VALIDATION_ENABLED !== undefined) {
    defaults.location_validation_enabled = String(process.env.LOCATION_VALIDATION_ENABLED);
  }
  if (process.env.FACE_MATCH_THRESHOLD !== undefined) {
    defaults.face_match_threshold = String(process.env.FACE_MATCH_THRESHOLD);
  }
  if (process.env.ATTENDANCE_COOLDOWN_SECONDS !== undefined) {
    defaults.attendance_cooldown_seconds = String(process.env.ATTENDANCE_COOLDOWN_SECONDS);
  }
  if (process.env.LATE_DEDUCTION_PER_OCCURRENCE !== undefined) {
    defaults.late_deduction_per_occurrence = String(process.env.LATE_DEDUCTION_PER_OCCURRENCE);
  }
  if (process.env.LATE_DEDUCTION_MODE !== undefined) {
    defaults.late_deduction_mode = String(process.env.LATE_DEDUCTION_MODE);
  }
  if (process.env.LATE_DEDUCTION_PER_BLOCK !== undefined) {
    defaults.late_deduction_per_block = String(process.env.LATE_DEDUCTION_PER_BLOCK);
  }
  if (process.env.LATE_DEDUCTION_BLOCK_MINUTES !== undefined) {
    defaults.late_deduction_block_minutes = String(process.env.LATE_DEDUCTION_BLOCK_MINUTES);
  }
  for (const [k, v] of Object.entries(defaults)) {
    insert.run(k, v, now);
  }
}

/** Get all settings as an object. */
export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Get a single setting value or a default. */
export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/** Upsert settings from a key/value object. */
export function setSettings(db, kv) {
  const now = isoUtc();
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  for (const [k, v] of Object.entries(kv)) {
    stmt.run(k, v === undefined || v === null ? '' : String(v), now);
  }
}

export { DEFAULT_SETTINGS };
