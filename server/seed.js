// Seed the database with demo data. Idempotent unless --force.
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    let val = t.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const { openDb, migrate, seedSettings } = await import('./db.js');
const { hashPassword } = await import('./lib/auth.js');
const { isoUtc, jakartaDate } = await import('./lib/time.js');

const force = process.argv.includes('--force');
const DB_PATH = resolve(ROOT, process.env.DB_PATH || './data/absensi.db');

if (force && existsSync(DB_PATH)) {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(DB_PATH + suffix, { force: true });
  }
  console.log('Menghapus database lama (--force).');
}

const db = openDb(DB_PATH);
migrate(db);
seedSettings(db);

const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (existing > 0) {
  console.log(`Database sudah terisi (${existing} user). Gunakan 'npm run seed -- --force' untuk reset.`);
  db.close();
  process.exit(0);
}

const now = isoUtc();

// --- Branch ---
const branchId = db
  .prepare(
    `INSERT INTO branches (name, address, latitude, longitude, radius_meters, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  )
  .run('New Golden Bakery Pusat', 'Jl. Jendral Sudirman No. 156, Prabumulih', -6.2, 106.816666, 100, now, now)
  .lastInsertRowid;

// --- Admin ---
function createUser({ username, password, role, fullName }) {
  return db
    .prepare(
      `INSERT INTO users (username, password_hash, role, full_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
    .run(username, hashPassword(password), role, fullName, now, now).lastInsertRowid;
}

createUser({ username: 'admin', password: 'admin123', role: 'admin', fullName: 'Admin New Golden' });

// --- Employees ---
const employees = [
  { username: 'budi', password: 'budi123', fullName: 'Budi Santoso', code: 'KRY-001', position: 'Baker' },
  { username: 'siti', password: 'siti123', fullName: 'Siti Aminah', code: 'KRY-002', position: 'Kasir' },
  { username: 'andi', password: 'andi123', fullName: 'Andi Wijaya', code: 'KRY-003', position: 'Helper' },
];

const insertEmployee = db.prepare(
  `INSERT INTO employees (user_id, employee_code, qr_code, branch_id, position, phone, join_date, is_active, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
);

const employeeRows = [];
for (const e of employees) {
  const userId = createUser({
    username: e.username,
    password: e.password,
    role: 'employee',
    fullName: e.fullName,
  });
  const empId = insertEmployee.run(
    userId,
    e.code,
    `ROTIABS-${randomUUID()}`,
    branchId,
    e.position,
    null,
    '2024-01-01',
    now,
    now
  ).lastInsertRowid;
  employeeRows.push({ id: empId, name: e.fullName });
}

// --- Work schedule ---
db.prepare(
  `INSERT INTO work_schedules (name, work_start, work_end, late_tolerance_minutes, checkout_deadline, work_days, holidays, is_active, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
).run('Default', '08:00', '17:00', 15, '23:59', '[1,2,3,4,5,6]', '[]', now, now);

// --- Sample attendance for previous 3 Jakarta days ---
function shiftDateKey(dateKey, deltaDays) {
  const [y, m, d] = dateKey.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const today = jakartaDate(new Date());

// Build an ISO-UTC timestamp for a Jakarta date+time (UTC+7, no DST).
function jakartaToIso(dateKey, timeStr) {
  const [y, m, d] = dateKey.split('-').map((x) => parseInt(x, 10));
  const [hh, mm, ss] = timeStr.split(':').map((x) => parseInt(x, 10));
  const utcMs = Date.UTC(y, m - 1, d, hh - 7, mm, ss);
  return new Date(utcMs).toISOString();
}

const insertAttendance = db.prepare(
  `INSERT INTO attendance
    (employee_id, employee_name, branch_id, branch_name, date, time, type, method, status,
     location_name, latitude, longitude, accuracy, location_validated, distance_meters, late_minutes, note, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'Barcode/QR', ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)`
);

let attendanceCount = 0;
for (let i = 3; i >= 1; i--) {
  const dateKey = shiftDateKey(today, -i);
  employeeRows.forEach((emp, idx) => {
    const late = idx === 1; // one employee is late
    // 08:25 with start 08:00 + tolerance 15 => 10 minutes late.
    const inTime = late ? '08:25:00' : '07:55:00';
    const lateMinutes = late ? 10 : 0;
    const outTime = '17:05:00';
    const inStatus = late ? 'Terlambat' : 'Hadir';
    const jitter = idx * 0.00005;
    insertAttendance.run(
      emp.id, emp.name, branchId, 'New Golden Bakery Pusat', dateKey, inTime, 'Masuk', inStatus,
      'New Golden Bakery Pusat', -6.2 + jitter, 106.816666 + jitter, 12, 20, lateMinutes,
      jakartaToIso(dateKey, inTime), jakartaToIso(dateKey, inTime)
    );
    insertAttendance.run(
      emp.id, emp.name, branchId, 'New Golden Bakery Pusat', dateKey, outTime, 'Pulang', 'Pulang',
      'New Golden Bakery Pusat', -6.2 + jitter, 106.816666 + jitter, 12, 20, 0,
      jakartaToIso(dateKey, outTime), jakartaToIso(dateKey, outTime)
    );
    attendanceCount += 2;
  });
}

console.log('Seed selesai:');
console.log(`  - 1 cabang`);
console.log(`  - 1 admin`);
console.log(`  - ${employeeRows.length} karyawan`);
console.log(`  - ${attendanceCount} catatan absensi (3 hari terakhir)`);
console.log(`  - 1 jadwal kerja`);
db.close();
