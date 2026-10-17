#!/usr/bin/env bash
# Backup SQLite yang aman untuk database mode WAL.
#
# JANGAN memakai `cp` mentah: pada mode WAL, salinan file .db saja bisa
# kehilangan transaksi yang masih ada di -wal, atau menghasilkan file yang
# tidak konsisten. Gunakan `.backup` (sqlite3) atau `VACUUM INTO`.
#
# Jadwal cron (setiap hari 02:00):
#   0 2 * * * /opt/absensi-golden/deploy/backup.sh >> /var/log/absensi-backup.log 2>&1
#
# Variabel bisa dioverride lewat environment, mis.:
#   DB_PATH=/path/lain.db KEEP_DAYS=30 ./backup.sh

set -euo pipefail

DB_PATH="${DB_PATH:-/opt/absensi-golden/data/absensi.db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/absensi-golden/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/absensi-$TS.db"
TMP="$BACKUP_DIR/.absensi-$TS.tmp.db"

if [ ! -f "$DB_PATH" ]; then
  echo "[$(date '+%F %T')] ERROR: database tidak ditemukan: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
rm -f "$TMP"
trap 'rm -f "$TMP"' EXIT

if command -v sqlite3 >/dev/null 2>&1; then
  # `.backup` memakai SQLite Online Backup API — konsisten walau DB sedang dipakai.
  sqlite3 "$DB_PATH" ".backup '$TMP'"
else
  # Fallback tanpa sqlite3 CLI: node:sqlite (Node >= 22) + VACUUM INTO.
  # VACUUM INTO menghasilkan salinan konsisten dan otomatis melakukan checkpoint WAL.
  echo "[$(date '+%F %T')] sqlite3 tidak ditemukan — memakai fallback node:sqlite (VACUUM INTO)"
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const [src, dest] = process.argv.slice(1);
    const db = new DatabaseSync(src);
    const esc = dest.replace(/\x27/g, "\x27\x27");
    db.exec(`VACUUM INTO \x27${esc}\x27`);
    db.close();
  ' "$DB_PATH" "$TMP"
fi

if [ ! -s "$TMP" ]; then
  echo "[$(date '+%F %T')] ERROR: backup gagal (file kosong)" >&2
  exit 1
fi

mv "$TMP" "$OUT"
gzip -f "$OUT"
trap - EXIT

# Rotasi: hapus backup lebih tua dari KEEP_DAYS hari.
DELETED=0
if [ "$KEEP_DAYS" -gt 0 ]; then
  while IFS= read -r old; do
    rm -f "$old"
    DELETED=$((DELETED + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'absensi-*.db.gz' -mmin +$((KEEP_DAYS * 1440)))
fi

SIZE="$(du -h "$OUT.gz" 2>/dev/null | cut -f1 || true)"
SIZE="${SIZE:-?}"
COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'absensi-*.db.gz' | wc -l | tr -d ' ')"

echo "[$(date '+%F %T')] OK backup: $OUT.gz ($SIZE)"
echo "[$(date '+%F %T')] Retensi: ${KEEP_DAYS} hari — dihapus: ${DELETED}, tersisa: ${COUNT}"
