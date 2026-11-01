// Spreadsheet statements (.xlsx, .xls, .ods, and the HTML tables some banks save as .xls) →
// rows of cell text for parseStatementTable. Takes the SheetJS module as an argument so the
// browser can load it only when needed and the tests can pass it in directly.
import { parseStatementTable } from './statement.js';

const pad = (n) => String(n).padStart(2, '0');

/** The text of one cell. Dates become "YYYY-MM-DD HH:MM" so the day/month order is never guessed. */
function cellText(XLSX, cell) {
  if (!cell) return '';
  if (cell.t === 'd' && cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    const d = cell.v;
    const time = d.getHours() || d.getMinutes() ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${time}`;
  }
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const p = XLSX.SSF.parse_date_code(cell.v);
    if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)}${p.H || p.M ? ` ${pad(p.H)}:${pad(p.M)}` : ''}`;
  }
  // Numbers: the text as shown ("1,090.21"), or the value rounded to paisa.
  if (cell.t === 'n') return cell.w != null ? String(cell.w) : String(Math.round(cell.v * 100) / 100);
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.w ?? cell.v ?? '');
}

/** Every sheet as rows of cell text. */
export function sheetTables(XLSX, data) {
  let wb;
  try {
    wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, cellText: true });
  } catch (err) {
    if (/password|encrypt/i.test(err?.message || '')) {
      throw new Error('This spreadsheet is locked with a password. Open it, save a copy without the password (or as CSV), and add that.');
    }
    throw new Error(`Could not open the spreadsheet (${err?.message || 'unknown error'}).`);
  }
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws?.['!ref']) return [];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) row.push(cellText(XLSX, ws[XLSX.utils.encode_cell({ r, c })]).trim());
      rows.push(row);
    }
    return rows;
  });
}

/** The statement in a spreadsheet: the sheet that gives the most transactions. */
export function parseStatementSheet(XLSX, data) {
  const results = sheetTables(XLSX, data).map((t) => parseStatementTable(t, 'spreadsheet'));
  if (!results.length) return parseStatementTable([], 'spreadsheet');
  return results.reduce((best, r) => (r.rows.length > best.rows.length ? r : best));
}
