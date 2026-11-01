// Bank statement → ledger rows. Works on positioned words (from a PDF's text layer, or OCR of a
// scanned page) and on CSV rows. Banks lay statements out differently, so nothing here is tied to
// one bank: the column header ("Date … Particulars … Withdrawal … Deposit … Balance") says where
// each column is, and the running balance double-checks every row (prev − debit + credit = balance),
// which also fixes a debit read as a credit. Pure functions; unit-tested in tests/statement.test.js.
import { bsToAd, isValidAD, isValidBS, toAsciiDigits, ymd } from '../nepaliDate.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const round2 = (n) => Math.round(n * 100) / 100;
const close = (a, b) => Math.abs(a - b) < 0.005;

/* ---------- amounts ---------- */

/** "1,23,456.78" → 123456.78; "(250.00)" and "-250" → −250; "500.00 Dr" → { value: 500, side: 'dr' }. "-" → null. */
export function parseAmount(raw) {
  let t = toAsciiDigits(String(raw ?? '')).trim();
  if (!t || /^[-–—.]+$/.test(t)) return null;
  let neg = false;
  let side = '';
  const sm = /\s*\b(cr|dr)\.?$/i.exec(t);
  if (sm) { side = sm[1].toLowerCase(); t = t.slice(0, sm.index).trim(); }
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  t = t.replace(/^(npr|rs\.?|रु\.?|रू\.?)\s*/i, '');
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  else if (t.endsWith('-')) { neg = true; t = t.slice(0, -1); }
  if (!/^(\d{1,3}(,\d{2,3})+|\d+)(\.\d{1,2})?$/.test(t)) return null;
  const v = Number(t.replace(/,/g, ''));
  return Number.isFinite(v) ? { value: neg ? -v : v, side } : null;
}

/** Looks like a statement amount: two decimals, optional grouping, sign or Dr/Cr. */
export const isAmountToken = (t) => /^\(?-?(\d{1,3}(,\d{2,3})+|\d+)\.\d{2}\)?-?(\s*(cr|dr)\.?)?$/i.test(toAsciiDigits(String(t).trim()));

/* ---------- dates ---------- */

const bsYear = (y) => y >= 2060 && y <= 2100;

function toAd(y, m, d) {
  if (bsYear(y)) {
    const bs = ymd(y, m, d);
    return isValidBS(bs) ? { ad: bsToAd(bs), bs } : null;
  }
  const ad = ymd(y, m, d);
  return isValidAD(ad) ? { ad } : null;
}

const fullYear = (y) => {
  const n = Number(y);
  if (y.length === 4) return n;
  return n >= 60 ? 2000 + n : 2000 + n; // two digits: 26 → 2026, 83 → 2083 (BS)
};

/**
 * A date at the start of `str`. Day-first unless `order` says 'mdy' (or the numbers say so).
 * @returns {{ ad: string, bs?: string, time: string, length: number } | null}
 */
export function parseDate(str, order = 'dmy') {
  const s = toAsciiDigits(String(str ?? '')).trim();
  let m;
  let out = null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s))) {
    out = toAd(Number(m[1]), Number(m[2]), Number(m[3]));
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(m[3]);
    const dmy = a > 12 ? true : b > 12 ? false : order !== 'mdy';
    out = dmy ? toAd(y, b, a) : toAd(y, a, b);
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[-\s/.]?([A-Za-z]{3,9})\.?[-\s/.,]*(\d{4}|\d{2})(?![\d:])/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, m[2].length === 4 ? 4 : 3)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mon) out = toAd(fullYear(m[3]), mon, Number(m[1]));
  } else if ((m = /^([A-Za-z]{3,9})\.?[-\s]+(\d{1,2})(?:st|nd|rd|th)?,?[-\s]+(\d{4})(?!\d)/.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon) out = toAd(Number(m[3]), mon, Number(m[2]));
  }
  if (!out || !m) return null;
  let length = m[0].length;
  let time = '';
  const tm = /^[\s,|T-]*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]\.?m\.?)?/i.exec(s.slice(length));
  if (tm) {
    let hh = Number(tm[1]);
    const ap = (tm[4] || '').toLowerCase()[0];
    if (ap === 'p' && hh < 12) hh += 12;
    if (ap === 'a' && hh === 12) hh = 0;
    if (hh < 24 && Number(tm[2]) < 60) {
      time = `${String(hh).padStart(2, '0')}:${tm[2]}`;
      length += tm[0].length;
    }
  }
  return { ...out, time, length };
}

/** 'dmy' or 'mdy', decided by every numeric date in the statement (Nepal uses day first). */
export function detectDateOrder(strings) {
  let dmy = 0;
  let mdy = 0;
  for (const s of strings) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(toAsciiDigits(String(s).trim()));
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

/** A time anywhere in the text: "14:32", "02:32 PM" → "14:32". */
export function findTime(text = '') {
  const m = /(?:^|[^\d:])(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?(?![\d:])/i.exec(text);
  if (!m) return '';
  let hh = Number(m[1]);
  const ap = (m[3] || '').toLowerCase()[0];
  if (ap === 'p' && hh < 12) hh += 12;
  if (ap === 'a' && hh === 12) hh = 0;
  return hh < 24 && Number(m[2]) < 60 ? `${String(hh).padStart(2, '0')}:${m[2]}` : '';
}

/** Reference-like codes in a description: 6+ characters with 5+ digits ("FP123456789", "0ABC12345"). */
export function findRefs(text = '') {
  const out = new Set();
  for (const t of toAsciiDigits(text).toUpperCase().split(/[^A-Z0-9]+/)) {
    if (t.length >= 6 && (t.match(/\d/g) || []).length >= 5 && !/^20\d{6}$/.test(t)) out.add(t);
  }
  return [...out];
}

/* ---------- column header ---------- */

/** What a header cell names, or '' for none. Order matters: "Debit Amount" is a debit, "Value Date" isn't the date. */
export function classifyHeader(text) {
  const t = String(text).toLowerCase().replace(/[^a-z/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/^(dr\s*\/\s*cr|cr\s*\/\s*dr|d\s*\/\s*c|c\s*\/\s*d|type|txn type|tran type)$/.test(t)) return 'drcr';
  // Wallet exports (eSewa, Khalti…) add these; they are not part of the description.
  if (/^(status|txn status|transaction status|state)$/.test(t)) return 'status';
  if (/^(channel|mode|txn mode|tran mode|branch|user|initiated by|service)$/.test(t)) return 'skip';
  // Cut-off headers count too (a narrow column in a screenshot shows "Balanc", "Descrip").
  if (/balanc/.test(t)) return 'balance';
  if (/withdraw|debit|^dr$|paid out|money out|^out$/.test(t)) return 'debit';
  if (/deposit|credit|^cr$|paid in|money in|^in$/.test(t)) return 'credit';
  if (/value date|val date/.test(t)) return 'valueDate';
  if (/date/.test(t)) return 'date';
  if (/^time$/.test(t)) return 'time';
  if (/particul|descrip|narrat|remark|detail|transaction$|^details?$/.test(t)) return 'desc';
  if (/cheque|chq|^ref|reference|instrument|tran id|txn id|transaction id|voucher/.test(t)) return 'ref';
  if (/amount|^amt$/.test(t)) return 'amount';
  if (/^(s ?n|sn|sr|sl|s no|sr no|sl no|serial)$/.test(t)) return 'sn';
  return '';
}

const NUMERIC = new Set(['debit', 'credit', 'balance', 'amount']);

/* ---------- geometry: words → lines ---------- */

/** Splits multi-word text items into words, sharing the item's width by character count. */
function toWords(tokens) {
  const out = [];
  for (const t of tokens) {
    const text = String(t.text ?? t.str ?? '');
    if (!text.trim() || !(t.x1 > t.x0) || !(t.y1 > t.y0)) continue;
    const per = (t.x1 - t.x0) / Math.max(1, text.length);
    // Two+ spaces inside one item usually separate columns; keep single-spaced runs as words too.
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      // OCR reads a table's grid lines as "|": drop them.
      const word = m[0].replace(/^[|¦]+|[|¦]+$/g, '');
      if (word) out.push({ text: word, x0: t.x0 + m.index * per, x1: t.x0 + (m.index + m[0].length) * per, y0: t.y0, y1: t.y1 });
    }
  }
  return out;
}

/**
 * Words into lines, left to right: each word joins the line whose last word is level with it.
 * Following the line word by word copes with a slightly tilted scan, where the balance at the far
 * right sits half a line lower than the date at the far left.
 */
function groupLines(words, h) {
  const lines = [];
  for (const w of [...words].sort((a, b) => a.x0 - b.x0)) {
    const cy = (w.y0 + w.y1) / 2;
    let best = null;
    for (const l of lines) {
      const d = Math.abs(l.tail - cy);
      // Across a wide gap a tilt adds up: allow about 1°, but never a whole line.
      const tol = h * 0.45 + Math.min(h * 0.6, Math.max(0, w.x0 - l.right) * 0.02);
      if (d <= tol && l.right <= w.x0 + h && (!best || d < Math.abs(best.tail - cy))) best = l;
    }
    if (best) {
      best.words.push(w);
      best.tail = cy;
      best.right = Math.max(best.right, w.x1);
    } else lines.push({ words: [w], tail: cy, right: w.x1 });
  }
  for (const l of lines) {
    l.cy = l.words.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / l.words.length;
    l.text = l.words.map((w) => w.text).join(' ');
  }
  return lines.sort((a, b) => a.cy - b.cy);
}

/** One header line's words into cells: words closer than about half a line height are one cell. */
function lineCells(words, h) {
  const cells = [];
  for (const w of [...words].sort((a, b) => a.x0 - b.x0)) {
    const c = cells.find((x) => w.x0 <= x.x1 + h * 0.6 && w.x1 >= x.x0 - h * 0.6);
    if (c) {
      c.words.push(w);
      c.x0 = Math.min(c.x0, w.x0);
      c.x1 = Math.max(c.x1, w.x1);
    } else cells.push({ words: [w], x0: w.x0, x1: w.x1 });
  }
  for (const c of cells) {
    c.text = c.words.map((w) => w.text).join(' ');
    c.kind = classifyHeader(c.text);
  }
  return cells.flatMap((c) => splitHeaderCell(c, h));
}

/**
 * Header cells from one line, or two stacked lines ("Reference" over "Code", "Balance" over "(NPR)").
 * Each line is split into cells first, then a lower cell joins the upper cell it sits under.
 */
function headerCells(lineWords, h) {
  const [top, ...rest] = lineWords.map((ws) => lineCells(ws, h));
  const cells = top.map((c) => ({ ...c, words: [...c.words] }));
  for (const lower of rest.flat()) {
    let best = null;
    let bestOverlap = 0;
    for (const c of cells) {
      const overlap = Math.min(c.x1, lower.x1) - Math.max(c.x0, lower.x0);
      if (overlap > bestOverlap) { best = c; bestOverlap = overlap; }
    }
    if (best) {
      best.words.push(...lower.words);
      best.x0 = Math.min(best.x0, lower.x0);
      best.x1 = Math.max(best.x1, lower.x1);
    } else cells.push({ ...lower, words: [...lower.words] });
  }
  for (const c of cells) {
    c.words.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
    c.text = c.words.map((w) => w.text).join(' ');
    c.kind = classifyHeader(c.text);
  }
  return cells.sort((a, b) => a.x0 - b.x0);
}

// Words that end a column name rather than start one: "Debit Amount", "Cheque No", "Value Date".
const SUFFIX_WORD = /^(amount|amt|no\.?|number|#|id|date|time|\(npr\)|npr|rs\.?|details?|code)$/i;

/**
 * Narrow column gaps get merged into one text item ("Value Date Particulars"). Split a one-line
 * cell into the most column names it holds, never starting a name with a suffix word.
 */
function splitHeaderCell(cell, h) {
  const ws = cell.words;
  const oneLine = ws.every((w) => Math.abs(w.y0 - ws[0].y0) < h * 0.5);
  if (ws.length < 2 || !oneLine) return [cell];
  const best = [{ score: 0, cuts: [] }];
  for (let i = 1; i <= ws.length; i++) {
    for (let j = 0; j < i; j++) {
      if (!best[j] || (j > 0 && SUFFIX_WORD.test(ws[j].text))) continue;
      const kind = classifyHeader(ws.slice(j, i).map((w) => w.text).join(' '));
      const score = best[j].score + (kind ? 1 : j === 0 && i === ws.length ? 0 : -1);
      const cand = { score, cuts: [...best[j].cuts, [j, i]] };
      if (!best[i] || score > best[i].score || (score === best[i].score && cand.cuts.length < best[i].cuts.length)) best[i] = cand;
    }
  }
  const pick = best[ws.length];
  if (!pick || pick.cuts.length < 2) return [cell];
  return pick.cuts.map(([j, i]) => {
    const part = ws.slice(j, i);
    const text = part.map((w) => w.text).join(' ');
    return { words: part, x0: part[0].x0, x1: part.at(-1).x1, text, kind: classifyHeader(text) };
  });
}

const validHeader = (cells) => {
  const kinds = new Set(cells.map((c) => c.kind).filter(Boolean));
  const hasMoney = kinds.has('debit') || kinds.has('credit') || kinds.has('amount');
  return kinds.has('date') && hasMoney && kinds.size >= 3;
};

/** The column header on a page: one line, or two stacked lines ("Withdrawal" over "Amount"). */
function findHeader(lines, h) {
  for (let i = 0; i < lines.length; i++) {
    const one = headerCells([lines[i].words], h);
    const next = lines[i + 1];
    if (next && next.cy - lines[i].cy < h * 1.9 && !/\d/.test(next.text)) {
      const two = headerCells([lines[i].words, next.words], h);
      const named = (cells) => cells.filter((c) => c.kind).length;
      if (validHeader(two) && (!validHeader(one) || named(two) > named(one))) {
        return { cells: two, index: i + 1 };
      }
    }
    if (validHeader(one)) return { cells: one, index: i };
  }
  return null;
}

/**
 * Column x-ranges from header cells. Text is left-aligned under its header, so a column runs from
 * just before its header to just before the next one.
 */
function columnsFrom(cells, h) {
  return cells.map((c, i) => ({
    kind: c.kind || 'other',
    label: c.text,
    x0: i === 0 ? -Infinity : c.x0 - h * 0.5,
    x1: i === cells.length - 1 ? Infinity : cells[i + 1].x0 - h * 0.5,
    cx: (c.x0 + c.x1) / 2,
  }));
}

/**
 * Each word goes to the column it falls in. Amounts are placed by their right edge, which stays
 * inside the column whether the amount is right-aligned, centred or left-aligned, and however
 * wide it is; text is placed by its centre.
 */
function assignCells(line, columns) {
  const cells = {};
  for (const w of line.words) {
    const x = isAmountToken(w.text) ? w.x1 : (w.x0 + w.x1) / 2;
    let kind = (columns.find((c) => x >= c.x0 && x < c.x1) || columns.at(-1)).kind;
    // A long narration spills into the columns beside it: words there are still narration.
    if ((NUMERIC.has(kind) && /[a-z]{2,}/i.test(w.text) && !/^(cr|dr)\.?$/i.test(w.text))
      || (kind === 'ref' && !/\d/.test(w.text)) || kind === 'sn' && /[a-z]{2,}/i.test(w.text)) kind = 'desc';
    (cells[kind] ||= []).push(w.text);
  }
  return Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.join(' ')]));
}

/* ---------- lines → transactions ---------- */

const OPENING_RE = /\b(opening\s*balance|balance\s*b\s*\/?\s*f|brought\s*forward|previous\s*balance|beginning\s*balance)\b/i;
const CLOSING_RE = /\b(closing\s*balance|balance\s*c\s*\/?\s*f|carried\s*forward|ending\s*balance)\b/i;
const SUMMARY_RE = /^(sub\s*)?(grand\s*)?totals?\b|^total\s+(debit|credit|withdrawal|deposit)|\bpage\s*\d+\s*(of|\/)\s*\d+\b|^(statement|account)\s+(summary|statement)/i;

/**
 * Rows from lines that already know their columns: [{ cells: { date, desc, debit, … }, text, y }].
 * Lines with a date start a transaction; lines without one continue its description.
 */
function assemble(lines, { order, h = 1 }) {
  const rows = [];
  let opening = null;
  let closing = null;
  let cur = null;
  let lastY = -Infinity;
  let notDone = 0;
  let unreadable = 0;
  for (const line of lines) {
    const { cells, text } = line;
    const dateText = cells.date || '';
    let date = parseDate(dateText, order);
    let before = '';
    if (!date && dateText) {
      // "1ABCD12 2026-11-01": a reference squeezed into the date column ahead of the date.
      const m = /\s(?=\S)/g;
      let hit;
      while (!date && (hit = m.exec(dateText))) {
        const d = parseDate(dateText.slice(hit.index + 1), order);
        if (d) { date = { ...d, length: d.length + hit.index + 1 }; before = dateText.slice(0, hit.index).trim(); }
      }
    }
    if (!date && !cells.date && cells.valueDate) date = parseDate(cells.valueDate, order);
    // A "Date Time" column read as two: the date sits under "Time".
    if (!date && !cells.date && cells.time) date = parseDate(cells.time, order);
    const descText = [cells.desc, cells.other].filter(Boolean).join(' ').trim();
    const nums = {};
    for (const k of ['debit', 'credit', 'balance', 'amount']) {
      if (!cells[k]) continue;
      const parts = cells[k].split(/\s+(?=[(\-]?\d)/).map(parseAmount).filter(Boolean);
      if (parts.length) nums[k] = parts.at(-1);
    }
    if (OPENING_RE.test(text) && !nums.debit && !nums.credit && !nums.amount) {
      if (nums.balance) opening = nums.balance.value;
      cur = null;
      continue;
    }
    if (CLOSING_RE.test(text)) {
      if (nums.balance) closing = nums.balance.value;
      cur = null;
      continue;
    }
    if (SUMMARY_RE.test(text.trim()) || SUMMARY_RE.test(descText)) { cur = null; continue; }

    // Failed, cancelled or pending payments never moved money: leave them out.
    if (date && /\b(fail\w*|cancel+ed|rejected|declined|time\s*out|timed\s*out|pending|unsuccessful)\b/i.test(cells.status || '')) {
      notDone++;
      cur = null;
      continue;
    }
    if (date) {
      let time = date.time || '';
      if (!time && cells.time) time = findTime(cells.time);
      const restOfDate = dateText.slice(date.length).trim();
      const desc = [restOfDate && !/^[\d:\s.apm]+$/i.test(restOfDate) ? restOfDate : '', descText].filter(Boolean).join(' ');
      if (!time) time = findTime(desc);
      const codeBefore = /^[A-Za-z0-9\-/]+$/.test(before) && /\d/.test(before);
      cur = {
        date: date.ad,
        time,
        description: codeBefore || !before ? desc : `${before} ${desc}`.trim(),
        ref: [cells.ref, codeBefore ? before : ''].filter(Boolean).join(' '),
        nums,
        drcr: cells.drcr || '',
      };
      rows.push(cur);
      lastY = line.y;
    } else if (cur && (nums.debit || nums.credit || nums.amount) && nums.balance && (cur.nums.debit || cur.nums.credit || cur.nums.amount)) {
      // Its own amount and balance but no readable date (cut off or misread): a transaction we
      // can't place. Say so rather than guess the date.
      unreadable++;
      cur = null;
    } else if (cur && line.y - lastY <= h * 2.6) {
      // A wrapped description (or amounts that wrapped onto the next line).
      if (descText) cur.description = `${cur.description} ${descText}`.trim();
      if (cells.ref) cur.ref = `${cur.ref} ${cells.ref}`.trim();
      for (const [k, v] of Object.entries(nums)) if (!cur.nums[k]) cur.nums[k] = v;
      if (!cur.time) cur.time = findTime(descText);
      lastY = line.y;
    } else {
      cur = null;
    }
  }
  return { rows, opening, closing, notDone, unreadable };
}

const DEBIT_WORDS = /\b(withdraw\w*|atm|pos|purchase|payment|paid|transfer\s+to|trf\s+to|to\s+a\/?c|fonepay|esewa|khalti|qr|bill\s*pay|charge|fee|debit)\b/i;
const CREDIT_WORDS = /\b(deposit\w*|salary|interest|refund|reversal|received|transfer\s+from|trf\s+from|from\s+a\/?c|cash\s*dep|credit|remit\w*)\b/i;

/** Debit, credit and balance for each row, then a balance check that also fixes swapped sides. */
function settle(raw, opening) {
  const rows = raw.map((r) => {
    let debit = null;
    let credit = null;
    const { nums } = r;
    if (nums.debit) debit = Math.abs(nums.debit.value);
    if (nums.credit) credit = Math.abs(nums.credit.value);
    if (debit === 0) debit = null;
    if (credit === 0) credit = null;
    let side = '';
    if (nums.amount && debit == null && credit == null) {
      const a = nums.amount;
      const flag = `${r.drcr} ${a.side}`.toLowerCase();
      if (/\b(dr|d|debit|withdraw\w*)\b/.test(flag) || a.value < 0) side = 'debit';
      else if (/\b(cr|c|credit|deposit\w*)\b/.test(flag)) side = 'credit';
      if (side === 'debit') debit = Math.abs(a.value);
      else if (side === 'credit') credit = Math.abs(a.value);
      else r.unsided = Math.abs(a.value);
    }
    const balance = nums.balance ? (nums.balance.side === 'dr' ? -Math.abs(nums.balance.value) : nums.balance.value) : null;
    return { date: r.date, time: r.time, description: r.description.replace(/\s+/g, ' ').trim(), ref: r.ref.trim(), debit, credit, balance, unsided: r.unsided };
  });

  // Newest-first statements are checked oldest-first.
  const firstDate = rows[0]?.date || '';
  const lastDate = rows.at(-1)?.date || '';
  const balanceStep = (seq) => {
    let ok = 0;
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1];
      const b = seq[i];
      if (a.balance == null || b.balance == null) continue;
      const amt = b.debit ?? b.credit ?? b.unsided;
      if (amt != null && close(Math.abs(b.balance - a.balance), amt)) ok++;
    }
    return ok;
  };
  let descending = firstDate > lastDate;
  if (firstDate === lastDate && rows.length > 1) descending = balanceStep([...rows].reverse()) > balanceStep(rows);
  const seq = descending ? [...rows].reverse() : rows;

  let prev = opening;
  let checked = 0;
  let ok = 0;
  let fixed = 0;
  for (const r of seq) {
    if (r.balance != null && prev != null) {
      const delta = round2(r.balance - prev);
      checked++;
      if (r.unsided != null) {
        if (close(Math.abs(delta), r.unsided)) {
          if (delta < 0) r.debit = r.unsided; else r.credit = r.unsided;
          ok++;
        }
      } else if (close(delta, (r.credit || 0) - (r.debit || 0))) {
        ok++;
      } else if (close(delta, (r.debit || 0) - (r.credit || 0))) {
        [r.debit, r.credit] = [r.credit, r.debit];
        ok++;
        fixed++;
      } else if (r.debit != null && r.credit == null && close(delta, r.debit)) {
        r.credit = r.debit; r.debit = null; ok++; fixed++;
      } else if (r.credit != null && r.debit == null && close(delta, -r.credit)) {
        r.debit = r.credit; r.credit = null; ok++; fixed++;
      } else {
        r.balanceMismatch = true;
      }
    }
    // No balance to check against: decide by the words.
    if (r.unsided != null && r.debit == null && r.credit == null) {
      if (CREDIT_WORDS.test(r.description) && !DEBIT_WORDS.test(r.description)) r.credit = r.unsided;
      else r.debit = r.unsided;
      r.sideGuessed = true;
    }
    delete r.unsided;
    if (r.balance != null) prev = r.balance;
    else if (prev != null) prev = round2(prev - (r.debit || 0) + (r.credit || 0));
  }
  return { rows: seq, checked, ok, fixed, descending };
}

/* ---------- metadata ---------- */

const BANKS = [
  'Nabil Bank', 'NIC Asia Bank', 'Global IME Bank', 'Nepal Investment Mega Bank', 'Himalayan Bank', 'Standard Chartered',
  'Everest Bank', 'Kumari Bank', 'Laxmi Sunrise Bank', 'Siddhartha Bank', 'Prabhu Bank', 'Sanima Bank',
  'Machhapuchchhre Bank', 'NMB Bank', 'Prime Commercial Bank', 'Citizens Bank', 'Agricultural Development Bank',
  'Rastriya Banijya Bank', 'Nepal Bank', 'Nepal SBI Bank', 'Mega Bank', 'Sunrise Bank', 'Century Bank', 'Civil Bank',
  'eSewa', 'Khalti', 'IME Pay', 'connectIPS',
];

/** Bank name and the last 4 digits of the account number (nothing more is kept). */
export function statementMeta(text = '') {
  const flat = text.replace(/\s+/g, ' ');
  const known = BANKS.find((b) => new RegExp(b.replace(/\s+/g, '\\s*'), 'i').test(flat));
  const generic = !known && /([A-Z][A-Za-z.&]*(?:\s+[A-Z][A-Za-z.&]*){0,4}\s+Bank(?:\s+Limited|\s+Ltd\.?)?)/.exec(flat);
  const acc = /\b(?:a\/?c|account)\s*(?:no\.?|number|#)?\s*[:.\-]?\s*([0-9Xx*•\- ]{6,24}\d)/i.exec(flat);
  const digits = acc ? acc[1].replace(/[^\dXx*•]/g, '') : '';
  return { bank: known || (generic ? generic[1].trim() : ''), account: digits ? digits.slice(-4) : '' };
}

/* ---------- entry points ---------- */

function finish({ rows, opening, closing, notDone = 0, unreadable = 0 }, meta, source) {
  const settled = settle(rows, opening);
  const out = settled.rows.map((r) => ({ ...r, refs: findRefs(`${r.description} ${r.ref}`) }));
  const warnings = [];
  if (!out.length) warnings.push('No transactions were found. Is this a bank statement?');
  if (settled.checked && settled.ok < settled.checked) {
    warnings.push(`${settled.checked - settled.ok} of ${settled.checked} rows don't follow from the balance above them. Check those rows.`);
  }
  if (unreadable) warnings.push(`${unreadable} row${unreadable === 1 ? '' : 's'} had an amount but no readable date and ${unreadable === 1 ? 'was' : 'were'} left out. Add the statement file itself (Excel or PDF) to get every row.`);
  if (notDone) warnings.push(`${notDone} failed, cancelled or pending transaction${notDone === 1 ? ' was' : 's were'} left out: no money moved.`);
  if (out.some((r) => r.sideGuessed)) warnings.push('Some rows had no balance to check whether money went in or out; that was guessed from the description.');
  const dates = out.map((r) => r.date).sort();
  return {
    ...meta,
    source,
    from: dates[0] || '',
    to: dates.at(-1) || '',
    openingBalance: opening,
    closingBalance: closing ?? (out.at(-1)?.balance ?? null),
    rows: out,
    checks: { checked: settled.checked, ok: settled.ok, fixed: settled.fixed },
    warnings,
  };
}

/**
 * A statement from positioned words, page by page. Each token: { text, x0, x1, y0, y1 } with y
 * growing downwards (one text item may hold several words).
 */
export function parseStatementPages(pages) {
  const prepared = pages.map((tokens) => {
    const words = toWords(tokens);
    const h = median(words.map((w) => w.y1 - w.y0)) || 10;
    return { words, h, lines: groupLines(words, h) };
  });
  const meta = statementMeta(prepared[0] ? prepared[0].lines.slice(0, 40).map((l) => l.text).join('\n') : '');
  const order = detectDateOrder(prepared.flatMap((p) => p.lines.flatMap((l) => l.words.map((w) => w.text))));

  // The header of each page, or the last one seen (later pages often skip it).
  let header = null;
  const tables = prepared.map((p) => {
    const found = findHeader(p.lines, p.h);
    if (found) header = found;
    const start = found ? found.index + 1 : 0;
    return { ...p, header, body: header ? p.lines.slice(start) : [] };
  });
  if (!tables.some((t) => t.header)) return finish(assemble(fallbackLines(prepared, order), { order, h: 1 }), meta, 'layout-guess');

  const h = median(tables.map((t) => t.h));
  const lines = [];
  let offset = 0;
  for (const t of tables) {
    if (!t.header) continue;
    const columns = columnsFrom(t.header.cells, t.h);
    for (const l of t.body) lines.push({ cells: assignCells(l, columns), text: l.text, y: offset + l.cy });
    offset += 1e6; // a new page never continues the last row's description
  }
  return finish(assemble(lines, { order, h }), meta, 'columns');
}

/** No header found (e.g. a rough OCR scan): a date starts a row, the last amount is the balance. */
function fallbackLines(prepared, order) {
  const out = [];
  let offset = 0;
  for (const p of prepared) {
    for (const l of p.lines) {
      const date = parseDate(l.text, order);
      const cells = {};
      let rest = l.text;
      if (date) {
        cells.date = l.text.slice(0, date.length);
        rest = l.text.slice(date.length);
      }
      const toks = rest.trim().split(/\s+/).filter(Boolean);
      // Amounts at the end of the line, right to left; "Dr"/"Cr" after an amount belongs to it.
      const amounts = [];
      let side = '';
      while (toks.length && (isAmountToken(toks.at(-1)) || /^(cr|dr)\.?$/i.test(toks.at(-1)) || /^[-–]$/.test(toks.at(-1)))) {
        const t = toks.pop();
        if (/^(cr|dr)\.?$/i.test(t)) { side = t; continue; }
        amounts.unshift(side ? `${t} ${side}` : t);
        side = '';
      }
      const real = amounts.filter((a) => !/^[-–]$/.test(a));
      if (real.length >= 2) {
        cells.balance = real.at(-1);
        const moves = real.slice(0, -1);
        if (moves.length >= 2) { cells.debit = moves[0]; cells.credit = moves[1]; } else cells.amount = moves[0];
      } else if (real.length === 1) cells.amount = real[0];
      cells.desc = toks.join(' ');
      out.push({ cells, text: l.text, y: (offset + l.cy) / p.h });
    }
    offset += 1e6;
  }
  return out;
}

/** Splits CSV text into rows of cells (quotes and commas inside quotes handled). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** A statement exported as CSV (or pasted from a spreadsheet). */
export function parseStatementCsv(text) {
  return parseStatementTable(parseCsv(text), 'csv');
}

/**
 * A statement from rows of cell text: a CSV, or a spreadsheet (see sheet.js). Title, filter and
 * summary rows around the table are skipped; the column header row says what each column is.
 */
export function parseStatementTable(table, source = 'table') {
  const rows = table.map((r) => r.map((c) => (c == null ? '' : String(c))));
  const meta = statementMeta(rows.slice(0, 15).map((r) => r.join(' ')).join('\n'));
  const hi = rows.findIndex((r) => validHeader(r.map((c) => ({ kind: classifyHeader(c) }))));
  if (hi < 0) return finish({ rows: [], opening: null, closing: null }, meta, source);
  const kinds = rows[hi].map(classifyHeader);
  const body = rows.slice(hi + 1);
  const order = detectDateOrder(body.map((r) => r[kinds.indexOf('date')] || ''));
  const lines = body.map((r, i) => {
    const cells = {};
    r.forEach((c, j) => {
      const k = kinds[j] || 'other';
      if (k !== 'sn' && k !== 'skip' && c.trim()) cells[k] = cells[k] ? `${cells[k]} ${c.trim()}` : c.trim();
    });
    return { cells, text: r.join(' ').replace(/\s+/g, ' '), y: i };
  });
  return finish(assemble(lines, { order, h: 1 }), meta, source);
}

/** Stable key for a bank row, so the same row from two overlapping statements is kept once. */
export function bankRowKey(r) {
  const desc = String(r.description || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 32);
  return [r.date, r.debit ?? '', r.credit ?? '', r.balance ?? '', desc].join('|');
}
