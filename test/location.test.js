import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';

let server;
let adminCookie;
let code;

// ~30 m north of the branch (-6.2, 106.816666); 0.0002695 deg lat ~= 30 m
const NEAR = { latitude: -6.1997305, longitude: 106.816666 };
// ~500 m north
const FAR = { latitude: -6.1955084, longitude: 106.816666 };

before(async () => {
  server = await startTestServer();
  adminCookie = await login(server.baseUrl, 'admin', 'admin123');
  const det = await req(server.baseUrl, '/api/employees/1', { cookie: adminCookie });
  code = det.data.employee.qr_code;
  // Remove cooldown for deterministic tests.
  await req(server.baseUrl, '/api/settings/location', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { attendance_cooldown_seconds: 0 },
  });
});

after(async () => {
  await server.close();
});

test('near location (30 m) is accepted and validated', async () => {
  const res = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, ...NEAR, accuracy: 10 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.attendance.location_validated, true);
  assert.ok(res.data.attendance.distance_meters != null);
  assert.ok(Math.abs(res.data.attendance.distance_meters - 30) < 5, `distance ~30, got ${res.data.attendance.distance_meters}`);
});

test('far location (500 m) is rejected with a distance message', async () => {
  const res = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, ...FAR },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /m dari toko/);
  assert.match(res.data.error, /maks 100 m/);
});

test('missing coordinates are rejected', async () => {
  const res = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /Lokasi tidak tersedia/);
});

test('after disabling validation, far coordinates are accepted with location_validated=0', async () => {
  const off = await req(server.baseUrl, '/api/settings/location', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { location_validation_enabled: false },
  });
  assert.equal(off.status, 200);
  assert.equal(off.data.location_validation_enabled, false);

  const res = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, ...FAR },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.attendance.location_validated, false);
});
