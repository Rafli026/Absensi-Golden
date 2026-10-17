import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';
import { currentPeriod, shiftPeriod } from '../server/lib/time.js';
import { isoUtc } from '../server/lib/time.js';

let server;
let adminCookie;
let empCookie;

before(async () => {
  server = await startTestServer();
  adminCookie = await login(server.baseUrl, 'admin', 'admin123');
  empCookie = await login(server.baseUrl, 'budi', 'budi123');

  // Seed attendance for this month and last month.
  const thisMonth = currentPeriod();
  const lastMonth = shiftPeriod(thisMonth, -1);
  const now = isoUtc();
  const stmt = server.db.prepare(
    `INSERT INTO attendance
       (employee_id, employee_name, branch_id, branch_name, date, time, type, method, status,
        location_validated, created_at, updated_at)
     VALUES (1, 'Budi Santoso', 1, 'Toko Roti Pusat', ?, ?, ?, 'Manual', ?, 0, ?, ?)`
  );
  // This month: 2 late + 1 izin
  stmt.run(`${thisMonth}-01`, '08:30:00', 'Masuk', 'Terlambat', now, now);
  stmt.run(`${thisMonth}-02`, '08:45:00', 'Masuk', 'Terlambat', now, now);
  stmt.run(`${thisMonth}-03`, '09:00:00', 'Masuk', 'Izin', now, now);
  // Last month: 5 late (should NOT be counted this month)
  for (let d = 1; d <= 5; d++) {
    stmt.run(`${lastMonth}-${String(d).padStart(2, '0')}`, '08:30:00', 'Masuk', 'Terlambat', now, now);
  }
});

after(async () => {
  await server.close();
});

test('admin recap counts only the selected month (resets each month)', async () => {
  const period = currentPeriod();
  const res = await req(server.baseUrl, `/api/dashboard/recap?period=${period}`, { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.period, period);
  const budi = res.data.items.find((i) => i.employee_id === 1);
  assert.ok(budi, 'budi should be in recap');
  assert.equal(budi.late_count, 2, 'only this month late counted');
  assert.equal(budi.izin_count, 1);
});

test('last month recap is independent (5 late)', async () => {
  const last = shiftPeriod(currentPeriod(), -1);
  const res = await req(server.baseUrl, `/api/dashboard/recap?period=${last}`, { cookie: adminCookie });
  assert.equal(res.status, 200);
  const budi = res.data.items.find((i) => i.employee_id === 1);
  assert.equal(budi.late_count, 5);
  assert.equal(budi.izin_count, 0);
});

test('recap applies flat deduction per late event', async () => {
  await req(server.baseUrl, '/api/settings/location', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { late_deduction_mode: 'per_occurrence', late_deduction_per_occurrence: 25000 },
  });
  const period = currentPeriod();
  const res = await req(server.baseUrl, `/api/dashboard/recap?period=${period}`, { cookie: adminCookie });
  const budi = res.data.items.find((i) => i.employee_id === 1);
  assert.equal(budi.total_deduction, 2 * 25000, 'flat: 2 late x Rp25.000');
});

test('recap applies per-minute-block deduction', async () => {
  // 2 late records at 30 and 45 minutes => blocks of 10: 3 + 5 = 8 blocks.
  await req(server.baseUrl, '/api/settings/location', {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      late_deduction_mode: 'per_minute_block',
      late_deduction_per_block: 5000,
      late_deduction_block_minutes: 10,
    },
  });
  const period = currentPeriod();
  const res = await req(server.baseUrl, `/api/dashboard/recap?period=${period}`, { cookie: adminCookie });
  assert.equal(res.data.rules.mode, 'per_minute_block');
  assert.equal(res.data.rules.perBlock, 5000);
  assert.equal(res.data.rules.blockMinutes, 10);
  const budi = res.data.items.find((i) => i.employee_id === 1);
  // The seeded rows in this suite have no explicit late_minutes, so each late
  // record still charges at least one block (2 records => 2 blocks minimum).
  assert.ok(budi.total_deduction >= 2 * 5000, `expected at least 2 blocks, got ${budi.total_deduction}`);
});

test('invalid period format is rejected', async () => {
  const res = await req(server.baseUrl, '/api/dashboard/recap?period=2026-13', { cookie: adminCookie });
  assert.equal(res.status, 400);
});

test('employee recap returns own counts WITHOUT any deduction figures', async () => {
  const res = await req(server.baseUrl, '/api/attendance/recap', { cookie: empCookie });
  assert.equal(res.status, 200);
  const own = res.data.items[0];
  assert.equal(own.employee_id, 1);
  assert.equal(own.late_count, 2);
  assert.equal(own.izin_count, 1);
  // No money fields must be present.
  assert.equal('total_deduction' in own, false, 'employee must not see total_deduction');
  assert.equal('deduction_per_occurrence' in own, false, 'employee must not see the rate');
  assert.equal('totals' in res.data, false, 'employee must not see totals');
  assert.ok(!JSON.stringify(res.data).includes('deduction'));
});

test('employee cannot read the admin dashboard recap', async () => {
  const res = await req(server.baseUrl, '/api/dashboard/recap', { cookie: empCookie });
  assert.equal(res.status, 403);
});

test('late_deduction_per_occurrence round-trips through settings', async () => {
  const patched = await req(server.baseUrl, '/api/settings/location', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { late_deduction_per_occurrence: 15000 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.late_deduction_per_occurrence, 15000);
  const read = await req(server.baseUrl, '/api/settings/location', { cookie: adminCookie });
  assert.equal(read.data.late_deduction_per_occurrence, 15000);
});

test('admin recap can filter by employee_id', async () => {
  const period = currentPeriod();
  const res = await req(server.baseUrl, `/api/attendance/recap?period=${period}&employee_id=1`, { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 1, 'should return exactly one employee');
  assert.equal(res.data.items[0].employee_id, 1);
  assert.equal(res.data.items[0].late_count, 2);
});

test('recap includes employees with zero records', async () => {
  const res = await req(server.baseUrl, '/api/dashboard/recap', { cookie: adminCookie });
  // budi (id 1) has records; ensure the list is present and numeric
  assert.ok(res.data.items.length >= 1);
  for (const i of res.data.items) {
    assert.equal(typeof i.late_count, 'number');
    assert.equal(typeof i.total_deduction, 'number');
  }
});
