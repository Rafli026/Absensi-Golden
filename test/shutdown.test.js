// Graceful shutdown behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShutdown } from '../server/lib/shutdown.js';

function fakeServer({ closeDelayMs = 0, failClose = false } = {}) {
  return {
    closed: false,
    idleClosed: false,
    close(cb) {
      this.closed = true;
      if (failClose) return; // never calls back -> timeout path
      setTimeout(cb, closeDelayMs);
    },
    closeIdleConnections() {
      this.idleClosed = true;
    },
  };
}

function fakeDb() {
  return { closed: false, close() { this.closed = true; } };
}

test('shutdown closes the server, then the DB, and exits 0', async () => {
  const server = fakeServer();
  const db = fakeDb();
  let exitCode = null;
  const shutdown = createShutdown({
    server,
    db,
    timeoutMs: 500,
    exit: (code) => { exitCode = code; },
    log: () => {},
    logError: () => {},
  });

  shutdown('SIGTERM');
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(server.closed, true);
  assert.equal(server.idleClosed, true);
  assert.equal(db.closed, true);
  assert.equal(exitCode, 0);
});

test('shutdown exits 1 when server.close never completes', async () => {
  const server = fakeServer({ failClose: true });
  const db = fakeDb();
  let exitCode = null;
  const shutdown = createShutdown({
    server,
    db,
    timeoutMs: 30,
    exit: (code) => { exitCode = code; },
    log: () => {},
    logError: () => {},
  });

  shutdown('SIGINT');
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(db.closed, true);
  assert.equal(exitCode, 1);
});

test('shutdown is idempotent', async () => {
  const server = fakeServer();
  const db = fakeDb();
  const codes = [];
  const shutdown = createShutdown({
    server,
    db,
    timeoutMs: 500,
    exit: (code) => { codes.push(code); },
    log: () => {},
    logError: () => {},
  });

  shutdown('SIGINT');
  shutdown('SIGTERM');
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(codes, [0]);
});
