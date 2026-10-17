// Full end-to-end smoke test on an ephemeral server.
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

test('SMOKE: create employee -> QR -> check-in -> check-out -> dashboard -> export', async () => {
  // 1. Create employee.
  const created = await req(server.baseUrl, '/api/employees', {
    method: 'POST',
    cookie: adminCookie,
    body: { full_name: 'Smoke Test', username: 'test1', password: 'test1234', position: 'Tester', branch_id: 1 },
  });
  assert.equal(created.status, 201, 'employee create should be 201');
  const empId = created.data.employee.id;
  const code = created.data.employee.qr_code;
  assert.match(code, /^ROTIABS-/);

  // 2. Fetch QR PNG.
  const png = await fetch(`${server.baseUrl}/api/employees/${empId}/qrcode.png`, { headers: { Cookie: adminCookie } });
  assert.equal(png.status, 200);
  const buf = Buffer.from(await png.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic bytes');

  // 3. QR check-in.
  const checkin = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, latitude: -6.2, longitude: 106.816666, accuracy: 10 },
  });
  assert.equal(checkin.status, 200, 'check-in should succeed');
  assert.equal(checkin.data.attendance.type, 'Masuk');

  // 4. QR check-out.
  const checkout = await req(server.baseUrl, '/api/attendance/qr', {
    method: 'POST',
    cookie: adminCookie,
    body: { code, latitude: -6.2, longitude: 106.816666, accuracy: 10 },
  });
  assert.equal(checkout.status, 200, 'check-out should succeed');
  assert.equal(checkout.data.attendance.type, 'Pulang');

  // 5. Dashboard summary counts the employee as present (Hadir or Terlambat).
  const summary = await req(server.baseUrl, '/api/dashboard/summary', { cookie: adminCookie });
  assert.equal(summary.status, 200);
  const present = summary.data.hadir + summary.data.terlambat;
  assert.ok(present >= 1, `employee should be counted as present, got hadir=${summary.data.hadir} terlambat=${summary.data.terlambat}`);

  // 6. Export CSV contains the new employee name.
  const csv = await req(server.baseUrl, '/api/export/attendance.csv', { cookie: adminCookie });
  assert.equal(csv.status, 200);
  assert.ok(String(csv.data).includes('Smoke Test'), 'CSV should contain the new employee');

  // eslint-disable-next-line no-console
  console.log('SMOKE TEST PASSED');
});
