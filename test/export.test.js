import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';
import { isoUtc, jakartaDate } from '../server/lib/time.js';

let server;
let adminCookie;

const EXPECTED_HEADER =
  'ID Absensi,ID Karyawan,Nama Karyawan,Tanggal,Waktu,Tipe,Metode,Status,Lokasi,Catatan,Created At,Updated At';

before(async () => {
  server = await startTestServer();
  adminCookie = await login(server.baseUrl, 'admin', 'admin123');

  // Insert a couple of attendance rows directly.
  const now = isoUtc();
  const today = jakartaDate();
  const stmt = server.db.prepare(
    `INSERT INTO attendance
       (employee_id, employee_name, branch_id, branch_name, date, time, type, method, status,
        location_name, latitude, longitude, accuracy, location_validated, distance_meters, note, created_at, updated_at)
     VALUES (?, ?, 1, 'Toko Roti Pusat', ?, ?, ?, 'Barcode/QR', ?, 'Toko Roti Pusat', -6.2, 106.816666, 10, 1, 5, ?, ?, ?)`
  );
  stmt.run(1, 'Budi Santoso', today, '07:55:00', 'Masuk', 'Hadir', 'Catatan, dengan "koma"', now, now);
  stmt.run(1, 'Budi Santoso', today, '17:05:00', 'Pulang', 'Pulang', null, now, now);
});

after(async () => {
  await server.close();
});

test('CSV export has correct headers and rows', async () => {
  const res = await req(server.baseUrl, '/api/export/attendance.csv', { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="absensi-\d{4}-\d{2}-\d{2}\.csv"/);

  const text = String(res.data);
  const lines = text.split('\r\n').filter((l) => l.length > 0);
  // First line may carry the UTF-8 BOM (fetch text() strips it).
  assert.equal(lines[0].replace(/^\uFEFF/, ''), EXPECTED_HEADER);
  assert.equal(lines.length, 3, 'header + 2 rows');

  // Tanggal column must be DD-MM-YYYY.
  const cells = lines[1].split(',');
  assert.match(cells[3], /^\d{2}-\d{2}-\d{4}$/);
});

test('CSV response starts with a UTF-8 BOM (raw bytes)', async () => {
  const res = await fetch(`${server.baseUrl}/api/export/attendance.csv`, { headers: { Cookie: adminCookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'should start with UTF-8 BOM');
});

test('CSV quotes fields containing commas', async () => {
  const res = await req(server.baseUrl, '/api/export/attendance.csv', { cookie: adminCookie });
  const text = String(res.data);
  assert.ok(text.includes('"Catatan, dengan ""koma"""'), 'note should be quoted and escaped');
});
