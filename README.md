# Sistem Absensi New Golden Bakery & Cakes

Aplikasi web absensi karyawan **New Golden Bakery & Cakes** yang berjalan **sepenuhnya lokal**. Dua peran (Admin & Karyawan) dan dua metode absensi: **Scan QR Code** dan **Face Recognition asli** (embedding wajah 128-dimensi diproses di browser, dicocokkan di server).

Tidak ada build step, tidak ada React, tidak ada database eksternal. Semua berjalan dengan Node.js bawaan (`node:sqlite`) dan Express.

---

## Requirements

- **Node.js ≥ 22** (wajib, karena memakai `node:sqlite` bawaan). Diverifikasi pada **Node v25.9.0**.
- npm (untuk `npm install`).
- Browser modern dengan kamera & WebGL untuk Face Recognition (**Chrome/Edge terbaru direkomendasikan**).

---

## Installation

```bash
npm install
```

Menyalin konfigurasi environment:

```bash
cp .env.example .env
# lalu edit .env dan isi JWT_SECRET dengan nilai acak
```

---

## Running

```bash
npm run seed     # mengisi database dengan data demo
npm start        # menjalankan server
```

Buka **http://localhost:3000** di browser.

---

## Database Setup

- Database SQLite tersimpan di `data/absensi.db` (folder `data/` di-`gitignore`).
- Skema **otomatis di-migrasi** setiap kali server dijalankan (`CREATE TABLE IF NOT EXISTS`).
- Untuk mereset database:

  ```bash
  npm run seed -- --force
  ```

  Perintah ini menghapus `data/absensi.db` lalu membuat ulang data demo.

---

## Environment Variables

| Key | Default | Deskripsi |
|---|---|---|
| `PORT` | `3000` | Port server HTTP. |
| `DB_PATH` | `./data/absensi.db` | Lokasi file SQLite. |
| `JWT_SECRET` | *(wajib diisi)* | Kunci HMAC untuk menandatangani token sesi. **Wajib**, minimal **32 karakter**; server menolak start jika kosong/terlalu pendek. Nilai contoh (`change-me-in-production`, `dev-secret-change-me`) ditolak saat `NODE_ENV=production`. |
| `SESSION_TTL_HOURS` | `12` | Masa berlaku cookie sesi (jam). Harus angka > 0. |
| `COOKIE_SECURE` | ikut `NODE_ENV` | Paksa atribut `Secure` pada cookie auth. Default `true` bila `NODE_ENV=production`, `false` bila development. Set `false` hanya untuk kasus khusus (mis. proxy HTTP internal). |
| `TRUST_PROXY` | `1` | Jumlah hop reverse proxy yang dipercaya (`app.set('trust proxy', …)`). Isi `1` untuk Caddy/Nginx. |
| `APP_TIMEZONE` | `Asia/Jakarta` | Zona waktu untuk perhitungan tanggal/jam absensi. |
| `LOCATION_VALIDATION_ENABLED` | `true` | Nilai awal validasi lokasi (juga bisa diubah dari halaman Settings). |
| `FACE_MATCH_THRESHOLD` | `0.5` | Ambang batas jarak euclidean pencocokan wajah (juga bisa diubah di Settings). |
| `ATTENDANCE_COOLDOWN_SECONDS` | `60` | Jeda minimum antar-scan absensi (detik). |
| `LATE_DEDUCTION_MODE` | `per_occurrence` | Cara hitung denda: `per_occurrence` (flat) atau `per_minute_block` (per menit). |
| `LATE_DEDUCTION_PER_OCCURRENCE` | `0` | Denda rupiah per kejadian telat (mode flat). |
| `LATE_DEDUCTION_PER_BLOCK` | `0` | Denda rupiah per blok menit (mode per menit). |
| `LATE_DEDUCTION_BLOCK_MINUTES` | `10` | Ukuran satu blok menit untuk mode per menit. |
| `NODE_ENV` | `development` | `development` atau `production`. Mode produksi mengaktifkan cookie `Secure`, header HSTS, dan mematikan `demo_mode`. |

> Catatan: `LOCATION_VALIDATION_ENABLED`, `FACE_MATCH_THRESHOLD`, dan `ATTENDANCE_COOLDOWN_SECONDS` pada `.env` hanya menjadi nilai awal saat pertama kali di-seed. Setelah itu nilainya disimpan di tabel `settings` dan diubah melalui halaman **Settings** admin.

---

## Demo Accounts

> ⚠️ **DEVELOPMENT ONLY** — Kredensial ini hanya untuk demo/development. **Jangan gunakan di produksi.**

| Peran | Username | Password | Nama |
|---|---|---|---|
| Admin | `admin` | `admin123` | Admin New Golden |
| Karyawan | `budi` | `budi123` | Budi Santoso (Baker) |
| Karyawan | `siti` | `siti123` | Siti Aminah (Kasir) |
| Karyawan | `andi` | `andi123` | Andi Wijaya (Helper) |

---

## Deployment Produksi

Aplikasi ditujukan untuk berjalan di VPS di belakang reverse proxy **HTTPS** (Caddy/Nginx). Ringkasan langkah dan hal yang wajib diperhatikan:

### Prasyarat

- **Node.js ≥ 22** (wajib, memakai `node:sqlite` bawaan).
- **Domain + sertifikat HTTPS**. Kamera (`getUserMedia`) dan GPS (`navigator.geolocation`) **hanya berfungsi pada secure context** — `https://` atau `localhost`. Lewat HTTP biasa, scan QR dan face recognition tidak akan bisa membuka kamera.
- Reverse proxy (Caddy/Nginx) meneruskan `X-Forwarded-For` / `X-Forwarded-Proto` ke aplikasi.

### Variabel environment wajib

```bash
NODE_ENV=production
PORT=3000
DB_PATH=./data/absensi.db
JWT_SECRET=<openssl rand -hex 32>   # minimal 32 karakter, JANGAN nilai contoh
COOKIE_SECURE=true
TRUST_PROXY=1
SESSION_TTL_HOURS=12
```

Server **menolak start** (exit 1) bila `JWT_SECRET` kosong, kurang dari 32 karakter, atau masih memakai nilai contoh saat produksi; bila `PORT` bukan 1–65535; atau bila `SESSION_TTL_HOURS` ≤ 0.

### Menjalankan dengan process manager

**pm2:**

```bash
npm ci --omit=dev
pm2 start server/index.js --name absensi --timezone Asia/Jakarta
pm2 save && pm2 startup
```

**systemd** (`/etc/systemd/system/absensi.service`):

```ini
[Unit]
Description=Absensi New Golden Bakery
After=network.target

[Service]
Type=simple
User=absensi
WorkingDirectory=/opt/absensi
EnvironmentFile=/opt/absensi/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now absensi
```

Server menangani `SIGTERM`/`SIGINT` secara graceful: berhenti menerima koneksi baru, menunggu maksimal 10 detik, menutup database, lalu keluar. Ini membuat `pm2 restart` / `systemctl restart` aman.

### Data persisten & backup

- Database ada di `data/absensi.db` (plus `-wal`/`-shm`). Folder `data/` **harus persisten** — jangan letakkan di dalam image/container yang ephemeral.
- Backup rutin dengan `sqlite3` (aman saat server berjalan):

  ```bash
  sqlite3 data/absensi.db ".backup '/backup/absensi-$(date +%F).db'"
  ```

  atau hentikan aplikasi sebentar lalu salin file `.db` beserta `-wal`/`-shm`.
- Uji restore backup secara berkala.

### Keamanan

- **Ganti password demo** (`admin123`, `budi123`, `siti123`, `andi123`) sebelum dipakai. Saat `NODE_ENV=production`, server mencetak peringatan tebal di log bila password admin masih default.
- Jalankan sebagai user non-root dan batasi permission `.env` (`chmod 600`).
- Aplikasi mengirim header keamanan (CSP, HSTS di produksi, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) dan menolak request mutasi `/api/*` yang `Origin`-nya tidak cocok dengan `Host`.
- Health check publik: `GET /api/health` → `{status, uptime, db, version}` (tanpa data sensitif).

---

## How to Add an Employee

1. Login sebagai **admin**.
2. Buka **Karyawan** → **+ Tambah Karyawan**.
3. Isi nama lengkap, username, password (min. 6 karakter), jabatan, cabang, dsb.
4. Klik **Simpan**. Kode karyawan (`KRY-###`) dan QR code (`ROTIABS-<uuid>`) dibuat otomatis.
5. Setelah dibuat, daftarkan wajahnya (lihat bagian berikut) agar bisa absen dengan Face Recognition.

---

## How to Generate & Print QR Codes

1. Buka **QR Code** di menu admin.
2. Halaman menampilkan kartu QR untuk setiap karyawan aktif (nama, kode, cabang, dan gambar QR).
3. Klik **🖨️ Cetak** untuk mencetak semua kartu (`window.print()`; navigasi disembunyikan saat cetak).
4. Untuk mengganti QR seorang karyawan: buka detail karyawan → **Regenerate QR**. QR lama otomatis tidak berlaku.

---

## How to Register a Face (Kamera Diperlukan)

1. Buka **Daftar Wajah** (admin).
2. Pilih karyawan, klik **Mulai Kamera**, lalu izinkan akses kamera.
3. Tunggu model wajah dimuat (unduhan pertama ± 7 MB, lalu di-cache browser).
4. Posisikan wajah di dalam kotak, klik **📸 Ambil & Simpan Wajah**.
5. Ulangi beberapa kali untuk menambah sampel (semakin banyak sampel, makin andal).
6. Halaman menampilkan daftar profil wajah terdaftar; Anda bisa menghapusnya kapan saja.

> **Privasi:** yang disimpan ke server hanya **vektor 128 angka** hasil ekstraksi wajah — **bukan foto**. Data tidak dapat dipakai untuk merekonstruksi wajah asli.

---

## How to Perform Attendance

### Via QR Code
1. Buka `/scan.html` (atau tombol **Absen Masuk/Pulang** di halaman karyawan).
2. Izinkan akses kamera & lokasi.
3. Arahkan QR code karyawan ke kamera.
4. Sistem otomatis menentukan tipe (Masuk jika belum ada, Pulang jika sudah masuk) dan menampilkan konfirmasi.

### Via Face Recognition
1. Buka `/face.html`.
2. Izinkan akses kamera & lokasi; tunggu model dimuat.
3. Klik **😊 Absen Sekarang**, lalu ikuti instruksi liveness (gerakkan wajah sedikit).
4. Sistem mencocokkan wajah dengan data server dan mencatat absensi.

Aturan tipe otomatis: belum ada catatan hari ini → **Masuk**; sudah Masuk → **Pulang**; sudah keduanya → error "sudah absen".

---

## Rekap Bulanan (Telat, Izin, Potongan)

Setiap karyawan punya rekap bulanan yang **otomatis reset ke 0 setiap ganti bulan** (dihitung berdasarkan periode `YYYY-MM`, jadi tidak perlu proses reset manual).

**Di sisi admin:**
- **Dashboard** → kartu **Rekap Bulanan Karyawan**: tabel per karyawan berisi kolom **Hadir, Telat, Total Menit Telat, Izin, Total Potongan**, plus baris TOTAL. Ada filter **Bulan**.
- **Detail Karyawan** → kartu **Rekap Bulan Ini** (Hadir / Telat / Izin / Total Potongan).
- **Settings → Lokasi → Aturan Denda Keterlambatan** — di sinilah Anda mengatur dendanya:

| Mode | Pengaturan | Contoh |
|---|---|---|
| **Per Menit** (disarankan) | "Setiap Berapa Menit" + "Denda per Blok" | Setiap **10 menit** telat = **Rp5.000** → telat 25 menit = 3 blok = **Rp15.000** |
| **Flat** | "Denda per Kejadian Telat" | Tiap kejadian telat **Rp25.000**, berapa pun menitnya |

- Setiap kali mengubah angka, ada **kotak Simulasi** yang langsung menghitung contoh (5 mnt, 10 mnt, 25 mnt) supaya Anda bisa memastikan dendanya sesuai sebelum menyimpan.
- Pembulatan mode per menit memakai **ceil**: telat 11 menit dengan blok 10 menit dihitung **2 blok** (blok yang sudah berjalan tetap dihitung).

**Di sisi karyawan:**
- Halaman **Absen** dan **Riwayat** menampilkan kartu **Rekap Bulan Ini**: **Hadir, Telat, Izin** saja.
- Karyawan **tidak pernah** melihat angka rupiah/denda — nilai denda hanya ada di sisi admin (endpoint rekap karyawan sengaja tidak mengirim field uang).

**Cara mencatat Izin:** Login admin → **Absensi** → bagian **Absensi Manual / Koreksi** → pilih karyawan, Tipe `Masuk`, Status `Izin`, lalu Simpan. Data izin otomatis ikut terhitung di rekap bulan tersebut.

---

## Profil Pengguna & Foto

Semua pengguna (admin maupun karyawan) punya halaman **Profil** yang dapat dibuka lewat klik nama/avatar di kanan atas navbar, atau langsung ke `/profile.html`.

- **Foto profil** — klik **Pilih Foto**, pilih gambar dari perangkat. Gambar otomatis **dipotong persegi di tengah dan diperkecil ke 400×400 JPEG** di browser sebelum dikirim, jadi ukurannya kecil (biasanya < 50 KB). Tombol **Hapus Foto** tersedia jika sudah ada foto.
- **Nama lengkap** — dapat diubah sendiri. Perubahan langsung terlihat di navbar tanpa perlu reload.
- **Username & peran** — hanya baca (readonly), tidak dapat diubah sendiri.
- **Ganti password** — isi password lama, password baru (min. 6 karakter), dan konfirmasi. Berlaku untuk **admin maupun karyawan**. Tersedia tombol 👁 untuk menampilkan/menyembunyikan password.
- **Status Face Recognition** — menampilkan apakah wajah sudah terdaftar (khusus akun karyawan).
- Jika belum ada foto, avatar menampilkan **inisial nama** (mis. "BS" untuk Budi Santoso).

> Foto disimpan sebagai data URL di kolom `users.photo` (bukan file terpisah), sehingga backup database sudah termasuk foto.

## Mode Gelap / Terang

Tombol **🌙 / ☀️** di kanan atas navbar mengganti tema kapan saja.

- Pilihan tersimpan di `localStorage` (key `absensi_theme`) dan **diingat saat berpindah halaman maupun setelah reload**.
- Jika belum pernah memilih, aplikasi mengikuti preferensi sistem operasi (`prefers-color-scheme`).
- Semua halaman mendukung kedua tema, termasuk halaman login, scan QR, dan face recognition.
- **Saat mencetak kartu QR, tema otomatis dipaksa terang** agar hasil cetak tetap hitam-putih yang jelas.

---

## How to Export Data
1. Buka **Export** (admin), atau tombol **Export CSV** di halaman Absensi.
2. Atur filter (tanggal, karyawan, status, metode, cabang) lalu klik **⬇️ Unduh CSV**.
3. File `absensi-<YYYY-MM-DD>.csv` terunduh. Format:
   - Kolom: `ID Absensi, ID Karyawan, Nama Karyawan, Tanggal, Waktu, Tipe, Metode, Status, Lokasi, Catatan, Created At, Updated At`.
   - `Tanggal` berformat **DD-MM-YYYY**.
   - Diawali **BOM UTF-8** agar terbuka rapi di Excel.

---

## Face Recognition Limitations

- Face Recognition berjalan **hanya di browser asli** (butuh kamera + WebGL). Tidak bisa diuji lewat CLI; pengujian server-side memakai descriptor sintetis (`test/face.test.js`).
- Menggunakan **face-api.js** (`@vladmandic/face-api`) dengan model **TinyFaceDetector + FaceLandmark68Tiny + FaceRecognition** (total ± 6.7 MB, diunduh saat pertama kali).
- Pencocokan memakai **jarak euclidean** antar embedding 128-d; cocok bila jarak ≤ **0.5** (dapat diubah di Settings).
- **Liveness hanya heuristik lemah**: mengharuskan wajah terdeteksi pada 3 frame berturut-turut dan bergerak > 4 px dalam ~1 detik. Ini menolak foto statis yang dipegang, **tetapi bukan anti-spoof sebenarnya** (tidak ada deteksi kedipan/3D).
- Membutuhkan izin kamera. Jika **WebGL atau model gagal dimuat**, halaman `/face.html` menampilkan pesan kesalahan eksplisit dan menyediakan tautan ke `/scan.html` (QR) sebagai alternatif — sistem **tidak** akan memalsukan keberhasilan.
- Akurasi bergantung pada pencahayaan, kualitas kamera, dan jumlah sampel wajah yang didaftarkan.

---

## How to Enable/Disable Location Validation

Ada dua cara:

1. **Lewat UI:** Login admin → **Lokasi** → centang/hilangkan **Aktifkan validasi lokasi (geofence)** → **Simpan Pengaturan**.
2. **Lewat konfigurasi awal:** set `LOCATION_VALIDATION_ENABLED` di `.env` (berlaku sebagai nilai awal saat seed).

Perilaku validasi:
- Jika **aktif**: koordinat cabang harus diset. Absensi dari luar radius cabang ditolak dengan pesan jarak (mis. "Anda berada 1112 m dari toko (maks 100 m)"). Koordinat karyawan yang tidak tersedia juga ditolak.
- Jika **nonaktif**: absensi diterima dari koordinat mana pun (`location_validated=0`).

> **Geolocation** hanya berfungsi di `https` atau `localhost`. Aplikasi ini menargetkan `localhost`, jadi berfungsi. Jika dijalankan di IP LAN via HTTP biasa, browser memblokir geolocation → nonaktifkan validasi lokasi atau gunakan `localhost`.

---

## How to Run Tests

```bash
npm test         # menjalankan seluruh test (node:test)
npm run smoke    # end-to-end: create → QR → check-in → check-out → dashboard → export
```

`npm test` mencakup: `auth`, `attendance`, `location`, `face`, `export`, `qr`, `recap`, `deduction`, `profile`, `production`, `shutdown`, dan `smoke`.

---

## Struktur Proyek

```
KP/
  package.json          # type:module, scripts, deps
  .env.example          # contoh environment
  server/
    index.js            # bootstrap: load .env, validasi env, migrate, listen, graceful shutdown
    app.js              # createApp(db) -> express app (headers, trust proxy, origin check)
    db.js               # openDb, migrate, settings, transaction
    schema.sql          # DDL
    seed.js             # npm run seed
    lib/                # time, auth, geo, validate, audit, face, csv, deduction, shutdown
    middleware/         # requireAuth, requireRole, rateLimit, errorHandler,
                        # securityHeaders, checkOrigin
    routes/             # auth, employees, branches, face, attendance, dashboard,
                        # settings, export, audit, health
  public/               # frontend vanilla ES modules + HTML + CSS
    img/logo.png        # logo toko untuk navbar & halaman login
    js/                 # api, ui, qr-scan, face, page-*
    admin/ employee/    # halaman per peran
  test/                 # node:test (auth, attendance, location, face, export, qr,
                        # recap, deduction, profile, production, shutdown, smoke)
  data/                 # absensi.db (gitignored)
```

---

## Catatan & Batasan Lain

- **Status `Izin`** tidak memiliki fitur pengajuan izin tersendiri (di luar cakupan). Status ini hanya dihasilkan melalui **Absensi Manual** oleh admin, dengan `method='Manual'` (nilai khusus admin).
- **Liveness** adalah heuristik gerakan/stabilitas, bukan deteksi kedipan/3D.
- Jika `node:sqlite` tidak tersedia (Node < 22), aplikasi menolak start dengan pesan yang jelas agar Node di-upgrade. Tidak ada driver alternatif yang dipasang.
