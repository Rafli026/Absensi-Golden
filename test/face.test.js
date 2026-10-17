import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';

let server;
let adminCookie;

function unitVector() {
  const a = new Array(128).fill(0);
  a[0] = 1;
  return a;
}
function negUnitVector() {
  const a = new Array(128).fill(0);
  a[0] = -1;
  return a;
}

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

test('register a synthetic descriptor', async () => {
  const res = await req(server.baseUrl, '/api/face/register', {
    method: 'POST',
    cookie: adminCookie,
    body: { employee_id: 1, descriptor: unitVector() },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.sample_count, 1);
});

test('register rejects a malformed descriptor', async () => {
  const res = await req(server.baseUrl, '/api/face/register', {
    method: 'POST',
    cookie: adminCookie,
    body: { employee_id: 1, descriptor: [1, 2, 3] },
  });
  assert.equal(res.status, 400);
});

test('verify with the same descriptor matches with distance ~0', async () => {
  const res = await req(server.baseUrl, '/api/face/verify', {
    method: 'POST',
    cookie: adminCookie,
    body: { descriptor: unitVector() },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.matched, true);
  assert.equal(res.data.employee.id, 1);
  assert.equal(res.data.employee.full_name, 'Budi Santoso');
  assert.ok(res.data.distance < 1e-9);
});

test('verify with the opposite descriptor does not match (distance 2 > 0.5)', async () => {
  const res = await req(server.baseUrl, '/api/face/verify', {
    method: 'POST',
    cookie: adminCookie,
    body: { descriptor: negUnitVector() },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.matched, false);
  assert.ok(res.data.distance > 0.5);
});

test('face attendance with a non-matching descriptor creates no row', async () => {
  const before = server.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n;
  const res = await req(server.baseUrl, '/api/attendance/face', {
    method: 'POST',
    cookie: adminCookie,
    body: { descriptor: negUnitVector(), latitude: -6.2, longitude: 106.816666 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.matched, false);
  const after = server.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n;
  assert.equal(after, before, 'no attendance row should be created on no-match');
});

test('face attendance with a matching descriptor creates a row', async () => {
  const before = server.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n;
  const res = await req(server.baseUrl, '/api/attendance/face', {
    method: 'POST',
    cookie: adminCookie,
    body: { descriptor: unitVector(), latitude: -6.2, longitude: 106.816666 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.matched, true);
  assert.equal(res.data.attendance.method, 'Face Recognition');
  const after = server.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n;
  assert.equal(after, before + 1);
});

test('profiles endpoint never returns descriptors', async () => {
  const res = await req(server.baseUrl, '/api/face/profiles', { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.ok(res.data.profiles.length >= 1);
  for (const p of res.data.profiles) {
    assert.equal('descriptor' in p, false, 'descriptor must not be exposed');
  }
  assert.ok(!JSON.stringify(res.data).includes('descriptor'));
});
