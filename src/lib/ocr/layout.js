// Rebuilds bill rows from OCR words and their positions, for crumpled and curved bills.
// On a bent bill each row's numbers sit lower than its name (sometimes by more than a line), so a
// line-by-line read glues numbers to the wrong item. The order never changes though: the n-th name
// row belongs with the n-th number row. Names and numbers are grouped into rows separately, then
// paired in order. Pure functions; unit-tested in tests/layout.test.js.

const cy = (w) => (w.y0 + w.y1) / 2;
const height = (w) => w.y1 - w.y0;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const HEADER_RE = /^(qty|quantity|rate|price|tota[l1\]]?|amount|amt|particulars?|description|items?|s\.?n\.?)$/i;
const SUMMARY_RE = /^(gro?ss?|sub|sub-?total|tota[l1\]]?|disc\w*|invoi\w*|net|grand|vat|tax\w*|service|s\.?c\.?|rupees|round\w*|tender\w*|cash|change|paid|balance)$/i;

/** A number as printed, cleaned of OCR specks: "<.80.00" → "80.00", "250," → "250", "{1" → "1". */
export function cleanNumberToken(t = '') {
  let s = String(t).replace(/[oO](?=[\d.,]*\d)/g, '0').replace(/,(?=\d{2}$)/, '.').replace(/,/g, '');
  s = s.replace(/^[^\d]+/, '').replace(/[^\d.]+$/, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) {
    const m = s.match(/\d+(?:\.\d{1,2})?/);
    return m ? m[0] : '';
  }
  return s;
}

const isNumberWord = (w) => /\d/.test(w.text) && !/[a-z]{2,}/i.test(w.text) && cleanNumberToken(w.text) !== '';
const isNameWord = (w) => /[A-Za-zऀ-ॿ]{2,}/.test(w.text) && w.confidence >= 55;

/** Groups words into rows by vertical position (tolerance: a fraction of the line height). */
function groupRows(words, tol) {
  const rows = [];
  for (const w of [...words].sort((a, b) => cy(a) - cy(b))) {
    const row = rows.find((r) => Math.abs(r.cy - cy(w)) <= tol);
    if (row) {
      row.words.push(w);
      row.cy = row.words.reduce((s, x) => s + cy(x), 0) / row.words.length;
    } else rows.push({ words: [w], cy: cy(w) });
  }
  for (const r of rows) r.words.sort((a, b) => a.x0 - b.x0);
  return rows.sort((a, b) => a.cy - b.cy);
}

/**
 * Item rows from positioned words. `words`: [{ text, confidence, x0, y0, x1, y1 }].
 * @returns text with one line per row ("Coke 2 90.00 180.00"), for the usual parsers.
 */
export function rowsFromWords(words = []) {
  const ws = words
    .map((w) => ({ ...w, text: String(w.text || '').trim() }))
    .filter((w) => w.text && w.x1 > w.x0 && w.y1 > w.y0);
  const letterWords = ws.filter((w) => isNameWord(w) && w.confidence >= 80);
  const h = median(letterWords.map(height)) || median(ws.map(height)) || 20;

  // The item area: below the column header ("Qty Rate Total"), above the first summary word.
  const header = ws.filter((w) => HEADER_RE.test(w.text) && w.confidence >= 60);
  const headerY = header.length >= 2 ? Math.max(...header.map(cy)) : -Infinity;
  const below = ws.filter((w) => cy(w) > headerY + h * 0.5);
  const summary = below.filter((w) => SUMMARY_RE.test(w.text.replace(/[^A-Za-z-]/g, '')) && w.confidence >= 30);
  const summaryY = summary.length ? Math.min(...summary.map((w) => w.y0)) : Infinity;
  const area = below.filter((w) => cy(w) < summaryY - h * 0.2);

  // Names sit left of the number columns.
  const nums = area.filter(isNumberWord);
  const numberLeft = nums.length ? Math.min(...nums.filter((w) => /\.\d{2}$/.test(cleanNumberToken(w.text))).map((w) => w.x0).concat([Infinity])) : Infinity;
  const names = area.filter((w) => isNameWord(w) && w.x1 <= numberLeft + h);

  const nameRows = groupRows(names, h * 0.5)
    .filter((r) => r.words.some((w) => /[A-Za-zऀ-ॿ]{3,}/.test(w.text) && w.confidence >= 70));
  // Number words far left of the number columns are specks in the name area ("{1", "2").
  const columnsLeft = numberLeft === Infinity ? -Infinity : numberLeft - h * 4;
  const numberRows = groupRows(nums.filter((w) => w.x0 >= columnsLeft), h * 0.6)
    .filter((r) => r.words.some((w) => /\d{2,}/.test(cleanNumberToken(w.text))));

  // Pair in order: each number row takes the nearest unused name row above it (or level with it),
  // at most ~2.5 lines up, and never one above an earlier pair.
  const lines = [];
  let lastName = -1;
  for (const nr of numberRows) {
    let pick = -1;
    for (let i = lastName + 1; i < nameRows.length; i++) {
      const dy = nr.cy - nameRows[i].cy;
      if (dy < -h * 0.6) break;
      if (dy <= h * 2.5) pick = i;
    }
    // "250 00": paisa split off by a speck. Joined back when right next to each other.
    const parts = [];
    nr.words.forEach((w, i) => {
      const t = cleanNumberToken(w.text);
      const prev = nr.words[i - 1];
      if (prev && /^\d{1,2}$/.test(t) && /^\d+$/.test(parts.at(-1) || '') && w.x0 - prev.x1 < h * 0.8) {
        parts[parts.length - 1] += `.${t.padEnd(2, '0')}`;
      } else parts.push(t);
    });
    const numberText = parts.join(' ');
    if (pick >= 0) {
      lines.push(`${nameRows[pick].words.map((w) => w.text).join(' ')} ${numberText}`);
      lastName = pick;
    }
  }

  // Everything outside the item area, line by line, so totals, dates and bill numbers are read too.
  const outside = ws.filter((w) => !area.includes(w) && (w.confidence >= 40 || /\d/.test(w.text)));
  const rowsOut = groupRows(outside, h * 0.5);
  const top = rowsOut.filter((r) => r.cy <= headerY + h * 0.5).map((r) => r.words.map((w) => w.text).join(' '));
  const bottom = rowsOut.filter((r) => r.cy > headerY + h * 0.5).map((r) => r.words.map((w) => w.text).join(' '));
  return [...top, ...lines, ...bottom].join('\n');
}
