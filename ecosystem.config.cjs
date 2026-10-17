// PM2 process file — Absensi New Golden Bakery & Cakes
//
// Pakai:
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup            # lalu jalankan perintah yang dicetak PM2
//
// Catatan: instances HARUS 1. Aplikasi memakai SQLite (node:sqlite) yang
// single-writer; menjalankan lebih dari satu proses akan menyebabkan
// "database is locked" dan data race.
module.exports = {
  apps: [
    {
      name: 'absensi-golden',
      script: 'server/index.js',
      instances: 1, // WAJIB 1 — SQLite single-writer, jangan pakai cluster mode
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      time: true, // timestamp pada baris log
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
