import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';
import { computeStatus } from '../server/routes/attendance.js';

let server;
let adminCookie;

before(async () => {
  server = await startTestServer();
  adminCookie = await login(server.baseUrl, 'admin', 'admin123');
});

after(async () => {
  await server.close();
});

async function qrCodeFor(empId) {
  const res = await req(server.baseUrl, `/api/employees/${empId}`, { cookie: adminCookie });
  return res.data.employee.qr_code;
}

test('computeStatus: 08:10 with 08:00 start + 15 tolerance => Hadir', () => {
  const status = computeStatus(8 * 60 + 10, { work_start: '08:00', late_tolerance_minutes: 15 });
  assert.equal(status, 'Hadir');
});

test('computeStatus: boundary 08:15 (start + tolerance) => Hadir', () => {
  const status = computeStatus(8 * 60 + 15, { work_start: '08:00', late_tolerance_minutes: 15 });
  assert.equal(status, 'Hadir');
});

test('computeStatus: 08:16 with 08:00 start + 15 tolerance => Terlambat', () => {
  const status = computeStatus(8 * 60 + 16, { work_start: '08:00', late_tolerance_minutes: 15 });
  assert.equal(status, 'Terlambat');
});

test('computeStatus: 08:20 with 08:00 start + 15 tolerance => Terlambat', () => {
  const status = computeStatus(8 * 60 + 20, { work_start: '08:00', late_tolerance_minutes: 15 });
  assert.equal(status, 'Terlambat');
});

test('QR check-in then check-out then 409', async () => {
  const code = await qrCodeFor(1);

  const first = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, latitude: -6.2, longitude: 106.816666, accuracy: 10 },
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.attendance.type, 'Masuk');
  assert.ok(['Hadir', 'Terlambat'].includes(first.data.attendance.status));

  // Cooldown blocks immediate second scan; disable it to test Pulang logic.
  await req(server.baseUrl, '/api/settings/location', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { attendance_cooldown_seconds: 0 },
  });

  const second = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, latitude: -6.2, longitude: 106.816666 },
  });
  assert.equal(second.status, 200);
  assert.equal(second.data.attendance.type, 'Pulang');
  assert.equal(second.data.attendance.status, 'Pulang');

  const third = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, latitude: -6.2, longitude: 106.816666 },
  });
  assert.equal(third.status, 409);
  assert.match(third.data.error, /sudah absen/i);
});

test('unique index blocks duplicate same-type insert (SQLITE_CONSTRAINT)', () => {
  const row = server.db.prepare('SELECT * FROM attendance LIMIT 1').get();
  assert.ok(row, 'there should be at least one attendance row');
  assert.throws(
    () => {
      server.db
        .prepare(
          `INSERT INTO attendance
             (employee_id, employee_name, date, time, type, method, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Manual', 'Hadir', ?, ?)`
        )
        .run(row.employee_id, row.employee_name, row.date, '00:00:00', row.type, row.created_at, row.updated_at);
    },
    (err) => /UNIQUE|CONSTRAINT/i.test(String(err.message) + String(err.code))
  );
});
