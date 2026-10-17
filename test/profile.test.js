// Profile endpoints: own-profile read/update, photo handling, password change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';

let server;
let employeeCookie;
let adminCookie;

before(async () => {
  server = await startTestServer();
  employeeCookie = await login(server.baseUrl, 'budi', 'budi123');
  adminCookie = await login(server.baseUrl, 'admin', 'admin123');
});

after(async () => {
  await server.close();
});

test('GET /api/auth/me returns photo: null for a new user', async () => {
  const res = await req(server.baseUrl, '/api/auth/me', { cookie: employeeCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.photo, null);
});

test('PATCH /api/auth/profile updates full_name and persists it', async () => {
  const res = await req(server.baseUrl, '/api/auth/profile', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { full_name: 'Nama Baru' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.user.full_name, 'Nama Baru');

  const me = await req(server.baseUrl, '/api/auth/me', { cookie: employeeCookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.full_name, 'Nama Baru');
});

test('PATCH /api/auth/profile accepts a valid JPEG data URL photo', async () => {
  const photo = 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64');
  const res = await req(server.baseUrl, '/api/auth/profile', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { photo },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.photo, photo);
});

test('PATCH /api/auth/profile with photo: null removes the photo', async () => {
  const res = await req(server.baseUrl, '/api/auth/profile', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { photo: null },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.photo, null);

  const me = await req(server.baseUrl, '/api/auth/me', { cookie: employeeCookie });
  assert.equal(me.data.user.photo, null);
});

test('PATCH /api/auth/profile rejects a non data URL photo', async () => {
  const res = await req(server.baseUrl, '/api/auth/profile', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { photo: 'bukan-data-url' },
  });
  assert.equal(res.status, 400);
  assert.ok(res.data.error);
});

test('PATCH /api/auth/profile without any field returns 400', async () => {
  const res = await req(server.baseUrl, '/api/auth/profile', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: {},
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Tidak ada field yang diubah');
});

test('PATCH /api/auth/password with a wrong old password returns 400', async () => {
  const res = await req(server.baseUrl, '/api/auth/password', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { old_password: 'salah-banget', new_password: 'admin456' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Password lama salah');
});

test('admin can update their own profile through the same endpoint', async () => {
  const res = await req(server.baseUrl, '/api/auth/profile', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { full_name: 'Admin Baru' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.full_name, 'Admin Baru');
  assert.equal(res.data.user.role, 'admin');

  const me = await req(server.baseUrl, '/api/auth/me', { cookie: adminCookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.full_name, 'Admin Baru');
});

test('PATCH /api/auth/profile without a cookie returns 401', async () => {
  const res = await req(server.baseUrl, '/api/auth/profile', {
    method: 'PATCH',
    body: { full_name: 'Tanpa Login' },
  });
  assert.equal(res.status, 401);
});

// Keep last: this rotates the employee password used by the other tests above.
test('PATCH /api/auth/password with the correct old password allows re-login', async () => {
  const res = await req(server.baseUrl, '/api/auth/password', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { old_password: 'budi123', new_password: 'budi4567' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);

  const newCookie = await login(server.baseUrl, 'budi', 'budi4567');
  assert.match(newCookie, /absensi_token=/);

  const me = await req(server.baseUrl, '/api/auth/me', { cookie: newCookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, 'budi');
});
