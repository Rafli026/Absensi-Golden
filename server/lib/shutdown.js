// Graceful shutdown helper (extracted so it can be unit-tested).
//
// Stops accepting new connections, waits up to `timeoutMs` for in-flight
// requests, closes the database, then exits 0. If the timeout elapses first,
// it closes the DB and exits 1 so the process manager can restart it.

export function createShutdown({
  server,
  db,
  timeoutMs = 10_000,
  exit = (code) => process.exit(code),
  log = (...args) => console.log(...args),
  logError = (...args) => console.error(...args),
} = {}) {
  let shuttingDown = false;

  return function shutdown(signal = 'SIGTERM') {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Menerima ${signal}, menutup server...`);

    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        db.close();
      } catch (err) {
        logError('[shutdown] Gagal menutup database:', err);
      }
      exit(code);
    };

    const timer = setTimeout(() => {
      logError('Shutdown melebihi batas waktu, keluar paksa.');
      finish(1);
    }, timeoutMs);
    if (timer.unref) timer.unref();

    server.close(() => {
      log('Server berhenti dengan bersih.');
      finish(0);
    });

    // Drop idle keep-alive sockets so close() can complete promptly.
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  };
}
