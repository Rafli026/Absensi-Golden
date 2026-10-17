// RFC-4180 CSV serialization.

/**
 * Serialize rows to CSV.
 * rows: array of objects
 * columns: array of { key, header }
 * Returns CSV string with UTF-8 BOM prefix.
 */
export function toCsv(rows, columns) {
  const esc = (val) => {
    if (val === undefined || val === null) return '';
    const s = String(val);
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = columns.map((c) => esc(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => esc(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')
  );
  return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n';
}
