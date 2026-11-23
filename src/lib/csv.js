// Minimal RFC 4180 CSV parse/stringify (quoted fields, escaped quotes, CRLF or LF).

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (!nonEmpty.length) return [];
  const [header, ...body] = nonEmpty;
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, idx) => [k, (r[idx] ?? '').trim()])));
}

const quote = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function stringifyCsv(columns, records) {
  const lines = [columns.join(',')];
  for (const r of records) lines.push(columns.map((c) => quote(r[c])).join(','));
  return lines.join('\n') + '\n';
}
