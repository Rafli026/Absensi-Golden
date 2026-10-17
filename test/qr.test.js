import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';

let server;
let adminCookie;

before(async () => {
  server = await startTestServer();
  adminCookie = await login(server.baseUrl, 'admin', 'admin123');
  await req(server.baseUrl, '/api/settings/location', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { attendance_cooldown_seconds: 0 },
  });
});

after(async () => {
  await server.close();
});

test('creating an employee returns a ROTIABS- qr_code', async () => {
  const res = await req(server.baseUrl, '/api/employees', {
    method: 'POST',
    cookie: adminCookie,
    body: { full_name: 'QR Tester', username: 'qrtest', password: 'qrtest123' },
  });
  assert.equal(res.status, 201);
  assert.match(res.data.employee.qr_code, /^ROTIABS-/);
  assert.equal(res.data.employee.employee_code, 'KRY-002');
});

test('QR PNG endpoint returns PNG magic bytes', async () => {
  const res = await fetch(`${server.baseUrl}/api/employees/1/qrcode.png`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/png/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x4e);
  assert.equal(buf[3], 0x47);
});

test('QR check-in with a valid code succeeds', async () => {
  const det = await req(server.baseUrl, '/api/employees/1', { cookie: adminCookie });
  const code = det.data.employee.qr_code;
  const res = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, latitude: -6.2, longitude: 106.816666, accuracy: 10 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.attendance.method, 'Barcode/QR');
});

test('QR check-in with an unknown code returns 404', async () => {
  const res = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code: 'ROTIABS-does-not-exist' },
  });
  assert.equal(res.status, 404);
  assert.match(res.data.error, /tidak dikenali/i);
});

test('regenerating a QR code changes it', async () => {
  const before = await req(server.baseUrl, '/api/employees/1', { cookie: adminCookie });
  const oldCode = before.data.employee.qr_code;
  const res = await req(server.baseUrl, '/api/employees/1/qrcode/regenerate', {
    method: 'POST',
    cookie: adminCookie,
  });
  assert.equal(res.status, 200);
  assert.notEqual(res.data.qr_code, oldCode);
  assert.match(res.data.qr_code, /^ROTIABS-/);
});
