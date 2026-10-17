-- Sistem Absensi New Golden Bakery & Cakes - schema
-- All DDL is idempotent (CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  latitude REAL,
  longitude REAL,
  radius_meters INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- format: scrypt$<saltHex>$<hashHex>
  role TEXT NOT NULL CHECK (role IN ('admin','employee')),
  full_name TEXT NOT NULL,
  photo TEXT,                           -- data URL (JPEG, sudah diperkecil di browser)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL UNIQUE,   -- e.g. KRY-001
  qr_code TEXT NOT NULL UNIQUE,         -- opaque token, e.g. ROTIABS-<uuid>
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  position TEXT,
  phone TEXT,
  join_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_name TEXT NOT NULL,          -- denormalized snapshot
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  branch_name TEXT,
  date TEXT NOT NULL,                   -- Jakarta 'YYYY-MM-DD'
  time TEXT NOT NULL,                   -- Jakarta 'HH:mm:ss'
  type TEXT NOT NULL CHECK (type IN ('Masuk','Pulang')),
  method TEXT NOT NULL CHECK (method IN ('Barcode/QR','Face Recognition','Manual')),
  status TEXT NOT NULL CHECK (status IN ('Hadir','Terlambat','Pulang','Izin')),
  location_name TEXT,
  latitude REAL,
  longitude REAL,
  accuracy REAL,
  location_validated INTEGER NOT NULL DEFAULT 0,  -- 1 if server radius check passed
  distance_meters REAL,
  late_minutes INTEGER NOT NULL DEFAULT 0,        -- minutes late beyond start+tolerance (0 if not late)
  note TEXT,
  created_at TEXT NOT NULL,             -- ISO UTC
  updated_at TEXT NOT NULL              -- ISO UTC
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_type
  ON attendance(employee_id, date, type);          -- blocks duplicate same-type/day (admin overrides delete/update first)

CREATE TABLE IF NOT EXISTS face_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  descriptor TEXT NOT NULL,             -- JSON array of 128 floats; NEVER a raw photo
  sample_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Default',
  work_start TEXT NOT NULL DEFAULT '08:00',
  work_end TEXT NOT NULL DEFAULT '17:00',
  late_tolerance_minutes INTEGER NOT NULL DEFAULT 15,
  checkout_deadline TEXT NOT NULL DEFAULT '23:59',
  work_days TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',  -- ISO weekday numbers, Mon=1..Sun=7
  holidays TEXT NOT NULL DEFAULT '[]',              -- JSON array of 'YYYY-MM-DD'
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER, actor_name TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT,
  ip TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
