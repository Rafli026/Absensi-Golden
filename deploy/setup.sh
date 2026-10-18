#!/usr/bin/env bash
# =============================================================================
# deploy/setup.sh — Instalasi otomatis (idempoten) Absensi New Golden Bakery
#
# Usage:
#   sudo bash deploy/setup.sh [--pm2|--systemd] [--domain=contoh.com] \
#                             [--skip-node] [--skip-caddy]
#
# Contoh:
#   sudo bash deploy/setup.sh --pm2 --domain=absensi.domainanda.com
#   sudo bash deploy/setup.sh --systemd --domain=absensi.domainanda.com
#
# Skrip ini AMAN dijalankan ulang:
#   - user, direktori, dan service yang sudah ada tidak dibuat ulang;
#   - .env yang sudah ada TIDAK PERNAH ditimpa (JWT_SECRET lama dipertahankan);
#   - database yang sudah ada tidak di-seed ulang.
#
# Yang TIDAK dilakukan skrip ini:
#   - mengganti password demo (admin123 / budi123) — lakukan manual via UI;
#   - menjalankan `pm2 startup` (butuh path environment, jalankan manual).
# =============================================================================
set -euo pipefail

# --- Konstanta ---------------------------------------------------------------
APP_NAME="absensi-golden"
APP_USER="absensi"
APP_HOME="/home/${APP_USER}"
APP_DIR="/opt/absensi-golden"
REPO_URL="https://github.com/Rafli026/Absensi-Golden.git"
DOMAIN_PLACEHOLDER="absensi.domainanda.com"
CADDY_TARGET="/etc/caddy/Caddyfile"
SERVICE_NAME="absensi"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"
DEFAULT_PORT="3000"

# --- Opsi CLI ----------------------------------------------------------------
PM_MODE="pm2"
DOMAIN=""
SKIP_NODE=0
SKIP_CADDY=0

# --- Warna (fallback kalau bukan TTY) ----------------------------------------
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

# --- Helper ------------------------------------------------------------------
log()  { printf '%s[OK]%s   %s\n'   "$C_GREEN"  "$C_RESET" "$*"; }
info() { printf '%s[INFO]%s %s\n'   "$C_BLUE"   "$C_RESET" "$*"; }
step() { printf '\n%s==> %s%s\n'    "$C_BOLD"   "$*"       "$C_RESET"; }
warn() { printf '%s[WARN]%s %s\n'   "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%s[GAGAL]%s %s\n'  "$C_RED"    "$C_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

on_error() {
  local code=$?
  printf '\n%s[GAGAL]%s Skrip berhenti pada baris %s (exit %s).\n' \
    "$C_RED" "$C_RESET" "${BASH_LINENO[0]:-?}" "$code" >&2
  printf 'Periksa pesan di atas. Skrip idempoten — perbaiki masalah lalu jalankan ulang.\n' >&2
}
trap on_error ERR

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/setup.sh [--pm2|--systemd] [--domain=contoh.com]
                                 [--skip-node] [--skip-caddy]

  --pm2              Pakai PM2 sebagai process manager (default)
  --systemd          Pakai systemd unit (deploy/absensi.service)
  --domain=NAMA      Domain publik untuk Caddy (tanpa https://)
  --skip-node        Jangan install/upgrade Node.js
  --skip-caddy       Jangan install/konfigurasi Caddy
  -h, --help         Tampilkan bantuan ini
EOF
}

# Jalankan perintah sebagai user aplikasi, di dalam APP_DIR.
as_app() {
  sudo -u "$APP_USER" env HOME="$APP_HOME" PATH="$PATH" bash -c "cd '$APP_DIR' && $*"
}

# --- Parse argumen -----------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --pm2)        PM_MODE="pm2" ;;
    --systemd)    PM_MODE="systemd" ;;
    --domain=*)   DOMAIN="${arg#*=}" ;;
    --skip-node)  SKIP_NODE=1 ;;
    --skip-caddy) SKIP_CADDY=1 ;;
    -h|--help)    usage; exit 0 ;;
    *)            usage; die "Argumen tidak dikenal: $arg" ;;
  esac
done

if [ "$PM_MODE" != "pm2" ] && [ "$PM_MODE" != "systemd" ]; then
  die "Mode process manager tidak valid: $PM_MODE"
fi

# --- 1. Cek root -------------------------------------------------------------
step "Memeriksa hak akses"
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  die "Skrip ini harus dijalankan sebagai root. Gunakan: sudo bash deploy/setup.sh"
fi
log "Berjalan sebagai root."

# --- 2. Deteksi OS -----------------------------------------------------------
step "Mendeteksi sistem operasi"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_VER="${VERSION_ID:-?}"
  info "Terdeteksi: ${PRETTY_NAME:-$OS_ID $OS_VER}"
  case "$OS_ID" in
    ubuntu|debian) log "Distribusi didukung." ;;
    *) warn "Distribusi '$OS_ID' bukan Ubuntu/Debian. Skrip tetap dilanjutkan, tetapi perintah apt mungkin gagal." ;;
  esac
else
  warn "/etc/os-release tidak ditemukan — melanjutkan dengan asumsi Debian-like."
fi

export DEBIAN_FRONTEND=noninteractive
APT_UPDATED=0
apt_update_once() {
  if [ "$APT_UPDATED" -eq 0 ]; then
    info "apt-get update ..."
    apt-get update -qq || warn "apt-get update gagal — melanjutkan dengan indeks yang ada."
    APT_UPDATED=1
  fi
}
apt_install() {
  apt_update_once
  apt-get install -y -qq "$@"
}

# --- 3. Node.js >= 22 --------------------------------------------------------
step "Memeriksa Node.js"
node_major() {
  node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

install_node() {
  info "Memasang Node.js 22 dari NodeSource ..."
  apt_install curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt_install nodejs
}

if [ "$SKIP_NODE" -eq 1 ]; then
  warn "--skip-node: pemasangan/upgrade Node.js dilewati."
  have node || die "Node.js tidak ditemukan, tetapi --skip-node dipakai."
elif ! have node; then
  install_node
else
  CUR_MAJOR="$(node_major)"
  if [ -z "$CUR_MAJOR" ]; then
    warn "Tidak dapat membaca versi Node.js — memasang ulang Node 22."
    install_node
  elif [ "$CUR_MAJOR" -lt 22 ]; then
    info "Node.js v${CUR_MAJOR} terlalu lama (butuh >= 22). Memasang Node 22 ..."
    install_node
  else
    log "Node.js $(node -v) sudah memenuhi syarat (>= 22)."
  fi
fi

have node || die "Node.js tidak tersedia setelah proses instalasi."
log "Node.js: $(node -v)"

# --- 4. git ------------------------------------------------------------------
step "Memeriksa git & sudo"
if have git; then
  log "git sudah terpasang: $(git --version)"
else
  info "git belum ada — memasang ..."
  apt_install git
  log "git terpasang."
fi

if have sudo; then
  log "sudo tersedia."
else
  info "sudo belum ada — memasang (dibutuhkan untuk menjalankan perintah sebagai ${APP_USER}) ..."
  apt_install sudo
  have sudo || die "sudo gagal dipasang."
  log "sudo terpasang."
fi

# --- 5. Caddy ----------------------------------------------------------------
step "Memeriksa Caddy"
install_caddy() {
  info "Memasang Caddy dari repo resmi ..."
  apt_install debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  if ! curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
       | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg; then
    die "Gagal mengunduh kunci GPG Caddy. Periksa koneksi internet lalu jalankan ulang."
  fi
  if ! curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
       > /etc/apt/sources.list.d/caddy-stable.list; then
    die "Gagal mengunduh repo Caddy. Periksa koneksi internet lalu jalankan ulang."
  fi
  APT_UPDATED=0
  apt_update_once
  apt_install caddy
}

if [ "$SKIP_CADDY" -eq 1 ]; then
  warn "--skip-caddy: instalasi & konfigurasi Caddy dilewati."
elif have caddy; then
  log "Caddy sudah terpasang: $(caddy version 2>/dev/null | head -n1)"
else
  install_caddy
  log "Caddy terpasang."
fi

# --- 6. sqlite3 (opsional) ---------------------------------------------------
step "Memeriksa sqlite3 (opsional, untuk backup)"
if have sqlite3; then
  log "sqlite3 sudah terpasang."
else
  info "sqlite3 belum ada — mencoba memasang (kegagalan tidak menghentikan skrip) ..."
  if apt_install sqlite3; then
    log "sqlite3 terpasang."
  else
    warn "sqlite3 gagal dipasang. deploy/backup.sh akan memakai fallback node:sqlite."
  fi
fi

# --- 7. User sistem ----------------------------------------------------------
step "Menyiapkan user sistem '${APP_USER}'"
if id -u "$APP_USER" >/dev/null 2>&1; then
  log "User '${APP_USER}' sudah ada — dilewati."
else
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  log "User '${APP_USER}' dibuat."
fi

# --- 8. Direktori aplikasi & clone -------------------------------------------
step "Menyiapkan direktori ${APP_DIR}"
mkdir -p "$APP_DIR"
chown "${APP_USER}:${APP_USER}" "$APP_DIR"

if [ -f "${APP_DIR}/package.json" ]; then
  log "Kode aplikasi sudah ada di ${APP_DIR} — clone dilewati."
  # Pastikan kepemilikan benar tanpa mengubah isi.
  chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
else
  if [ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]; then
    warn "${APP_DIR} tidak kosong tetapi tidak berisi package.json."
    warn "Clone dibatalkan agar tidak menimpa isi direktori. Periksa manual:"
    warn "  ls -la ${APP_DIR}"
    die "Direktori ${APP_DIR} berisi data tak dikenal."
  fi
  info "Meng-clone ${REPO_URL} ke ${APP_DIR} ..."
  sudo -u "$APP_USER" env HOME="$APP_HOME" git clone "$REPO_URL" "$APP_DIR"
  log "Clone selesai."
fi

[ -f "${APP_DIR}/package.json" ] || die "package.json tidak ditemukan di ${APP_DIR}."
[ -f "${APP_DIR}/ecosystem.config.cjs" ] || warn "ecosystem.config.cjs tidak ditemukan — mode PM2 mungkin gagal."

# --- 9. Dependency produksi --------------------------------------------------
step "Memasang dependency produksi (npm ci --omit=dev)"
as_app "npm ci --omit=dev --no-audit --no-fund"
log "Dependency terpasang."

# --- 10. .env (JANGAN pernah menimpa yang sudah ada) -------------------------
step "Menyiapkan file .env"
ENV_FILE="${APP_DIR}/.env"

if [ -f "$ENV_FILE" ]; then
  log ".env sudah ada — TIDAK diubah (JWT_SECRET & sesi yang berjalan dipertahankan)."
else
  [ -f "${APP_DIR}/.env.production.example" ] \
    || die ".env.production.example tidak ditemukan — tidak bisa membuat .env."

  JWT_SECRET_NEW="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  [ "${#JWT_SECRET_NEW}" -eq 64 ] || die "Gagal membuat JWT_SECRET acak."

  # Tulis ke file sementara agar .env tidak pernah setengah jadi.
  TMP_ENV="$(mktemp)"
  cp "${APP_DIR}/.env.production.example" "$TMP_ENV"
  # Ganti baris JWT_SECRET apa pun isinya dengan nilai acak baru.
  sed -i -E "s|^[[:space:]]*JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET_NEW}|" "$TMP_ENV"
  # Kalau template tidak punya baris JWT_SECRET sama sekali, tambahkan.
  if ! grep -q '^JWT_SECRET=' "$TMP_ENV"; then
    printf '\nJWT_SECRET=%s\n' "$JWT_SECRET_NEW" >> "$TMP_ENV"
  fi

  install -m 600 -o "$APP_USER" -g "$APP_USER" "$TMP_ENV" "$ENV_FILE"
  rm -f "$TMP_ENV"
  log ".env dibuat dari .env.production.example dengan JWT_SECRET acak (64 hex, mode 600)."
fi

# Pastikan permission selalu benar, walau .env sudah ada sebelumnya.
chown "${APP_USER}:${APP_USER}" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Pemeriksaan read-only: tidak mengubah isi .env, hanya memberi peringatan.
if grep -q 'ganti dengan string acak' "$ENV_FILE"; then
  warn ".env masih berisi placeholder JWT_SECRET. Aplikasi akan menolak start."
  warn "Perbaiki manual: sudo -u ${APP_USER} nano ${ENV_FILE}"
fi

# Baca PORT dari .env (default 3000) untuk health check.
APP_PORT="$(sed -n -E 's/^[[:space:]]*PORT=([0-9]+).*/\1/p' "$ENV_FILE" | tail -n1)"
APP_PORT="${APP_PORT:-$DEFAULT_PORT}"

# --- 11. Seed database (hanya jika belum ada) --------------------------------
step "Memeriksa database"

DB_REL="$(sed -n -E 's/^[[:space:]]*DB_PATH=(.*)$/\1/p' "$ENV_FILE" | tail -n1)"
DB_REL="${DB_REL%\"}"; DB_REL="${DB_REL#\"}"
DB_REL="${DB_REL%\'}"; DB_REL="${DB_REL#\'}"
DB_REL="${DB_REL:-./data/absensi.db}"
case "$DB_REL" in
  /*) DB_FILE="$DB_REL" ;;
  *)  DB_FILE="${APP_DIR}/${DB_REL#./}" ;;
esac

mkdir -p "$(dirname "$DB_FILE")"
chown "${APP_USER}:${APP_USER}" "$(dirname "$DB_FILE")"

if [ -f "$DB_FILE" ]; then
  log "Database sudah ada (${DB_FILE}) — seed dilewati."
else
  info "Database belum ada — menjalankan npm run seed ..."
  as_app "npm run seed"
  log "Seed selesai (akun demo dibuat)."
fi
chown "${APP_USER}:${APP_USER}" "$DB_FILE" 2>/dev/null || true

# --- 12. Folder logs & backups ----------------------------------------------
step "Menyiapkan folder logs dan backups"
mkdir -p "${APP_DIR}/logs" "${APP_DIR}/backups"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/logs" "${APP_DIR}/backups"
log "Folder logs/ dan backups/ siap."

# Pastikan skrip backup dapat dieksekusi.
if [ -f "${APP_DIR}/deploy/backup.sh" ]; then
  chmod +x "${APP_DIR}/deploy/backup.sh"
  log "deploy/backup.sh ditandai executable."
fi

# --- 13. Process manager -----------------------------------------------------
step "Mengonfigurasi process manager (${PM_MODE})"

pm2_ready() {
  have pm2
}

start_pm2() {
  if ! pm2_ready; then
    info "PM2 belum terpasang — memasang global ..."
    npm install -g pm2 --no-audit --no-fund
  fi
  have pm2 || die "PM2 gagal dipasang."

  # Jangan biarkan systemd unit lama berebut port.
  if have systemctl && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    warn "Service systemd '${SERVICE_NAME}' sedang aktif — menghentikannya agar port tidak bentrok."
    systemctl stop "$SERVICE_NAME" || true
    systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi

  if as_app "pm2 describe ${APP_NAME} >/dev/null 2>&1"; then
    info "Proses PM2 '${APP_NAME}' sudah ada — restart dengan konfigurasi terbaru."
    as_app "pm2 restart ${APP_NAME} --update-env"
  else
    info "Menjalankan aplikasi lewat PM2 ..."
    as_app "pm2 start ecosystem.config.cjs"
  fi

  as_app "pm2 save"
  log "Aplikasi berjalan di bawah PM2 dan daftar proses disimpan."
}

start_systemd() {
  # Jangan biarkan PM2 dan systemd berebut port.
  if have pm2 && sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    warn "Proses PM2 '${APP_NAME}' terdeteksi — menghentikannya agar tidak bentrok dengan systemd."
    sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env HOME="$APP_HOME" pm2 save >/dev/null 2>&1 || true
  fi

  [ -f "${APP_DIR}/deploy/absensi.service" ] \
    || die "Template deploy/absensi.service tidak ditemukan."

  NODE_BIN="$(command -v node)"
  [ -n "$NODE_BIN" ] || die "Path node tidak ditemukan."

  install -m 644 "${APP_DIR}/deploy/absensi.service" "$SERVICE_TARGET"
  sed -i -E "s|^User=.*|User=${APP_USER}|"                       "$SERVICE_TARGET"
  sed -i -E "s|^Group=.*|Group=${APP_USER}|"                     "$SERVICE_TARGET"
  sed -i -E "s|^WorkingDirectory=.*|WorkingDirectory=${APP_DIR}|" "$SERVICE_TARGET"
  sed -i -E "s|^EnvironmentFile=.*|EnvironmentFile=${APP_DIR}/.env|" "$SERVICE_TARGET"
  sed -i -E "s|^ExecStart=.*|ExecStart=${NODE_BIN} server/index.js|" "$SERVICE_TARGET"

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
  log "Service systemd '${SERVICE_NAME}' aktif dan enabled."
}

case "$PM_MODE" in
  pm2)     start_pm2 ;;
  systemd) start_systemd ;;
  *)       die "Mode tidak dikenal: $PM_MODE" ;;
esac

# --- 14. Caddy ---------------------------------------------------------------
APP_DOMAIN=""
if [ "$SKIP_CADDY" -eq 1 ]; then
  warn "Konfigurasi Caddy dilewati (--skip-caddy)."
elif ! have caddy; then
  warn "Caddy tidak terpasang — konfigurasi HTTPS dilewati."
else
  step "Mengonfigurasi Caddy"

  if [ -z "$DOMAIN" ] && [ -t 0 ]; then
    printf 'Domain publik (tanpa https://) [%s]: ' "$DOMAIN_PLACEHOLDER"
    read -r DOMAIN || true
  fi
  DOMAIN="${DOMAIN:-$DOMAIN_PLACEHOLDER}"

  # Bersihkan input: buang skema dan trailing slash.
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%%/*}"

  # Validasi sederhana: hanya huruf, angka, titik, dan tanda hubung.
  if ! printf '%s' "$DOMAIN" | grep -qE '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'; then
    die "Domain tidak valid: '${DOMAIN}'. Contoh yang benar: absensi.contoh.com"
  fi

  if [ "$DOMAIN" = "$DOMAIN_PLACEHOLDER" ]; then
    warn "Domain masih placeholder (${DOMAIN_PLACEHOLDER})."
    warn "Ganti nanti di ${CADDY_TARGET}, atau jalankan ulang dengan --domain=domain-anda.com."
  fi

  CADDY_SHOULD_WRITE=0
  if [ ! -f "$CADDY_TARGET" ]; then
    CADDY_SHOULD_WRITE=1
    info "Caddyfile belum ada — memasang template."
  elif grep -qF "$DOMAIN_PLACEHOLDER" "$CADDY_TARGET"; then
    CADDY_SHOULD_WRITE=1
    info "Caddyfile masih berisi placeholder — memperbarui."
  else
    warn "${CADDY_TARGET} sudah ada dan bukan template kita — TIDAK ditimpa."
    warn "Periksa manual apakah sudah mengarah ke aplikasi ini."
  fi

  if [ "$CADDY_SHOULD_WRITE" -eq 1 ]; then
    TMP_CADDY="$(mktemp)"
    sed "s|${DOMAIN_PLACEHOLDER}|${DOMAIN}|g" "${APP_DIR}/deploy/Caddyfile" > "$TMP_CADDY"
    install -m 644 "$TMP_CADDY" "$CADDY_TARGET"
    rm -f "$TMP_CADDY"
    log "Caddyfile dipasang untuk domain: ${DOMAIN}"
  fi

  if caddy validate --config "$CADDY_TARGET" >/dev/null 2>&1; then
    log "Konfigurasi Caddy valid."
  else
    warn "Validasi Caddy gagal — periksa ${CADDY_TARGET}."
  fi

  systemctl enable caddy >/dev/null 2>&1 || true
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy || systemctl restart caddy || warn "Gagal reload Caddy."
  else
    systemctl start caddy || warn "Gagal menjalankan Caddy."
  fi
  log "Caddy dimuat ulang."

  # Hanya laporkan URL jika domain benar-benar terpasang di Caddyfile aktif.
  if grep -qF "$DOMAIN" "$CADDY_TARGET" 2>/dev/null; then
    APP_DOMAIN="$DOMAIN"
  else
    warn "Domain '${DOMAIN}' tidak ditemukan di ${CADDY_TARGET} — URL publik tidak diverifikasi."
  fi
fi

# --- 15. Firewall (hanya jika ufw sudah aktif) -------------------------------
step "Memeriksa firewall"
if have ufw; then
  if ufw status 2>/dev/null | grep -qi '^Status: active'; then
    ufw allow 22/tcp   >/dev/null 2>&1 || warn "Gagal membuka port 22."
    ufw allow 80/tcp   >/dev/null 2>&1 || warn "Gagal membuka port 80."
    ufw allow 443/tcp  >/dev/null 2>&1 || warn "Gagal membuka port 443."
    log "ufw aktif — port 22, 80, 443 diizinkan."
  else
    info "ufw tidak aktif — dibiarkan apa adanya (mengaktifkannya bisa memutus SSH)."
    info "Jika ingin mengaktifkan: sudo ufw allow 22/tcp && sudo ufw enable"
  fi
else
  info "ufw tidak terpasang — tidak ada perubahan firewall."
fi

# --- 16. Health check --------------------------------------------------------
step "Menunggu aplikasi siap (maks. 20 detik)"
if ! have curl; then
  warn "curl tidak ditemukan — memasang untuk health check ..."
  apt_install curl || warn "curl gagal dipasang; health check akan dilewati."
fi

HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"
HEALTH_OK=0
HEALTH_BODY=""
HEALTH_DEADLINE=$(( $(date +%s) + 20 ))

while [ "$(date +%s)" -lt "$HEALTH_DEADLINE" ]; do
  if HEALTH_BODY="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)"; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" -eq 1 ]; then
  log "Health check berhasil: ${HEALTH_BODY}"
else
  warn "Health check GAGAL setelah 20 detik (${HEALTH_URL})."
  if [ "$PM_MODE" = "pm2" ]; then
    warn "Periksa log: sudo -u ${APP_USER} pm2 logs ${APP_NAME} --lines 50"
  else
    warn "Periksa log: journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
  fi
  warn "Penyebab umum: JWT_SECRET lemah/placeholder, port ${APP_PORT} dipakai proses lain, atau DB terkunci."
fi

# --- 17. Ringkasan -----------------------------------------------------------
step "Selesai"
printf '\n'
if [ "$HEALTH_OK" -eq 1 ]; then
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
  printf '%s%s  INSTALASI SELESAI — %s%s\n' "$C_BOLD" "$C_GREEN" "$APP_NAME" "$C_RESET"
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
else
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
  printf '%s%s  INSTALASI SELESAI, TAPI HEALTH CHECK GAGAL%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
  printf '%s%s  Aplikasi BELUM tentu melayani request. Periksa log.%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
  printf '%s%s============================================================%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
fi
printf '\n'
printf '  Direktori aplikasi : %s\n' "$APP_DIR"
printf '  User service       : %s\n' "$APP_USER"
printf '  Process manager    : %s\n' "$PM_MODE"
printf '  Port lokal         : %s\n' "$APP_PORT"
if [ -n "${APP_DOMAIN:-}" ]; then
  printf '  URL publik         : https://%s\n' "$APP_DOMAIN"
else
  printf '  URL publik         : (Caddy belum dikonfigurasi)\n'
fi
printf '\n'

printf '  %sPerintah berguna:%s\n' "$C_BOLD" "$C_RESET"
if [ "$PM_MODE" = "pm2" ]; then
  printf '    sudo -u %s pm2 status\n' "$APP_USER"
  printf '    sudo -u %s pm2 logs %s\n' "$APP_USER" "$APP_NAME"
  printf '    sudo -u %s pm2 restart %s\n' "$APP_USER" "$APP_NAME"
else
  printf '    systemctl status %s\n' "$SERVICE_NAME"
  printf '    journalctl -u %s -f\n' "$SERVICE_NAME"
  printf '    systemctl restart %s\n' "$SERVICE_NAME"
fi
printf '    curl -fsS http://127.0.0.1:%s/api/health\n' "$APP_PORT"
printf '    sudo %s/deploy/backup.sh\n' "$APP_DIR"
printf '\n'

if [ "$PM_MODE" = "pm2" ]; then
  printf '  %sLANGKAH MANUAL TERAKHIR (autostart saat reboot):%s\n' "$C_BOLD" "$C_YELLOW"
  printf '    sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u %s --hp %s\n' "$APP_USER" "$APP_HOME"
  printf '    # PM2 akan mencetak satu perintah "sudo env PATH=..." — jalankan persis itu.\n'
  printf '\n'
fi

printf '%s%s############################################################%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
printf '%s%s#  PERINGATAN KEAMANAN — WAJIB DIBACA                        #%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
printf '%s%s############################################################%s\n' "$C_BOLD" "$C_RED" "$C_RESET"
printf '\n'
printf '  Akun admin masih memakai password demo: %sadmin123%s\n' "$C_BOLD" "$C_RESET"
printf '  (karyawan demo: budi / budi123)\n'
printf '\n'
printf '  %sSEGERA ganti password SEBELUM aplikasi dipakai:%s\n' "$C_BOLD" "$C_RESET"
printf '    1. Buka https://%s/ dan login sebagai admin.\n' "${APP_DOMAIN:-domain-anda}"
printf '    2. Menu Profil -> Ganti Password.\n'
printf '    3. Ganti juga password semua karyawan di menu Karyawan.\n'
printf '\n'
printf '  Seed juga mengisi data contoh (cabang, absensi). Hapus/ubah sesuai kebutuhan.\n'
printf '\n'
printf '  Backup otomatis belum terjadwal. Pasang cron:\n'
printf '    0 2 * * * %s/deploy/backup.sh >> /var/log/absensi-backup.log 2>&1\n' "$APP_DIR"
printf '\n'
