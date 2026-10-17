// Production hardening tests: health, public config, security headers,
// Origin check, and Secure cookie behaviour.
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

test('GET /api/health returns ok without auth and leaks no DB path', async () => {
  const res = await req(server.baseUrl, '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'ok');
  assert.equal(res.data.db, 'ok');
  assert.equal(typeof res.data.uptime, 'number');
  assert.ok(res.data.version, 'version should be present');

  const raw = JSON.stringify(res.data);
  assert.ok(!raw.includes('absensi.db'), 'must not expose DB file name');
  assert.ok(!raw.includes('data/'), 'must not expose DB path');
  assert.ok(!raw.includes('node'), 'must not expose Node version');
});

test('GET /api/health works without a cookie', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('GET /api/public/config exposes company name and demo flag only', async () => {
  const res = await req(server.baseUrl, '/api/public/config');
  assert.equal(res.status, 200);
  assert.ok(res.data.company_name);
  assert.equal(typeof res.data.demo_mode, 'boolean');

  const raw = JSON.stringify(res.data);
  assert.ok(!raw.includes('admin123'));
  assert.ok(!raw.includes('budi123'));
});

test('security headers are set on HTML responses', async () => {
  const res = await fetch(`${server.baseUrl}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(res.headers.get('permissions-policy') || '', /camera=\(self\)/);
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('POST /api/auth/login with a foreign Origin is rejected with 403', async () => {
  const res = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'Origin tidak diizinkan');
});

test('POST /api/auth/login with matching Origin succeeds', async () => {
  const res = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.username, 'admin');
});

test('POST /api/auth/login without an Origin header still succeeds', async () => {
  const res = await req(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  assert.equal(res.status, 200);
});

test('login cookie is Secure when NODE_ENV=production', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecure = process.env.COOKIE_SECURE;
  process.env.NODE_ENV = 'production';
  delete process.env.COOKIE_SECURE;

  let prodServer;
  try {
    // createApp is called inside startTestServer, so env must be set first.
    prodServer = await startTestServer();
    const res = await fetch(`${prodServer.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
  } finally {
    if (prodServer) await prodServer.close();
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = prevSecure;
  }
});

test('COOKIE_SECURE=false overrides Secure even in production', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecure = process.env.COOKIE_SECURE;
  process.env.NODE_ENV = 'production';
  process.env.COOKIE_SECURE = 'false';

  let prodServer;
  try {
    prodServer = await startTestServer();
    const res = await fetch(`${prodServer.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(!/;\s*Secure/i.test(setCookie), 'Secure must be absent when overridden');
  } finally {
    if (prodServer) await prodServer.close();
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = prevSecure;
  }
});

test('logout clears the cookie with the same attributes', async () => {
  const cookie = await login(server.baseUrl, 'admin', 'admin123');
  const res = await req(server.baseUrl, '/api/auth/logout', { method: 'POST', cookie });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, /absensi_token=/);
  assert.match(setCookie, /Path=\//);
});
