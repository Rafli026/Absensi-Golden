# Deployment Produksi — Absensi New Golden Bakery & Cakes

Panduan men-deploy aplikasi ke VPS (Ubuntu) dengan HTTPS. Aplikasi adalah
Node.js/Express + SQLite (`node:sqlite`) yang menyajikan frontend statis dari
folder `public/`.

---

## 1. Prasyarat

- **VPS Ubuntu 22.04 / 24.04** dengan akses `sudo`.
- **Domain** (mis. `absensi.domainanda.com`) dengan A/AAAA record mengarah ke IP VPS.
- **Node.js 22+** (wajib — aplikasi memakai modul bawaan `node:sqlite`).

### Install Node.js 22 via NodeSource

```bash
sudo apt update
sudo apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v      # harus v22.x atau lebih baru
```

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Opsional (untuk backup): `sudo apt install -y sqlite3`.

### Buat user non-root

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin absensi
```

---

## 2. Kenapa HTTPS Wajib

Browser hanya mengizinkan **kamera** (`getUserMedia`) dan **GPS**
(`navigator.geolocation`) pada **secure context**, yaitu:

- `https://...`, atau
- `http://localhost` (khusus development di mesin yang sama).

Artinya di produksi:

- **Scan QR** dan **Face Recognition** tidak akan bisa membuka kamera lewat HTTP.
- **Validasi lokasi** absensi tidak akan mendapat koordinat.
- Cookie `Secure` (`COOKIE_SECURE=true`) tidak akan dikirim lewat HTTP, sehingga
  login akan tampak "berhasil" lalu langsung logout.

Karena itu Caddy + HTTPS bukan opsional.

---

## 3a. Instalasi Otomatis (cara cepat)

Kalau Anda ingin menempuh jalur cepat, semua langkah di bawah (Node, Caddy,
user, clone, dependency, `.env`, seed, process manager, HTTPS, firewall, dan
health check) sudah dibungkus dalam satu skrip idempoten.

```bash
# Di VPS, setelah clone repo
sudo bash deploy/setup.sh --pm2 --domain=absensi.domainanda.com
```

Ganti `--pm2` dengan `--systemd` bila ingin memakai systemd. Opsi lain:
`--skip-node`, `--skip-caddy`, `--help`.

**Yang dilakukan skrip:**

1. Memastikan dijalankan sebagai root dan mendeteksi Ubuntu/Debian.
2. Memasang Node.js 22 (hanya jika versi terpasang masih < 22), git, Caddy,
   dan `sqlite3` (opsional).
3. Membuat user sistem `absensi` dan direktori `/opt/absensi-golden`.
4. Clone `https://github.com/Rafli026/Absensi-Golden.git` **hanya jika**
   `package.json` belum ada.
5. `npm ci --omit=dev`, lalu membuat `.env` dari `.env.production.example`
   dengan `JWT_SECRET` acak 64 hex dan permission `600`.
6. `npm run seed` hanya jika `data/absensi.db` belum ada.
7. Menjalankan aplikasi lewat PM2 atau systemd (`instances: 1` tetap dipakai).
8. Memasang Caddyfile untuk domain Anda dan reload Caddy.
9. Membuka port 22/80/443 di `ufw` **hanya jika** `ufw` sudah aktif.
10. Menunggu `http://127.0.0.1:3000/api/health` mengembalikan `status: ok`
    (maksimal 20 detik) dan mencetak ringkasan.

**Sifat idempoten.** Skrip aman dijalankan ulang. Yang sudah ada tidak
ditimpa: user, direktori berisi kode, database, dan terutama **`.env`**
(`JWT_SECRET` lama dipertahankan agar semua sesi pengguna tidak ter-logout).

**Yang TIDAK dilakukan skrip:**

- **Tidak mengganti password demo.** Akun `admin/admin123` dan `budi/budi123`
  tetap ada setelah seed. Ganti lewat **menu Profil** segera setelah login
  (lihat bagian 4).
- Tidak menjadwalkan cron backup (lihat bagian 7).
- Tidak menjalankan `pm2 startup` — perintahnya dicetak di akhir dan harus
  dijalankan manual karena butuh path environment PM2.
- Tidak mengaktifkan `ufw` bila belum aktif (berisiko memutus SSH).

**Kapan pakai cara manual (bagian 3–6)?** Gunakan langkah manual bila:
VPS memakai distro selain Ubuntu/Debian, Node sudah dikelola tool lain
(nvm/asdf), ada Caddyfile/Nginx lain yang sudah melayani domain, kode
di-deploy dari arsip (bukan git), atau Anda perlu kendali penuh atas setiap
langkah (mis. `DB_PATH` di volume terpisah, user service berbeda).

---

## 3. Setup Aplikasi (manual)

```bash
# 1. Salin proyek ke /opt
sudo mkdir -p /opt/absensi-golden
sudo chown absensi:absensi /opt/absensi-golden

# Opsi A — dari git
sudo -u absensi git clone <URL_REPO> /opt/absensi-golden

# Opsi B — dari arsip lokal
# sudo -u absensi tar -xzf absensi.tar.gz -C /opt/absensi-golden --strip-components=1

cd /opt/absensi-golden

# 2. Install dependency produksi saja
sudo -u absensi npm ci --omit=dev

# 3. Siapkan .env
sudo -u absensi cp .env.production.example .env
sudo -u absensi node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   -> tempel hasilnya ke JWT_SECRET di .env
sudo -u absensi nano .env
sudo chmod 600 .env

# 4. Seed database awal
sudo -u absensi npm run seed

# 5. Folder pendukung
sudo -u absensi mkdir -p logs backups data
```

Pastikan `DB_PATH=./data/absensi.db` dan direktori `data/` dapat ditulis user
`absensi`.

---

## 4. Ganti Password Demo (WAJIB)

Seed awal membuat akun demo (`admin/admin123`, `budi/budi123`). **Ganti sebelum
aplikasi dipakai.**

1. Jalankan aplikasi (langkah 5) lalu buka `https://domain-anda/`.
2. Login sebagai `admin`.
3. Buka **Profil → Ganti Password**, isi password baru yang kuat.
4. Buka menu **Karyawan**, ubah password tiap karyawan (termasuk `budi`).
5. Hapus/ubah akun yang tidak dipakai.

> Kartu kredensial demo di halaman login otomatis dihapus saat
> `GET /api/public/config` melaporkan `demo_mode: false` (kondisi produksi).

---

## 5. Jalankan Aplikasi (pilih salah satu)

### Opsi A — PM2 (direkomendasikan untuk kesederhanaan)

```bash
sudo npm install -g pm2

cd /opt/absensi-golden
sudo -u absensi pm2 start ecosystem.config.cjs
sudo -u absensi pm2 save
sudo -u absensi pm2 startup
# Jalankan perintah `sudo env PATH=...` yang dicetak PM2.

pm2 status
pm2 logs absensi-golden
```

`instances` **wajib 1** karena SQLite hanya mendukung satu penulis. Mode cluster
akan memicu `SQLITE_BUSY: database is locked`.

### Opsi B — systemd

```bash
sudo cp deploy/absensi.service /etc/systemd/system/absensi.service
sudo nano /etc/systemd/system/absensi.service   # sesuaikan User & path node
sudo systemctl daemon-reload
sudo systemctl enable --now absensi
sudo systemctl status absensi
journalctl -u absensi -f
```

Jangan menjalankan PM2 dan systemd bersamaan — keduanya akan berebut port 3000.

---

## 6. Caddy + HTTPS

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # ganti domain
sudo systemctl reload caddy
sudo systemctl status caddy
```

Caddy otomatis meminta sertifikat Let's Encrypt dan memperbaruinya. Verifikasi:

```bash
curl -I https://absensi.domainanda.com
# harapan: HTTP/2 200
```

Jika sertifikat belum terbit, cek DNS sudah mengarah ke VPS dan port 80/443
terbuka (`sudo ufw allow 80,443/tcp`).

> Jangan menambahkan header CORS di Caddyfile — frontend dan API satu domain.

---

## 7. Backup & Restore

### Pasang cron

```bash
sudo chmod +x /opt/absensi-golden/deploy/backup.sh
sudo crontab -e
```

Tambahkan:

```cron
0 2 * * * /opt/absensi-golden/deploy/backup.sh >> /var/log/absensi-backup.log 2>&1
```

Skrip memakai `sqlite3 .backup` (aman untuk WAL), dengan fallback `VACUUM INTO`
via `node:sqlite`. Backup disimpan di `/opt/absensi-golden/backups/` dan
dipangkas setelah 14 hari (`KEEP_DAYS`).

Uji manual:

```bash
sudo DB_PATH=/opt/absensi-golden/data/absensi.db /opt/absensi-golden/deploy/backup.sh
ls -lh /opt/absensi-golden/backups/
```

### Restore

```bash
sudo systemctl stop absensi          # atau: pm2 stop absensi-golden
cd /opt/absensi-golden
sudo -u absensi cp data/absensi.db data/absensi.db.bak-$(date +%F-%H%M%S)
sudo -u absensi gunzip -c backups/absensi-YYYYMMDD-HHMMSS.db.gz > data/absensi.db
sudo -u absensi rm -f data/absensi.db-wal data/absensi.db-shm
sudo systemctl start absensi
```

> Cara otomatis (disarankan): lihat **bagian 7a** — `deploy/restore.sh`
> menangani semua langkah di atas plus health check dan rollback.

---

## 7a. Restore dari Backup

Cara yang disarankan — `deploy/restore.sh` menangani penghentian service,
penyimpanan database lama, pembersihan `-wal`/`-shm`, dan health check:

```bash
sudo bash /opt/absensi-golden/deploy/restore.sh \
  /opt/absensi-golden/backups/absensi-YYYYMMDD-HHMMSS.db.gz
```

Yang dilakukan skrip:

1. Memvalidasi file (ada, tidak kosong, gzip valid, header SQLite valid).
2. Mendeteksi process manager yang aktif (PM2 atau systemd) lalu
   **menghentikannya** agar tidak ada penulis lain saat restore.
3. Menyalin database saat ini ke `data/absensi.db.before-restore-<timestamp>`
   sebagai jaring pengaman.
4. `gunzip -c` ke file sementara, cek header, baru menukarnya menjadi
   `data/absensi.db`; sisa `-wal`/`-shm` dihapus lebih dulu.
5. `chown absensi:absensi` dan `chmod 640` pada database.
6. Menjalankan ulang service dan menunggu `/api/health` (maks. 20 detik).

Jika health check gagal, skrip mencetak perintah rollback lengkap memakai file
`.before-restore-*`. Simpan file itu sampai Anda yakin datanya benar.

> Restore **menimpa seluruh data** sejak backup dibuat. Pastikan file yang
> dipilih memang yang dimaksud (`ls -lh backups/`).

---

## 8. Update Aplikasi

```bash
cd /opt/absensi-golden

# Backup dulu
sudo -u absensi ./deploy/backup.sh

# Ambil versi baru
sudo -u absensi git pull        # atau salin file baru

# Dependency (tanpa dev)
sudo -u absensi npm ci --omit=dev

# Restart
pm2 restart absensi-golden      # Opsi A
# sudo systemctl restart absensi # Opsi B
```

**Jangan menghapus folder `data/`** — di situlah database berada. Jangan
menjalankan `npm run seed` pada database produksi karena akan menimpa data.

---

## 9. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Kamera tidak muncul / tombol scan diam | Halaman dibuka via HTTP. Pastikan `https://` dan sertifikat valid. Cek juga izin kamera di browser. |
| GPS tidak terdeteksi | Sama: butuh secure context. Pastikan `LOCATION_VALIDATION_ENABLED` sesuai kebutuhan. |
| **502 Bad Gateway** dari Caddy | Service tidak jalan atau port salah. `pm2 status` / `systemctl status absensi`, cek `logs/err.log`, pastikan listen di `127.0.0.1:3000`. |
| **Database is locked** (`SQLITE_BUSY`) | Ada lebih dari satu proses. Pastikan `instances: 1` (PM2) atau hanya satu service systemd. Matikan proses duplikat: `pm2 delete all`. |
| Login berhasil lalu langsung logout | `COOKIE_SECURE=true` tapi diakses via HTTP, atau `JWT_SECRET` berubah saat restart (semua sesi invalid). |
| Lupa password admin | Reset lewat Node (ganti `PASSWORD_BARU`): |
| Sertifikat gagal terbit | DNS belum propagate, atau port 80/443 tertutup firewall. |

### Reset password admin via Node

Hashing password ada di `server/lib/auth.js` (`hashPassword`, format
`scrypt$<salt>$<hash>`), kolomnya `users.password_hash`.

```bash
cd /opt/absensi-golden
sudo -u absensi node --input-type=module -e "
import { openDb } from './server/db.js';
import { hashPassword } from './server/lib/auth.js';
const db = openDb('./data/absensi.db');
const r = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?')
  .run(hashPassword('PASSWORD_BARU'), new Date().toISOString(), 'admin');
db.close();
console.log('Baris terupdate:', r.changes);
"
```

Hentikan service dulu (atau jalankan saat aplikasi berhenti) agar tidak ada
penulis lain. Setelah reset, login dan segera ganti lagi lewat menu Profil.

---

## 10. Checklist Go-Live

- [ ] `JWT_SECRET` acak kuat (≥32 karakter), tidak sama dengan contoh.
- [ ] Password demo (`admin123`, `budi123`) sudah diganti semua.
- [ ] `NODE_ENV=production` di `.env` dan di process manager.
- [ ] HTTPS aktif dan sertifikat valid (tidak ada warning browser).
- [ ] Kamera & GPS berfungsi di `https://domain-anda/`.
- [ ] Backup terjadwal (cron) dan sudah diuji restore.
- [ ] `instances: 1` / satu service saja yang berjalan.
- [ ] `COOKIE_SECURE=true`.
- [ ] Log terpantau (`pm2 logs` atau `journalctl -u absensi`).
- [ ] Firewall hanya membuka 22, 80, 443 (port 3000 tidak diekspos publik).
