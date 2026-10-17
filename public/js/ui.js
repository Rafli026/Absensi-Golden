// UI helpers: clock, formatting, loading, geolocation.

/** Start a live Jakarta clock in el (with date in dateEl if provided). */
export function startClock(el, dateEl) {
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const dateFmt = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  const tick = () => {
    const now = new Date();
    if (el) el.textContent = timeFmt.format(now);
    if (dateEl) dateEl.textContent = dateFmt.format(now);
  };
  tick();
  return setInterval(tick, 1000);
}

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY' */
export function fmtDate(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = String(dateKey).split('-');
  if (!y || !m || !d) return String(dateKey);
  return `${d}-${m}-${y}`;
}

/** 'HH:mm:ss' -> 'HH:mm' */
export function fmtTime(t) {
  return t ? String(t).slice(0, 5) : '';
}

/** Format a number as Indonesian rupiah, e.g. 25000 -> "Rp25.000". */
export function fmtRupiah(n) {
  const num = Number(n) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

/** Format a 'YYYY-MM' period to 'Oktober 2026'. */
export function fmtPeriod(period) {
  if (!period) return '';
  const [y, m] = String(period).split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return String(period);
  const names = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${names[m - 1]} ${y}`;
}

/** Toggle a global loading overlay. */
export function loading(on) {
  let el = document.getElementById('global-loading');
  if (on) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-loading';
      el.className = 'loading-overlay';
      el.innerHTML = '<span class="spinner dark"></span>';
      document.body.appendChild(el);
    }
  } else if (el) {
    el.remove();
  }
}

/** Get the current position, or null if unavailable/denied. */
export function getPosition({ timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}

/** Status badge class from attendance status. */
export function statusBadge(status) {
  const map = { Hadir: 'ok', Terlambat: 'warn', Pulang: 'info', Izin: 'gray' };
  return `<span class="badge ${map[status] || 'gray'}">${status}</span>`;
}

/** Simple confirmation modal. Returns a promise<boolean>. */
export function confirmDialog(message) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h3>Konfirmasi</h3></div>
        <p>${escapeText(message)}</p>
        <div class="modal-actions">
          <button class="secondary" data-no>Batal</button>
          <button class="danger" data-yes>Ya, lanjutkan</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-yes]').onclick = () => { backdrop.remove(); resolve(true); };
    backdrop.querySelector('[data-no]').onclick = () => { backdrop.remove(); resolve(false); };
  });
}

function escapeText(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
