// Admin: work schedule settings.
import { initAdminPage, get, patch, escapeHtml, toast } from '../js/api.js';
import { fmtDate } from '../js/ui.js';

const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

initAdminPage(async () => {
  let holidays = [];
  let workDays = [];

  const data = await get('/api/settings/work');
  document.getElementById('work_start').value = data.work_start;
  document.getElementById('work_end').value = data.work_end;
  document.getElementById('late_tolerance_minutes').value = data.late_tolerance_minutes;
  document.getElementById('checkout_deadline').value = data.checkout_deadline;
  workDays = [...data.work_days];
  holidays = [...data.holidays];

  const daysEl = document.getElementById('days');
  daysEl.innerHTML = DAY_NAMES.map((name, i) => {
    const val = i + 1;
    return `<label class="checkbox-line"><input type="checkbox" value="${val}" ${workDays.includes(val) ? 'checked' : ''} /> ${name}</label>`;
  }).join('');

  function renderHolidays() {
    const el = document.getElementById('holidays');
    if (!holidays.length) { el.innerHTML = '<span class="muted">Tidak ada hari libur</span>'; return; }
    el.innerHTML = holidays.map((h) => `<span class="badge gray">${fmtDate(h)} <a href="#" data-h="${h}">✕</a></span>`).join('');
    el.querySelectorAll('[data-h]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      holidays = holidays.filter((x) => x !== a.dataset.h);
      renderHolidays();
    }));
  }
  renderHolidays();

  document.getElementById('add-holiday').addEventListener('click', () => {
    const v = document.getElementById('holiday-input').value;
    if (!v) { toast('Pilih tanggal', 'warn'); return; }
    if (!holidays.includes(v)) holidays.push(v);
    holidays.sort();
    document.getElementById('holiday-input').value = '';
    renderHolidays();
  });

  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = [...daysEl.querySelectorAll('input:checked')].map((c) => Number(c.value));
    if (!days.length) { toast('Pilih minimal satu hari kerja', 'warn'); return; }
    const payload = {
      work_start: document.getElementById('work_start').value,
      work_end: document.getElementById('work_end').value,
      checkout_deadline: document.getElementById('checkout_deadline').value,
      late_tolerance_minutes: Number(document.getElementById('late_tolerance_minutes').value),
      work_days: days,
      holidays,
    };
    try {
      await patch('/api/settings/work', payload);
      toast('Pengaturan jadwal disimpan', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
});
