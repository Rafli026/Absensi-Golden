// Login page.
import { post, toast } from './api.js';

const form = document.getElementById('login-form');
const btn = document.getElementById('login-btn');

// If already logged in, redirect by role.
(async () => {
  try {
    const me = await fetch('/api/auth/me', { credentials: 'include' });
    if (me.ok) {
      const data = await me.json();
      redirect(data.user.role);
    }
  } catch { /* ignore */ }
})();

function redirect(role) {
  window.location.href = role === 'admin' ? '/admin/dashboard.html' : '/employee/attendance.html';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  if (!username || !password) {
    toast('Isi username dan password', 'warn');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Memproses...';
  try {
    const data = await post('/api/auth/login', { username, password });
    toast(`Selamat datang, ${data.user.full_name}`, 'ok');
    redirect(data.user.role);
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false;
    btn.textContent = 'Masuk';
  }
});
