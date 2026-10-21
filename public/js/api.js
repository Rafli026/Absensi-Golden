// API wrapper, toasts, auth guard, nav rendering.

/** Fetch wrapper. Throws Error(data.error) on non-OK. */
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = {
    method,
    credentials: 'include',
    headers: { ...headers },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Terjadi kesalahan (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });

/** Toast notifications. */
export function toast(msg, type = 'info', timeout = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s';
    setTimeout(() => el.remove(), 260);
  }, timeout);
}

/**
 * Fetch current user, redirect if not authorized.
 * role: 'admin' | 'employee' | undefined (any authenticated)
 */
export async function requireLogin(role) {
  let me;
  try {
    me = await get('/api/auth/me');
  } catch (err) {
    window.location.href = '/index.html';
    throw err;
  }
  const user = me.user;
  if (role && user.role !== role) {
    window.location.href = '/403.html';
    throw new Error('Forbidden');
  }
  return user;
}

export async function logout() {
  try {
    await post('/api/auth/logout');
  } catch {
    /* ignore */
  }
  window.location.href = '/index.html';
}

const NAV_ADMIN = [
  { href: '/admin/dashboard.html', label: 'Dashboard' },
  { href: '/admin/employees.html', label: 'Karyawan' },
  { href: '/admin/qrcodes.html', label: 'QR Code' },
  { href: '/admin/face-register.html', label: 'Daftar Wajah' },
  { href: '/admin/attendance.html', label: 'Absensi' },
  { href: '/admin/settings-work.html', label: 'Jadwal' },
  { href: '/admin/settings-branch.html', label: 'Lokasi' },
  { href: '/admin/export.html', label: 'Export' },
  { href: '/admin/audit.html', label: 'Audit' },
];
const NAV_EMPLOYEE = [
  { href: '/employee/attendance.html', label: 'Absen' },
  { href: '/employee/history.html', label: 'Riwayat' },
  { href: '/profile.html', label: 'Profil' },
];

/* ---------- Theme (dark / light) ---------- */
const THEME_KEY = 'absensi_theme';

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme, persist = false) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Mode terang' : 'Mode gelap';
    btn.setAttribute('aria-label', btn.title);
  }
}

/** Read the saved preference (falling back to the OS setting) and apply it. */
export function initTheme() {
  let theme;
  try { theme = localStorage.getItem(THEME_KEY); } catch { theme = null; }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(theme);
}

/** Switch between light and dark mode. */
export function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
}

// Apply immediately on module load so every page (incl. login) is themed.
initTheme();

/** First letters of up to two words of a name, uppercased. */
export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
}

/* ---------- Topbar menu ---------- */

/** Open/close the hamburger dropdown and keep the button in sync. */
function setNavMenuOpen(open, focusBurger = false) {
  const menu = document.getElementById('nav-menu');
  const burger = document.getElementById('nav-burger');
  if (!menu || !burger) return;
  menu.hidden = !open;
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
  burger.textContent = open ? '✕' : '☰';
  if (focusBurger) burger.focus();
}

// Bound once per page: renderNav re-runs after profile updates, so binding inside it
// would stack duplicate document listeners.
let navGlobalBound = false;
function bindNavGlobalHandlers() {
  if (navGlobalBound) return;
  navGlobalBound = true;
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('nav-menu');
    if (!menu || menu.hidden) return;
    if (e.target.closest('#nav-menu') || e.target.closest('#nav-burger')) return;
    setNavMenuOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const menu = document.getElementById('nav-menu');
    if (!menu || menu.hidden) return;
    setNavMenuOpen(false, true);
  });
}

/** Render the top navigation bar into a <header class="topbar">. */
export function renderNav(user) {
  const el = document.getElementById('topbar');
  if (!el) return;
  const items = user.role === 'admin' ? NAV_ADMIN : NAV_EMPLOYEE;
  const here = window.location.pathname;
  const links = items
    .map((i) => {
      const active = here === i.href;
      return `<a href="${i.href}"${active ? ' class="active" aria-current="page"' : ''}>${i.label}</a>`;
    })
    .join('');
  el.innerHTML = `
    <span class="brand" style="display:flex;align-items:center;gap:0.5rem">
      <img src="/img/logo.png" alt="New Golden Bakery & Cakes" class="brand-logo-sm" />
      <span>New Golden Bakery</span>
    </span>
    <span class="user">
      <a class="nav-user-link" href="/profile.html" title="Profil saya">
        ${avatarHtml(user)}
        <span>${escapeHtml(user.full_name)} (${user.role === 'admin' ? 'Admin' : 'Karyawan'})</span>
      </a>
      <button class="sm theme-toggle" id="theme-toggle" title="Ganti tema">🌙</button>
      <button class="sm nav-burger" id="nav-burger" aria-label="Buka menu" aria-expanded="false" aria-controls="nav-menu">☰</button>
    </span>
    <div class="nav-menu" id="nav-menu" hidden>
      ${links}
      <div class="nav-menu-sep"></div>
      <a href="/profile.html">Profil Saya</a>
      <button type="button" id="menu-logout">Keluar</button>
    </div>`;
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
    themeBtn.title = currentTheme() === 'dark' ? 'Mode terang' : 'Mode gelap';
    themeBtn.setAttribute('aria-label', themeBtn.title);
    themeBtn.addEventListener('click', toggleTheme);
  }
  document.getElementById('nav-burger')?.addEventListener('click', () => {
    const menu = document.getElementById('nav-menu');
    setNavMenuOpen(menu ? menu.hidden : false);
  });
  document.getElementById('menu-logout')?.addEventListener('click', () => logout());
  bindNavGlobalHandlers();
}

/** Avatar markup: profile photo when available, otherwise initials. */
function avatarHtml(user) {
  if (user && user.photo) {
    return `<img class="nav-avatar" src="${escapeHtml(user.photo)}" alt="" />`;
  }
  return `<span class="nav-avatar nav-avatar-initials">${escapeHtml(initials(user && user.full_name))}</span>`;
}

/** Escape HTML for safe insertion. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Bootstrap an admin page: guard, nav, then run. */
export async function initAdminPage(fn) {
  try {
    const user = await requireLogin('admin');
    renderNav(user);
    await fn(user);
  } catch (err) {
    if (err && err.status) toast(err.message, 'err');
  }
}

/** Bootstrap an employee (or any auth) page. */
export async function initAuthPage(fn, role) {
  try {
    const user = await requireLogin(role);
    renderNav(user);
    await fn(user);
  } catch (err) {
    if (err && err.status) toast(err.message, 'err');
  }
}
