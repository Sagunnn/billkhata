// Payment screenshots (Fonepay, eSewa, Khalti, IME Pay, connectIPS, mobile banking apps) → fields.
// These screens are clean digital text, so OCR reads them well; the work is finding the right
// label. Apps put the value after the label ("Amount: NPR 630.00") or on the line below it.
// Pure functions; unit-tested in tests/payment.test.js.
import { toAsciiDigits } from '../nepaliDate.js';
import { findRefs, parseDate, findTime } from './statement.js';

const APPS = [
  ['eSewa', /e\s?-?sewa/i],
  ['Khalti', /khalti/i],
  ['IME Pay', /ime\s?pay/i],
  ['connectIPS', /connect\s?ips/i],
  ['Fonepay', /fone\s?pay/i],
  ['NPS', /\bnps\b|nepal\s?pay/i],
];

const LABELS = {
  amount: /^(total\s+)?(paid\s+|payment\s+|transaction\s+|transfer\s+|txn\s+)?(amount|amt)\b|^total\b|^you\s+paid\b/i,
  merchant: /^(paid\s+to|payment\s+to|sent\s+to|transferred\s+to|merchant(\s+name)?|receiver(\s+name)?|beneficiary(\s+name)?|payee|to|recipient|counter\s*party|service\s*provider|store|shop)\b/i,
  ref: /^((fonepay\s+)?trace\s*(id|no)|transaction\s*(id|code|no|number|ref\w*)|txn\s*(id|no|code)|ref(erence)?\s*(id|no|code|number)?|prn|rrn|stan|utr|request\s*id|order\s*id|unique\s*id|tran\s*id)\b/i,
  date: /^(transaction\s+|txn\s+|payment\s+)?(date(\s*(&|and)?\s*time)?|time|paid\s+on|on)\b/i,
  remarks: /^(remarks?|purpose|description|note|narration)\b/i,
};
const SKIP_AMOUNT = /balance|charge|fee|cashback|reward|point|limit|discount|commission/i;
const CURRENCY_RE = /(?:npr|rs\.?|रु\.?|रू\.?)\s*([\d,]+(?:\.\d{1,2})?)\b/i;

const clean = (s) => String(s || '').replace(/^[\s:.\-–|>]+/, '').replace(/[\s|]+$/, '').trim();

function money(text) {
  const t = toAsciiDigits(text);
  const m = CURRENCY_RE.exec(t) || /^\s*([\d,]+\.\d{2})\b/.exec(t) || /^\s*([\d,]{2,})\s*$/.exec(t);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return v > 0 && v < 1e8 ? v : null;
}

/** The value for a label line: after the label on the same line, or the next line. */
function valueAfter(lines, i, re) {
  const m = re.exec(lines[i]);
  const same = clean(lines[i].slice(m[0].length));
  if (same) return same;
  const next = lines[i + 1] && clean(lines[i + 1]);
  return next && !Object.values(LABELS).some((l) => l.test(next)) ? next : '';
}

/** The date anywhere in a line, not only at its start ("Date: 29 Oct 2026, 02:32 PM"). */
function dateIn(text) {
  const t = toAsciiDigits(text);
  for (let i = 0; i < t.length; i++) {
    if (i && /[\dA-Za-z]/.test(t[i - 1])) continue;
    const d = parseDate(t.slice(i));
    if (d) return { ...d, time: d.time || findTime(t.slice(i + d.length)) || findTime(t) };
  }
  return null;
}

/**
 * @returns {{ app, amount, dateAD, time, merchant, ref, refs, remarks, status, direction }}
 */
export function parsePaymentText(text = '') {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const flat = lines.join('\n');
  const out = { app: '', amount: null, dateAD: '', time: '', merchant: '', ref: '', refs: [], remarks: '', status: '', direction: 'out' };

  out.app = (APPS.find(([, re]) => re.test(flat)) || [''])[0];
  if (!out.app) {
    const bank = /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+Bank)\b/.exec(flat);
    out.app = bank ? bank[1] : /mobile\s*banking/i.test(flat) ? 'Mobile banking' : '';
  }
  if (/\b(fail(ed|ure)?|unsuccessful|declined|cancel+ed|pending|processing)\b/i.test(flat)) out.status = 'failed';
  else if (/\bsuccess(ful(ly)?)?\b|\bcompleted?\b|\bpaid\b/i.test(flat)) out.status = 'success';
  if (/\b(received\s+from|you\s+received|credited\s+to\s+your|money\s+received|from\s*:)/i.test(flat)) out.direction = 'in';

  const refs = new Set();
  let amountRank = 9;
  lines.forEach((line, i) => {
    if (LABELS.amount.test(line) && !SKIP_AMOUNT.test(line)) {
      const v = money(valueAfter(lines, i, LABELS.amount)) ?? money(line);
      const rank = /total|paid/i.test(line) ? 0 : 1;
      if (v && rank < amountRank) { out.amount = v; amountRank = rank; }
    }
    if (!out.merchant && LABELS.merchant.test(line)) {
      const v = valueAfter(lines, i, LABELS.merchant);
      // Not a phone or account number on its own; those stay in the refs.
      if (v && /[A-Za-zऀ-ॿ]{2,}/.test(v)) out.merchant = v.replace(/\s*\(?\b\d{6,}\b\)?\s*$/, '').slice(0, 80);
    }
    if (LABELS.ref.test(line)) {
      const v = valueAfter(lines, i, LABELS.ref).replace(/\s+/g, '');
      if (/^[A-Za-z0-9\-/]{4,40}$/.test(v) && /\d/.test(v)) {
        refs.add(v.toUpperCase());
        if (!out.ref) out.ref = v.toUpperCase();
      }
    }
    if (!out.dateAD && LABELS.date.test(line)) {
      const d = dateIn(line) || (lines[i + 1] && dateIn(lines[i + 1]));
      if (d) { out.dateAD = d.ad; out.time = d.time || ''; }
    }
    if (!out.remarks && LABELS.remarks.test(line)) out.remarks = valueAfter(lines, i, LABELS.remarks).slice(0, 120);
  });

  // No labelled amount: the first currency amount that isn't a balance or fee.
  if (out.amount == null) {
    for (const line of lines) {
      if (SKIP_AMOUNT.test(line)) continue;
      const v = money(line);
      if (v && CURRENCY_RE.test(toAsciiDigits(line))) { out.amount = v; break; }
    }
  }
  if (!out.dateAD) {
    for (const line of lines) {
      const d = dateIn(line);
      if (d) { out.dateAD = d.ad; out.time = d.time || ''; break; }
    }
  }
  if (out.dateAD && !out.time) out.time = findTime(flat);
  for (const r of findRefs(flat)) refs.add(r);
  out.refs = [...refs];
  return out;
}
