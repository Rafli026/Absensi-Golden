import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, req } from './helpers.js';

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('login with valid credentials returns 200 and a cookie', async () => {
  const res = await req(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.username, 'admin');
  assert.equal(res.data.user.role, 'admin');
  assert.ok(res.headers.get('set-cookie'), 'should set a cookie');
  assert.match(res.headers.get('set-cookie'), /absensi_token=/);
});

test('login with wrong password returns 401', async () => {
  const res = await req(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.data.error, 'Username atau password salah');
});

test('employee cookie gets 403 on /api/employees', async () => {
  const cookie = await login(server.baseUrl, 'budi', 'budi123');
  const res = await req(server.baseUrl, '/api/employees', { cookie });
  assert.equal(res.status, 403);
});

test('no cookie gets 401 on /api/employees', async () => {
  const res = await req(server.baseUrl, '/api/employees');
  assert.equal(res.status, 401);
});

test('admin cookie can list employees', async () => {
  const cookie = await login(server.baseUrl, 'admin', 'admin123');
  const res = await req(server.baseUrl, '/api/employees', { cookie });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.employees));
  assert.ok(res.data.employees.length >= 1);
});
