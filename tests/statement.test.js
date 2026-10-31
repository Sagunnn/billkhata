import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { statementPdf } from './helpers/statementPdf.js';
import { readPdfTokens } from '../src/lib/bank/pdfText.js';
import { bankRowKey, findRefs, parseAmount, parseDate, parseStatementCsv, parseStatementPages, statementMeta } from '../src/lib/bank/statement.js';

const fmt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const read = async (pdf) => parseStatementPages((await readPdfTokens(pdfjs, pdf)).pages);

test('amounts as banks print them', () => {
  assert.deepEqual(parseAmount('1,23,456.78'), { value: 123456.78, side: '' });
  assert.deepEqual(parseAmount('(250.00)'), { value: -250, side: '' });
  assert.deepEqual(parseAmount('500.00 Dr'), { value: 500, side: 'dr' });
  assert.deepEqual(parseAmount('NPR 630'), { value: 630, side: '' });
  assert.equal(parseAmount('-'), null);
  assert.equal(parseAmount('FONEPAY'), null);
});

test('dates in every common layout, BS converted to AD', () => {
  assert.equal(parseDate('29/10/2026').ad, '2026-10-29');
  assert.equal(parseDate('10/29/2026').ad, '2026-10-29');
  assert.equal(parseDate('03/04/2026', 'mdy').ad, '2026-03-04');
  assert.equal(parseDate('29-Oct-2026').ad, '2026-10-29');
  assert.equal(parseDate('29 OCT 26').ad, '2026-10-29');
  assert.equal(parseDate('Oct 29, 2026').ad, '2026-10-29');
  assert.equal(parseDate('2026-10-29 14:32:11').time, '14:32');
  assert.equal(parseDate('29/10/2026 02:32 PM').time, '14:32');
  const bs = parseDate('2083/07/12');
  assert.equal(bs.ad, '2026-10-29');
  assert.equal(bs.bs, '2083-07-12');
  assert.equal(parseDate('FONEPAY 29/10'), null);
});

test('reference codes, but not dates', () => {
  assert.deepEqual(findRefs('FPAY/123456789/KOTHEYS 20261029'), ['123456789']);
});

test('bank name and only the last 4 account digits', () => {
  assert.deepEqual(statementMeta('NIC ASIA BANK LTD\nAccount No.: 0012-3456-7890-4321'), { bank: 'NIC Asia Bank', account: '4321' });
});

test('PDF: Txn/Value date, wrapped narrations, cheque numbers, three pages', async () => {
  let bal = 25000;
  const body = [['01/10/2026', '01/10/2026', 'Opening Balance', '', '', '', fmt(bal)]];
  for (let i = 0; i < 60; i++) {
    const d = `${String(1 + (i >> 1)).padStart(2, '0')}/10/2026`;
    const out = i % 5 !== 0;
    const amt = out ? 100 + i * 7.5 : 5000;
    bal += out ? -amt : amt;
    const desc = out ? `FONEPAY PAYMENT TO KOTHEYS PIMBAL RESTAURANT FP${100000000 + i}${i % 3 === 0 ? ' QR MERCHANT PAYMENT LONG NARRATION THAT WRAPS' : ''}` : 'CASH DEPOSIT BY SELF';
    body.push([d, d, desc, out ? '' : `${5000 + i}`, out ? fmt(amt) : '', out ? '' : fmt(amt), fmt(bal)]);
  }
  const st = await read(statementPdf({ head: ['Txn Date', 'Value Date', 'Particulars', 'Cheque No', 'Withdrawal', 'Deposit', 'Balance'], body, rightAlign: [4, 5, 6] }));
  assert.equal(st.bank, 'Global IME Bank');
  assert.equal(st.account, '2345');
  assert.equal(st.rows.length, 60);
  assert.equal(st.openingBalance, 25000);
  assert.deepEqual(st.checks, { checked: 60, ok: 60, fixed: 0 });
  assert.deepEqual([st.from, st.to], ['2026-10-01', '2026-10-30']);
  const wrapped = st.rows[3];
  assert.equal(wrapped.description, 'FONEPAY PAYMENT TO KOTHEYS PIMBAL RESTAURANT FP100000003 QR MERCHANT PAYMENT LONG NARRATION THAT WRAPS');
  assert.equal(wrapped.debit, 122.5);
  assert.deepEqual(wrapped.refs, ['FP100000003']);
  assert.equal(st.rows[0].credit, 5000);
  assert.equal(st.rows[0].ref, '5000');
  assert.equal(st.rows.at(-1).balance, bal);
  assert.deepEqual(st.warnings, []);
});

test('PDF: newest first, one Amount column with Dr/Cr, times, balance with Cr', async () => {
  const txns = [
    ['27-Oct-2026 09:15', 'ATM WITHDRAWAL THAMEL', 2000, 'DR'],
    ['28-Oct-2026 13:02', 'SALARY OCT 2026', 50000, 'CR'],
    ['29-Oct-2026 14:32', 'FONEPAY KOTHEYS PIMBAL 712345678', 630, 'DR'],
    ['29-Oct-2026 19:40', 'ESEWA LOAD 9812345678', 1000, 'DR'],
  ];
  let bal = 10000;
  const rows = txns.map(([d, desc, amt, side]) => { bal += side === 'CR' ? amt : -amt; return [d, desc, fmt(amt), side, `${fmt(bal)} Cr`]; });
  const st = await read(statementPdf({ bank: 'Nabil Bank Limited', head: ['Date', 'Description', 'Amount', 'Dr/Cr', 'Balance'], body: rows.reverse(), rightAlign: [2, 4] }));
  assert.equal(st.bank, 'Nabil Bank');
  assert.equal(st.rows.length, 4);
  assert.deepEqual(st.rows.map((r) => r.date), ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-29'], 'oldest first');
  assert.deepEqual(st.rows.map((r) => [r.debit, r.credit]), [[2000, null], [null, 50000], [630, null], [1000, null]]);
  assert.equal(st.rows[2].time, '14:32');
  assert.equal(st.checks.ok, 3, 'every row after the first checks against the one before');
});

test('PDF: two-line centred header, BS dates, a debit printed in the credit column is fixed', async () => {
  const body = [
    ['2083/07/10', 'Balance B/F', '', '', fmt(5000)],
    ['2083/07/11', 'QR PAYMENT BHATBHATENI', fmt(1250), '', fmt(3750)],
    ['2083/07/12', 'FONEPAY KOTHEYS', '', fmt(630), fmt(3120)], // wrong column on purpose
    ['2083/07/12', 'INTEREST', '', fmt(12.34), fmt(3132.34)],
  ];
  const pdf = statementPdf({ bank: 'Kumari Bank', head: ['Tran Date\n(BS)', 'Narration', 'Debit\nAmount', 'Credit\nAmount', 'Running\nBalance'], body, rightAlign: [2, 3, 4] });
  const st = await read(pdf);
  assert.equal(st.openingBalance, 5000);
  assert.deepEqual(st.rows.map((r) => r.date), ['2026-10-28', '2026-10-29', '2026-10-29']);
  assert.deepEqual(st.rows.map((r) => [r.debit, r.credit]), [[1250, null], [630, null], [null, 12.34]]);
  assert.equal(st.checks.fixed, 1);
});

test('CSV export', () => {
  const csv = 'Account Number,0123456789\nTxn Date,Description,Withdrawal,Deposit,Balance\n29/10/2026,"FONEPAY, KOTHEYS",630.00,,"9,370.00"\n30/10/2026,Salary,,"50,000.00","59,370.00"\n';
  const st = parseStatementCsv(csv);
  assert.equal(st.account, '6789');
  assert.deepEqual(st.rows.map((r) => [r.date, r.description, r.debit, r.credit, r.balance]), [
    ['2026-10-29', 'FONEPAY, KOTHEYS', 630, null, 9370],
    ['2026-10-30', 'Salary', null, 50000, 59370],
  ]);
});

test('no header (a rough scan): a date starts a row, the balance decides the side', () => {
  const line = (y, text) => ({ text, x0: 10, x1: 10 + text.length * 5, y0: y, y1: y + 10 });
  const st = parseStatementPages([[
    line(10, 'Statement'),
    line(30, '29/10/2026 FONEPAY KOTHEYS 630.00 9,370.00'),
    line(42, 'PIMBAL'),
    line(60, '30/10/2026 SALARY 50,000.00 59,370.00'),
    line(80, '31/10/2026 ATM 1,000.00 58,370.00'),
  ]]);
  assert.equal(st.source, 'layout-guess');
  assert.deepEqual(st.rows.map((r) => [r.description, r.debit, r.credit]), [
    ['FONEPAY KOTHEYS PIMBAL', 630, null],
    ['SALARY', null, 50000],
    ['ATM', 1000, null],
  ]);
});

test('row keys are the same for the same row in two statements', () => {
  const a = { date: '2026-10-29', debit: 630, credit: null, balance: 9370, description: 'FONEPAY KOTHEYS' };
  assert.equal(bankRowKey(a), bankRowKey({ ...a, description: 'Fonepay  Kotheys' }));
});

test('a slightly tilted scan: the far-right balance still joins its row', () => {
  // 1° tilt: every word sits lower the further right it is.
  const w = (text, x, y) => ({ text, x0: x, x1: x + text.length * 9, y0: y + x * 0.0175, y1: y + x * 0.0175 + 16 });
  const st = parseStatementPages([[
    w('Date', 40, 100), w('Description', 200, 100), w('Withdrawal', 600, 100), w('Deposit', 800, 100), w('Balance', 1000, 100),
    w('24/10/2026', 40, 140), w('Opening', 200, 140), w('Balance', 280, 140), w('12,000.00', 1000, 140),
    w('29/10/2026', 40, 170), w('FONEPAY', 200, 170), w('KOTHEYS', 280, 170), w('630.00', 620, 170), w('11,370.00', 1000, 170),
  ]]);
  assert.equal(st.openingBalance, 12000);
  assert.deepEqual(st.rows.map((r) => [r.description, r.debit, r.balance]), [['FONEPAY KOTHEYS', 630, 11370]]);
  assert.deepEqual(st.checks, { checked: 1, ok: 1, fixed: 0 });
});
