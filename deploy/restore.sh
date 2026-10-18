#!/usr/bin/env bash
# =============================================================================
# deploy/restore.sh — Restore database Absensi dari backup .db.gz
#
# Usage:
#   sudo bash deploy/restore.sh <file-backup.db.gz>
#
# Contoh:
#   sudo bash deploy/restore.sh backups/absensi-20260118-020000.db.gz
#   sudo bash deploy/restore.sh /root/absensi-20260118-020000.db.gz
#
# Langkah:
#   1. Service dihentikan (PM2 atau systemd dideteksi otomatis).
#   2. Database saat ini disalin ke data/absensi.db.before-restore-<timestamp>.
#   3. Backup di-extract ke data/absensi.db, sisa -wal/-shm dihapus.
#   4. Owner diset ke absensi:absensi, service dijalankan ulang.
#   5. Health check /api/health ditunggu (maks. 20 detik).
#
# Untuk rollback: lihat perintah yang dicetak bila restore gagal.
# =============================================================================
set -euo pipefail

# --- Konstanta ---------------------------------------------------------------
APP_NAME="absensi-golden"
APP_USER="absensi"
APP_HOME="/home/${APP_USER}"
SERVICE_NAME="absensi"
DEFAULT_PORT="3000"
HEALTH_TIMEOUT=20

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${APP_DIR:-}" ]; then
  : # hormati override dari environment
elif [ -f "/opt/${APP_NAME}/package.json" ]; then
  APP_DIR="/opt/${APP_NAME}"
else
  APP_DIR="$(dirname "$SCRIPT_DIR")"
fi

# --- Warna -------------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[0;33m'
  C_RED=$'\033[0;31m'
  C_BLUE=$'\033[0;36m'
  C_BOLD=$'\033[1m'
else
  C_RESET=''
  C_GREEN=''
  C_YELLOW=''
  C_RED=''
  C_BLUE=''
  C_BOLD=''
fi

log()  { printf '%s[OK]%s   %s\n'   "$C_GREEN"  "$C_RESET" "$*"; }
info() { printf '%s[INFO]%s %s\n'   "$C_BLUE"   "$C_RESET" "$*"; }
step() { printf '\n%s==> %s%s\n'    "$C_BOLD"   "$*"       "$C_RESET"; }
warn() { printf '%s[WARN]%s %s\n'   "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%s[GAGAL]%s %s\n'  "$C_RED"    "$C_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/restore.sh <file-backup.db.gz>

  <file-backup.db.gz>  File hasil deploy/backup.sh (format gzip SQLite)

Variabel opsional:
  APP_DIR   Lokasi proyek (default: parent dari folder skrip ini)
  DB_PATH   Override path database (default: dibaca dari .env / data/absensi.db)
EOF
}

# --- 1. Validasi argumen -----------------------------------------------------
step "Memvalidasi argumen"

if [ "$#" -ne 1 ]; then
  usage
  die "Butuh tepat satu argumen: file backup .db.gz"
fi

BACKUP_FILE="$1"

case "$BACKUP_FILE" in
  -h|--help) usage; exit 0 ;;
esac

[ -f "$BACKUP_FILE" ] || die "File backup tidak ditemukan: $BACKUP_FILE"
[ -s "$BACKUP_FILE" ] || die "File backup kosong: $BACKUP_FILE"

# Terima path relatif terhadap direktori kerja saat ini.
BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"

have gzip || die "gzip tidak terpasang. Pasang dengan: apt-get install -y gzip"
gzip -t "$BACKUP_FILE" 2>/dev/null || die "File bukan gzip yang valid: $BACKUP_FILE"

log "File backup valid: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# --- 2. Cek root & direktori -------------------------------------------------
step "Memeriksa lingkungan"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  die "Skrip ini harus dijalankan sebagai root. Gunakan: sudo bash deploy/restore.sh <file>"
fi
log "Berjalan sebagai root."

[ -d "$APP_DIR" ] || die "Direktori aplikasi tidak ditemukan: $APP_DIR"
[ -f "${APP_DIR}/package.json" ] || die "package.json tidak ada di ${APP_DIR} — APP_DIR salah?"
id -u "$APP_USER" >/dev/null 2>&1 || die "User '${APP_USER}' tidak ada. Jalankan deploy/setup.sh dulu."

# --- 3. Tentukan path database ----------------------------------------------
step "Menentukan lokasi database"

ENV_FILE="${APP_DIR}/.env"
DB_REL=""
if [ -n "${DB_PATH:-}" ]; then
  DB_REL="$DB_PATH"
elif [ -f "$ENV_FILE" ]; then
  DB_REL="$(sed -n -E 's/^[[:space:]]*DB_PATH=(.*)$/\1/p' "$ENV_FILE" | tail -n1)"
  DB_REL="${DB_REL%\"}"; DB_REL="${DB_REL#\"}"
  DB_REL="${DB_REL%\'}"; DB_REL="${DB_REL#\'}"
fi
DB_REL="${DB_REL:-./data/absensi.db}"

case "$DB_REL" in
  /*) DB_FILE="$DB_REL" ;;
  *)  DB_FILE="${APP_DIR}/${DB_REL#./}" ;;
esac

DB_DIR="$(dirname "$DB_FILE")"
[ -n "$DB_DIR" ] || die "Tidak dapat menentukan direktori database."
mkdir -p "$DB_DIR"

info "Database target: $DB_FILE"

APP_PORT="$(sed -n -E 's/^[[:space:]]*PORT=([0-9]+).*/\1/p' "$ENV_FILE" 2>/dev/null | tail -n1)"
APP_PORT="${APP_PORT:-$DEFAULT_PORT}"
HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"

# --- 4. Deteksi & hentikan service ------------------------------------------
step "Menghentikan service"

PM_KIND="none"
SERVICE_STOPPED=0
SERVICE_RESTARTED=0
TMP_DB=""

# --- Jaring pengaman: pastikan service tidak ditinggal mati -------------------
on_exit() {
  local code=$?

  # Bersihkan file sementara hasil ekstraksi.
  if [ -n "${TMP_DB:-}" ] && [ -f "${TMP_DB:-}" ]; then
    rm -f -- "$TMP_DB"
  fi

  # Kalau skrip gagal setelah service dihentikan, hidupkan lagi dengan
  # database yang ada (lama atau baru) supaya aplikasi tidak down.
  if [ "$SERVICE_STOPPED" -eq 1 ] && [ "$SERVICE_RESTARTED" -eq 0 ]; then
    printf '\n%s[WARN]%s Skrip berhenti tak terduga — menjalankan ulang service.\n' \
      "$C_YELLOW" "$C_RESET" >&2
    case "$PM_KIND" in
      pm2)     sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 restart "$APP_NAME" >/dev/null 2>&1 || true ;;
      systemd) systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true ;;
    esac
  fi

  exit "$code"
}
trap on_exit EXIT

pm2_has_app() {
  have pm2 || return 1
  sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 describe "$APP_NAME" >/dev/null 2>&1
}

if pm2_has_app; then
  PM_KIND="pm2"
elif have systemctl && systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
  PM_KIND="systemd"
fi

case "$PM_KIND" in
  pm2)
    info "Terdeteksi PM2 — menghentikan '${APP_NAME}' ..."
    sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 stop "$APP_NAME" >/dev/null
    SERVICE_STOPPED=1
    log "PM2 dihentikan."
    ;;
  systemd)
    info "Terdeteksi systemd — menghentikan '${SERVICE_NAME}' ..."
    systemctl stop "$SERVICE_NAME"
    SERVICE_STOPPED=1
    log "Service systemd dihentikan."
    ;;
  none)
    warn "Tidak ada service PM2/systemd yang terdeteksi."
    warn "Pastikan tidak ada proses lain yang memakai database (cek: pgrep -af 'server/index.js')."
    ;;
esac

# Beri waktu agar proses benar-benar melepas file SQLite.
sleep 2

# --- 5. Backup database saat ini (jaring pengaman) ---------------------------
step "Menyimpan database saat ini"

TS="$(date +%Y%m%d-%H%M%S)"
ROLLBACK_FILE="${DB_FILE}.before-restore-${TS}"

if [ -f "$DB_FILE" ]; then
  if have sqlite3; then
    # Aman untuk WAL walau service sudah berhenti.
    sqlite3 "$DB_FILE" ".backup '${ROLLBACK_FILE}'" 2>/dev/null \
      || cp -p "$DB_FILE" "$ROLLBACK_FILE"
  else
    cp -p "$DB_FILE" "$ROLLBACK_FILE"
  fi
  chown "${APP_USER}:${APP_USER}" "$ROLLBACK_FILE"
  log "Database lama disimpan: $ROLLBACK_FILE"
else
  warn "Database lama tidak ada (${DB_FILE}) — tidak ada yang dibackup."
fi

# --- 6. Restore --------------------------------------------------------------
step "Me-restore backup"

TMP_DB="${DB_FILE}.restore-tmp-${TS}"

# Guard: jangan pernah menulis ke path kosong.
: "${DB_FILE:?DB_FILE kosong — restore dibatalkan}"
: "${TMP_DB:?TMP_DB kosong — restore dibatalkan}"

info "Mengekstrak backup ..."
if have gunzip; then
  gunzip -c "$BACKUP_FILE" > "$TMP_DB"
else
  gzip -dc "$BACKUP_FILE" > "$TMP_DB"
fi

[ -s "$TMP_DB" ] || die "Hasil ekstraksi kosong — backup rusak."

# Sanity check: file harus SQLite.
HEADER="$(head -c 16 "$TMP_DB" | tr -d '\0')"
case "$HEADER" in
  "SQLite format 3") : ;;
  *) die "File hasil ekstraksi bukan database SQLite (header tidak dikenal)." ;;
esac
log "Header SQLite valid."

# Hapus sidecar WAL lama SEBELUM menukar file — kalau tidak, SQLite bisa
# memutar ulang WAL dari database lama di atas database baru.
rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"

mv -f "$TMP_DB" "$DB_FILE"
TMP_DB=""

chown "${APP_USER}:${APP_USER}" "$DB_FILE"
chmod 640 "$DB_FILE"
log "Database dipulihkan dari backup."

# --- 7. Jalankan ulang service ----------------------------------------------
step "Menjalankan ulang service"

case "$PM_KIND" in
  pm2)
    sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 restart "$APP_NAME" >/dev/null
    sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 save >/dev/null 2>&1 || true
    SERVICE_RESTARTED=1
    log "PM2 dijalankan ulang."
    ;;
  systemd)
    systemctl start "$SERVICE_NAME"
    SERVICE_RESTARTED=1
    log "Service systemd dijalankan."
    ;;
  none)
    warn "Tidak ada service yang dijalankan ulang — jalankan aplikasi manual."
    ;;
esac

# --- 8. Health check ---------------------------------------------------------
step "Menunggu aplikasi siap (maks. ${HEALTH_TIMEOUT} detik)"

HEALTH_SKIPPED=0
if ! have curl; then
  warn "curl tidak tersedia — health check dilewati."
  HEALTH_SKIPPED=1
  HEALTH_TIMEOUT=0
fi

HEALTH_OK=0
HEALTH_BODY=""
HEALTH_DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))

while [ "$(date +%s)" -lt "$HEALTH_DEADLINE" ]; do
  if HEALTH_BODY="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)"; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done

# --- 9. Ringkasan ------------------------------------------------------------
printf '\n'
if [ "$HEALTH_SKIPPED" -eq 1 ]; then
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_YELLOW" "$C_RESET"
  printf '%s%s  RESTORE SELESAI (health check tidak dijalankan)%s\n' "$C_BOLD" "$C_YELLOW" "$C_RESET"
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_YELLOW" "$C_RESET"
  printf '\n'
  printf '  Backup sumber   : %s\n' "$BACKUP_FILE"
  printf '  Database aktif  : %s\n' "$DB_FILE"
  printf '  Salinan sebelum : %s\n' "${ROLLBACK_FILE:-<tidak ada>}"
  printf '\n'
  printf '  curl tidak terpasang, jadi status aplikasi belum diverifikasi.\n'
  printf '  Periksa manual: systemctl status %s  /  pm2 status\n' "$SERVICE_NAME"
  printf '\n'
  exit 0
fi

if [ "$HEALTH_OK" -eq 1 ]; then
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
  printf '%s%s  RESTORE BERHASIL%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
  printf '\n'
  printf '  Backup sumber      : %s\n' "$BACKUP_FILE"
  printf '  Database aktif     : %s\n' "$DB_FILE"
  printf '  Salinan sebelum    : %s\n' "${ROLLBACK_FILE:-<tidak ada>}"
  printf '  Health             : %s\n' "$HEALTH_BODY"
  printf '\n'
  printf '  %sLangkah berikutnya:%s\n' "$C_BOLD" "$C_RESET"
  printf '    - Login dan periksa data absensi terbaru.\n'
  printf '    - Simpan salinan .before-restore sampai yakin data benar.\n'
  printf '\n'
  exit 0
fi

printf '%s%s============================================================%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
printf '%s%s  RESTORE SELESAI, TAPI HEALTH CHECK GAGAL%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
printf '%s%s============================================================%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
printf '\n'
printf '  URL health : %s\n' "$HEALTH_URL"
printf '  Backup     : %s\n' "$BACKUP_FILE"
printf '  Database   : %s\n' "$DB_FILE"
printf '\n'
printf '  %sCara rollback ke database sebelumnya:%s\n' "$C_BOLD" "$C_YELLOW"
if [ -n "${ROLLBACK_FILE:-}" ] && [ -f "${ROLLBACK_FILE:-}" ]; then
  printf '    # 1. Hentikan service\n'
  if [ "$PM_KIND" = "pm2" ]; then
    printf '    sudo -u %s pm2 stop %s\n' "$APP_USER" "$APP_NAME"
  else
    printf '    sudo systemctl stop %s\n' "$SERVICE_NAME"
  fi
  printf '    # 2. Kembalikan file lama\n'
  printf '    sudo rm -f %s-wal %s-shm\n' "$DB_FILE" "$DB_FILE"
  printf '    sudo cp -p %s %s\n' "$ROLLBACK_FILE" "$DB_FILE"
  printf '    sudo chown %s:%s %s\n' "$APP_USER" "$APP_USER" "$DB_FILE"
  printf '    # 3. Jalankan lagi\n'
  if [ "$PM_KIND" = "pm2" ]; then
    printf '    sudo -u %s pm2 restart %s\n' "$APP_USER" "$APP_NAME"
  else
    printf '    sudo systemctl start %s\n' "$SERVICE_NAME"
  fi
else
  printf '    Tidak ada salinan .before-restore — rollback tidak tersedia.\n'
  printf '    Pulihkan dari backup lain dengan skrip ini.\n'
fi
printf '\n'
printf '  Periksa log:\n'
if [ "$PM_KIND" = "pm2" ]; then
  printf '    sudo -u %s pm2 logs %s --lines 50\n' "$APP_USER" "$APP_NAME"
else
  printf '    journalctl -u %s -n 50 --no-pager\n' "$SERVICE_NAME"
fi
printf '\n'

exit 1
