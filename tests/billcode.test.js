import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { assignBillCode, billCodePrefix, ensureBillCodes, tripInitials } from '../src/lib/billCode.js';
import { buildReportPdf } from '../src/lib/pdf.js';

const bill = (id, over = {}) => ({
  id, merchantName: `Shop ${id}`, totalAmount: 500, billDateAD: '2026-10-29', billDateBS: '2083-07-12',
  category: 'Food & Dining', paymentMethod: 'Cash', sellerPan: '609876543', invoiceNumber: `INV-${id}`, irdCoupon: '', createdAt: `2026-10-29T10:00:0${id.length}Z`, ...over,
});

test('prefix: BS month + fortnight, or trip initials', () => {
  assert.equal(billCodePrefix(bill('a')), 'KT1');
  assert.equal(billCodePrefix(bill('a', { billDateBS: '2083-07-16' })), 'KT2');
  assert.equal(billCodePrefix(bill('a', { billDateBS: '2083-06-30' })), 'AW2');
  assert.equal(billCodePrefix(bill('a', { billDateBS: '2082-12-01' })), 'CH1');
  assert.equal(billCodePrefix(bill('a', { tripId: 't1' }), [{ id: 't1', name: 'Pokhara Kayaking' }]), 'PK');
  assert.equal(tripInitials('Nagarkot'), 'NA');
  assert.equal(tripInitials(''), 'TR');
});

test('assignBillCode: next free number, keeps a valid code, re-codes on group change', () => {
  const all = [bill('a', { billCode: 'KT1-01' }), bill('b', { billCode: 'KT1-02' }), bill('c', { billCode: 'KT2-01', billDateBS: '2083-07-20' })];
  assert.equal(assignBillCode(bill('new'), all), 'KT1-03');
  assert.equal(assignBillCode(all[1], all), 'KT1-02');
  assert.equal(assignBillCode({ ...all[1], billDateBS: '2083-07-18' }, all), 'KT2-02');
  assert.equal(assignBillCode({ ...bill('d'), billCode: 'KT1-01' }, all), 'KT1-03', 'a duplicate code is replaced');
});

test('ensureBillCodes: oldest first, duplicates resolved, only changes returned', () => {
  const list = [
    bill('late', { billDateAD: '2026-10-30', billDateBS: '2083-07-13' }),
    bill('early', { billDateAD: '2026-10-20', billDateBS: '2083-07-03' }),
    bill('dup1', { billCode: 'KT1-01', billDateAD: '2026-10-25', billDateBS: '2083-07-08' }),
    bill('dup2', { billCode: 'KT1-01', billDateAD: '2026-10-26', billDateBS: '2083-07-09' }),
    bill('ok', { billCode: 'KT2-05', billDateAD: '2026-11-05', billDateBS: '2083-07-19' }),
  ];
  const changed = Object.fromEntries(ensureBillCodes(list).map((e) => [e.id, e.billCode]));
  assert.deepEqual(changed, { early: 'KT1-02', dup2: 'KT1-03', late: 'KT1-04' });
  const codes = list.map((e) => changed[e.id] || e.billCode);
  assert.equal(new Set(codes).size, codes.length);
});

/** A tiny real PNG (grey square) built by hand, so the PDF test needs no canvas. */
function pngDataUrl(size = 40) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((size + 1) * size, 180); for (let y = 0; y < size; y++) raw[y * (size + 1)] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function sampleBills(n, withImageEvery = 1) {
  const img = pngDataUrl();
  return Array.from({ length: n }, (_, i) => bill(`b${i}`, {
    billCode: `KT1-${String(i + 1).padStart(2, '0')}`,
    billDateAD: `2026-10-${String(10 + (i % 15)).padStart(2, '0')}`,
    receiptImage: i % withImageEvery === 0 ? img : null,
    irdCoupon: i === 0 ? '208307004512' : '',
  }));
}

const links = (doc, p) => (doc.internal.getPageInfo(p).pageContext.annotations || []).filter((a) => a.type === 'link');

test('PDF with receipt appendix: two-way references, page numbers and links', async () => {
  const bills = sampleBills(30, 3); // 10 with photos, 20 without
  const doc = await buildReportPdf({ expenses: bills, profile: { fullName: 'Sita' }, includeImages: true });
  const { pages, tablePages, bills: refs } = doc.billkhataRefs;
  const photos = refs.filter((r) => r.hasImage);
  assert.equal(photos.length, 10);
  assert.equal(pages, tablePages + Math.ceil(10 / 4), 'appendix: 4 cards per page, after the table');
  assert.deepEqual(refs.map((r) => r.rowIndex), Array.from({ length: 30 }, (_, i) => i + 1));
  for (const r of refs) {
    assert.ok(r.page >= 1 && r.page <= tablePages, `${r.code} table page`);
    if (r.hasImage) assert.ok(r.appendixPage > tablePages && r.appendixPage <= pages, `${r.code} appendix page`);
    else assert.equal(r.appendixPage, null);
  }
  // Cards fill appendix pages in order, 4 per page.
  assert.deepEqual(photos.map((r) => r.appendixPage), photos.map((_, i) => tablePages + 1 + Math.floor(i / 4)));
  // Forward links from table cells (photos only) and back links from every card header.
  const forward = Array.from({ length: tablePages }, (_, i) => links(doc, i + 1)).flat();
  const back = Array.from({ length: pages - tablePages }, (_, i) => links(doc, tablePages + i + 1)).flat();
  assert.equal(forward.length, 10);
  assert.equal(back.length, 10);
  assert.ok(forward.every((l) => l.options.pageNumber > tablePages));
  assert.ok(back.every((l) => l.options.pageNumber <= tablePages));
  assert.ok(doc.output('arraybuffer').byteLength > 1000);
});

test('PDF without the appendix (or without photos) has no appendix pages or links', async () => {
  const bills = sampleBills(6);
  const off = await buildReportPdf({ expenses: bills, profile: {}, includeImages: false });
  assert.equal(off.billkhataRefs.pages, off.billkhataRefs.tablePages);
  assert.equal(links(off, 1).length, 0);
  const noPhotos = await buildReportPdf({ expenses: bills.map((b) => ({ ...b, receiptImage: null })), profile: {}, includeImages: true });
  assert.equal(noPhotos.billkhataRefs.pages, noPhotos.billkhataRefs.tablePages);
  assert.ok(noPhotos.billkhataRefs.bills.every((r) => r.appendixPage === null && r.hasImage === false));
});
