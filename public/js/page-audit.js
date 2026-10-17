// Admin: audit logs.
import { initAdminPage, get, escapeHtml, toast } from '../js/api.js';

initAdminPage(async () => {
  const limit = 50;
  let offset = 0;
  let total = 0;

  async function load() {
    const data = await get(`/api/audit-logs?limit=${limit}&offset=${offset}`);
    total = data.total;
    const tbody = document.getElementById('rows');
    if (!data.logs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">Tidak ada log</td></tr>';
    } else {
      tbody.innerHTML = data.logs.map((l) => `
        <tr>
          <td>${escapeHtml(new Date(l.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }))}</td>
          <td>${escapeHtml(l.actor_name || '-')}</td>
          <td><span class="badge info">${escapeHtml(l.action)}</span></td>
          <td>${escapeHtml(l.entity || '-')}</td>
          <td>${escapeHtml(l.entity_id || '-')}</td>
          <td class="wrap">${escapeHtml(l.detail || '-')}</td>
          <td>${escapeHtml(l.ip || '-')}</td>
        </tr>`).join('');
    }
    document.getElementById('total-info').textContent = `Menampilkan ${offset + 1}-${Math.min(offset + limit, total)} dari ${total}`;
    document.getElementById('prev').disabled = offset === 0;
    document.getElementById('next').disabled = offset + limit >= total;
  }

  document.getElementById('prev').addEventListener('click', () => { offset = Math.max(0, offset - limit); load(); });
  document.getElementById('next').addEventListener('click', () => { offset += limit; load(); });
  document.getElementById('refresh').addEventListener('click', () => load());
  await load();
});
