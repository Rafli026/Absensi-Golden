// Test helpers: ephemeral server + minimal seed.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { openDb, migrate, seedSettings } from '../server/db.js';
import { hashPassword } from '../server/lib/auth.js';
import { isoUtc } from '../server/lib/time.js';
import { createApp } from '../server/app.js';

/**
 * Start an ephemeral test server with a fresh temp DB.
 * Returns { baseUrl, db, close() }.
 */
export async function startTestServer({ seed = true } = {}) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789';
  const dir = mkdtempSync(join(tmpdir(), 'kp-test-'));
  const dbPath = join(dir, `test-${randomUUID()}.db`);
  const db = openDb(dbPath);
  migrate(db);
  seedSettings(db);

  if (seed) {
    seedMinimal(db);
  }

  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      try { db.close(); } catch { /* ignore */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Seed one admin, one employee, one branch, one work schedule. */
export function seedMinimal(db) {
  const now = isoUtc();
  const branchId = db
    .prepare(
      `INSERT INTO branches (name, address, latitude, longitude, radius_meters, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run('Toko Roti Pusat', 'Jl. Roti Manis No. 1', -6.2, 106.816666, 100, now, now).lastInsertRowid;

  const adminId = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, full_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'admin', ?, 1, ?, ?)`
    )
    .run('admin', hashPassword('admin123'), 'Admin Toko', now, now).lastInsertRowid;

  const userId = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, full_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'employee', ?, 1, ?, ?)`
    )
    .run('budi', hashPassword('budi123'), 'Budi Santoso', now, now).lastInsertRowid;

  const empId = db
    .prepare(
      `INSERT INTO employees (user_id, employee_code, qr_code, branch_id, position, phone, join_date, is_active, created_at, updated_at)
       VALUES (?, 'KRY-001', ?, ?, 'Baker', NULL, '2024-01-01', 1, ?, ?)`
    )
    .run(userId, `ROTIABS-${randomUUID()}`, branchId, now, now).lastInsertRowid;

  db.prepare(
    `INSERT INTO work_schedules (name, work_start, work_end, late_tolerance_minutes, checkout_deadline, work_days, holidays, is_active, created_at, updated_at)
     VALUES ('Default', '08:00', '17:00', 15, '23:59', '[1,2,3,4,5,6]', '[]', 1, ?, ?)`
  ).run(now, now);

  return { branchId, adminId, userId, empId };
}

/** Log in and return the Cookie header string. */
export async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Login failed (${res.status}): ${body.error || ''}`);
  }
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

/** JSON fetch helper that attaches a cookie. */
export async function req(baseUrl, path, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  else data = await res.text().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}
