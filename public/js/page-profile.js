// Profile page: account info, photo upload (compressed client-side), password.
import { initAuthPage, get, patch, toast, renderNav } from './api.js';
import { loading, confirmDialog } from './ui.js';

const AVATAR_SIZE = 400; // exported square size
const JPEG_QUALITY = 0.85;

/** First letters of each word, max 2, uppercase. */
function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
}

/** Load an object URL into an Image element. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak dapat dibaca'));
    img.src = src;
  });
}

/** Center-crop the image to 1:1 and downscale to size×size, return JPEG data URL. */
function compressPhoto(img, size = AVATAR_SIZE, quality = JPEG_QUALITY) {
  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!side) throw new Error('Ukuran gambar tidak valid');
  const sx = ((img.naturalWidth || img.width) - side) / 2;
  const sy = ((img.naturalHeight || img.height) - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak didukung browser ini');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // White backdrop so transparent PNGs don't turn black in JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  return canvas.toDataURL('image/jpeg', quality);
}

/** Largest data URL the API accepts. */
const MAX_PHOTO_LENGTH = 900_000;

initAuthPage(async (user) => {
  const imgEl = document.getElementById('avatar-preview');
  const fallbackEl = document.getElementById('avatar-fallback');
  const removeBtn = document.getElementById('remove-photo');
  const pickBtn = document.getElementById('pick-photo');
  const fileInput = document.getElementById('photo-input');
  const profileForm = document.getElementById('profile-form');
  const saveBtn = document.getElementById('save-profile');
  const fullNameEl = document.getElementById('full_name');

  /** Show either the photo or the initials fallback. */
  function renderAvatar(photo) {
    const hasPhoto = Boolean(photo);
    if (hasPhoto) {
      imgEl.src = photo;
      imgEl.alt = 'Foto profil ' + (user.full_name || '');
      imgEl.hidden = false;
      fallbackEl.hidden = true;
    } else {
      imgEl.removeAttribute('src');
      imgEl.alt = '';
      imgEl.hidden = true;
      fallbackEl.hidden = false;
    }
    fallbackEl.textContent = initials(user.full_name);
    removeBtn.hidden = !hasPhoto;
  }

  // --- A. Populate account data ---
  fullNameEl.value = user.full_name || '';
  document.getElementById('username').value = user.username || '';
  document.getElementById('role').value = user.role === 'admin' ? 'Admin' : 'Karyawan';
  renderAvatar(user.photo);

  // --- B. Photo upload + compression ---
  pickBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('File harus berupa gambar', 'err');
      return;
    }

    const previousPhoto = user.photo || null;
    let objectUrl = null;
    loading(true);
    pickBtn.disabled = true;
    try {
      objectUrl = URL.createObjectURL(file);
      const img = await loadImage(objectUrl);
      let dataUrl = compressPhoto(img);
      // Safety net: retry smaller if the payload would exceed the API limit.
      if (dataUrl.length > MAX_PHOTO_LENGTH) {
        dataUrl = compressPhoto(img, 320, 0.75);
      }
      if (dataUrl.length > MAX_PHOTO_LENGTH) {
        renderAvatar(previousPhoto);
        toast('Foto terlalu besar, coba gambar lain', 'err');
        return;
      }

      // Immediate preview, before the server round-trip.
      renderAvatar(dataUrl);
      const data = await patch('/api/auth/profile', { photo: dataUrl });
      user.photo = (data && data.user && data.user.photo) || dataUrl;
      renderAvatar(user.photo);
      renderNav(user);
      toast('Foto profil diperbarui', 'ok');
    } catch (err) {
      // Revert preview to the last known good photo.
      renderAvatar(previousPhoto);
      toast((err && err.message) || 'Gagal memperbarui foto', 'err');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      pickBtn.disabled = false;
      loading(false);
    }
  });

  // --- C. Remove photo ---
  removeBtn.addEventListener('click', async () => {
    const ok = await confirmDialog('Hapus foto profil?');
    if (!ok) return;
    loading(true);
    removeBtn.disabled = true;
    try {
      const data = await patch('/api/auth/profile', { photo: null });
      user.photo = (data && data.user && data.user.photo) || null;
      renderAvatar(user.photo);
      renderNav(user);
      toast('Foto profil dihapus', 'ok');
    } catch (err) {
      toast((err && err.message) || 'Gagal menghapus foto', 'err');
    } finally {
      removeBtn.disabled = false;
      loading(false);
    }
  });

  // --- D. Save full name ---
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = fullNameEl.value.trim();
    if (!fullName) {
      toast('Nama lengkap wajib diisi', 'warn');
      fullNameEl.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const data = await patch('/api/auth/profile', { full_name: fullName });
      if (data && data.user) {
        user.full_name = data.user.full_name;
        user.photo = data.user.photo;
        fullNameEl.value = data.user.full_name;
      } else {
        user.full_name = fullName;
      }
      renderAvatar(user.photo);
      renderNav(user); // update name/avatar in the navbar without reload
      toast('Profil berhasil diperbarui', 'ok');
    } catch (err) {
      toast((err && err.message) || 'Gagal menyimpan profil', 'err');
    } finally {
      saveBtn.disabled = false;
    }
  });

  // --- E. Change password ---
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
    });
  });

  const pwForm = document.getElementById('pw-form');
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPw = document.getElementById('old_password').value;
    const newPw = document.getElementById('new_password').value;
    const conf = document.getElementById('confirm_password').value;
    if (newPw !== conf) {
      toast('Konfirmasi password tidak cocok', 'warn');
      return;
    }
    if (newPw.length < 6) {
      toast('Password baru minimal 6 karakter', 'warn');
      return;
    }
    const submitBtn = pwForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await patch('/api/auth/password', { old_password: oldPw, new_password: newPw });
      pwForm.reset();
      pwForm.querySelectorAll('input[type="text"]').forEach((i) => { i.type = 'password'; });
      pwForm.querySelectorAll('[data-toggle-password]').forEach((b) => {
        b.textContent = '👁';
        b.setAttribute('aria-label', 'Tampilkan password');
      });
      toast('Password berhasil diubah', 'ok');
    } catch (err) {
      toast((err && err.message) || 'Gagal mengubah password', 'err');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // --- F. Face recognition status ---
  try {
    const s = await get('/api/face/status');
    const el = document.getElementById('face-status');
    if (!user.employee_id) {
      el.innerHTML = user.role === 'admin'
        ? '<span class="badge gray">Tidak tersedia</span> Akun admin tidak memakai absensi wajah.'
        : '<span class="badge gray">Belum terhubung</span> Akun ini belum terhubung ke data karyawan.';
    } else if (s && s.registered) {
      el.innerHTML = '<span class="badge ok">Wajah sudah terdaftar</span> Anda dapat absen dengan Face Recognition.';
    } else {
      el.innerHTML = '<span class="badge gray">Wajah belum terdaftar</span> Hubungi admin untuk mendaftarkan wajah Anda.';
    }
  } catch {
    document.getElementById('face-status').textContent = 'Informasi wajah tidak tersedia.';
  }
});
