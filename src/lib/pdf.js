// Client-side PDF expense report (jsPDF + jspdf-autotable), loaded on demand.
import { reportTotals } from './expense.js';
import { formatAD } from './nepaliDate.js';

// jsPDF's built-in fonts only cover Latin-1, so Devanagari would print as junk.
// Keep digits, drop the rest, and say so when nothing readable is left.
function latin(text) {
  const s = String(text ?? '')
    .replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966))
    .replace(/रु/g, 'Rs.')
    .replace(/[^\x20-\x7E -ÿ]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s || (text ? '[Nepali text]' : '');
}

const npr = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LINK_BLUE = [29, 78, 216];
const imageFormat = (src) => (/^data:image\/png/i.test(src || '') ? 'PNG' : 'JPEG');

/**
 * The expense report. With the receipt appendix on, every bill is cross-referenced both ways:
 * the "Code / Ref" cell says "-> See p.N" and links to its voucher card, and each card's header
 * names the table page and row and links back. Page numbers match the "Page X of Y" footers.
 * The returned doc carries `billkhataRefs` (where each bill landed), used by tests.
 */
export async function buildReportPdf({ expenses, profile, from, to, includeImages }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const ink = [15, 23, 42];
  const muted = [100, 116, 139];
  const brand = [185, 28, 28];

  // Header
  doc.setFillColor(...brand);
  doc.rect(0, 0, W, 4, 'F');
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('BillKhata Expense & Voucher Report', M, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  const range = from || to
    ? `${from ? formatAD(from) : 'start'} - ${to ? formatAD(to) : 'today'}`
    : 'All dates';
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, W - M, 16, { align: 'right' });

  doc.setTextColor(...ink);
  doc.setFontSize(10);
  const lines = [
    ['Name', latin(profile?.fullName) || '-'],
    ['Phone', profile?.phone || '-'],
    ['Personal PAN', profile?.pan || '-'],
    ['Report period', range],
  ];
  lines.forEach(([k, v], i) => {
    const x = M + (i % 2) * 90;
    const y = 25 + Math.floor(i / 2) * 6;
    doc.setFont('helvetica', 'bold');
    doc.text(`${k}:`, x, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(v), x + 27, y);
  });

  // Summary box
  const t = reportTotals(expenses);
  const boxY = 37;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, boxY, W - 2 * M, 20, 2, 2, 'FD');
  const stats = [
    ['Total expenses', `NPR ${npr(t.total)}`],
    ['Bills', String(t.count)],
    ['Total VAT paid', `NPR ${npr(t.vat)}`],
    ['Cash spend', `NPR ${npr(t.cash)}`],
    ['Digital spend', `NPR ${npr(t.digital)}`],
    ['IRD coupons', String(t.coupons)],
    ...(t.splitCount ? [['My share', `NPR ${npr(t.myShare)}`], ['Recoverable', `NPR ${npr(t.recoverable)}`]] : []),
  ];
  const colW = (W - 2 * M) / stats.length;
  stats.forEach(([k, v], i) => {
    const x = M + 5 + i * colW;
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(k.toUpperCase(), x, boxY + 7);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ink);
    doc.text(v, x, boxY + 14.5);
    doc.setFont('helvetica', 'normal');
  });

  // Itemised table. "Code / Ref" comes first; with the appendix on, its cell gets a second
  // (blank) line where the appendix page is written once the appendix exists.
  const rows = [...expenses].sort((a, b) => (a.billDateAD || '').localeCompare(b.billDateAD || '') || (a.billCode || '').localeCompare(b.billCode || ''));
  const appendix = Boolean(includeImages);
  const cells = new Map(); // bill id -> { page, x, y, w, h, rowIndex, code, hasImage }
  autoTable(doc, {
    startY: boxY + 26,
    head: [['Code / Ref', 'Date (AD / BS)', 'Merchant', 'Seller PAN', 'Invoice #', 'Category', 'Payment', 'IRD Coupon #', 'Amount (NPR)']],
    body: rows.map((e) => [
      appendix ? `${e.billCode || '-'}\n ` : (e.billCode || '-'),
      `${e.billDateAD || ''}${e.billDateBS ? `\nBS ${e.billDateBS}` : ''}`,
      latin(e.merchantName),
      e.sellerPan || '-',
      latin(e.invoiceNumber) || '-',
      e.category,
      e.paymentMethod,
      e.irdCoupon || '-',
      npr(e.totalAmount),
    ]),
    foot: [['', '', '', '', '', '', '', 'Total', npr(t.total)]],
    showFoot: 'lastPage',
    rowPageBreak: 'avoid',
    margin: { left: M, right: M, bottom: 14 },
    styles: { fontSize: 8.5, cellPadding: 2, textColor: ink, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: ink, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], textColor: ink, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 25, fontStyle: 'bold' }, 1: { cellWidth: 25 }, 3: { cellWidth: 21 }, 7: { cellWidth: 27 }, 8: { halign: 'right', cellWidth: 26 } },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const e = rows[data.row.index];
      cells.set(e.id, {
        page: doc.getCurrentPageInfo().pageNumber,
        x: data.cell.x, y: data.cell.y, w: data.cell.width, h: data.cell.height,
        rowIndex: data.row.index + 1, code: e.billCode || '-', hasImage: Boolean(e.receiptImage),
      });
    },
  });
  const tableEnd = doc.getNumberOfPages();

  // Receipt voucher appendix: 2 x 2 labelled cards per page, starting on a new page.
  const appendixPages = new Map(); // bill id -> page of its card
  const withPhotos = appendix ? rows.filter((e) => e.receiptImage) : [];
  if (withPhotos.length) {
    const gap = 8;
    const top = 22;
    const cardW = (W - 2 * M - gap) / 2;
    const cardH = (H - top - 16 - gap) / 2;
    const headH = 17;
    withPhotos.forEach((e, i) => {
      const slot = i % 4;
      if (slot === 0) {
        doc.addPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...ink);
        doc.text('Receipt Voucher Appendix', M, 14);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...muted);
        doc.text('Click a card header to jump back to its row in the expense table.', W - M, 14, { align: 'right' });
      }
      const page = doc.getCurrentPageInfo().pageNumber;
      appendixPages.set(e.id, page);
      const x = M + (slot % 2) * (cardW + gap);
      const y = top + Math.floor(slot / 2) * (cardH + gap);
      const ref = cells.get(e.id);

      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'S');
      doc.setFillColor(239, 246, 255);
      doc.rect(x + 0.3, y + 0.3, cardW - 0.6, headH, 'F');
      doc.setDrawColor(191, 219, 254);
      doc.line(x, y + headH + 0.3, x + cardW, y + headH + 0.3);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...LINK_BLUE);
      doc.text(`[${e.billCode || '-'}] - Table ref: page ${ref?.page ?? '?'}, row #${ref?.rowIndex ?? '?'}`, x + 3, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...ink);
      const info = `${latin(e.merchantName) || 'Bill'} • PAN: ${e.sellerPan || '-'} • Inv: ${latin(e.invoiceNumber) || '-'} • NPR ${npr(e.totalAmount)}`;
      doc.text(doc.splitTextToSize(info, cardW - 6)[0], x + 3, y + 9.5);
      if (e.irdCoupon) {
        doc.setTextColor(4, 120, 87);
        doc.text(`IRD Coupon: ${e.irdCoupon}`, x + 3, y + 14);
      }
      if (ref) doc.link(x, y, cardW, headH, { pageNumber: ref.page });

      const props = doc.getImageProperties(e.receiptImage);
      const boxW = cardW - 6;
      const boxH = cardH - headH - 5;
      const scale = Math.min(boxW / props.width, boxH / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      doc.addImage(e.receiptImage, imageFormat(e.receiptImage), x + 3 + (boxW - w) / 2, y + headH + 2.5 + (boxH - h) / 2, w, h, undefined, 'FAST');
    });
  }

  // Back-fill the table: forward links to each card, or "No Photo".
  if (appendix) {
    for (const [id, c] of cells) {
      doc.setPage(c.page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      const target = appendixPages.get(id);
      if (target) {
        doc.setTextColor(...LINK_BLUE);
        doc.text(`-> See p.${target}`, c.x + 2, c.y + c.h - 2.4);
        doc.link(c.x, c.y, c.w, c.h, { pageNumber: target });
      } else {
        doc.setTextColor(...muted);
        doc.text('No Photo', c.x + 2, c.y + c.h - 2.4);
      }
    }
  }

  // Footers last, so "Page X of Y" counts the appendix too.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`BillKhata Expense & Voucher Report • Page ${p} of ${pages}`, W / 2, H - 5, { align: 'center' });
  }

  doc.billkhataRefs = {
    pages,
    tablePages: tableEnd,
    bills: rows.map((e) => ({ id: e.id, code: e.billCode || '', ...cells.get(e.id), appendixPage: appendixPages.get(e.id) || null })),
  };
  return doc;
}

export const reportFilename = (from, to) => `billkhata_report_${from || 'all'}${to ? `_to_${to}` : ''}.pdf`.replace(/-/g, '_');


/** Trip Settlement PDF: every expense, each person's breakdown, and who pays whom. */
export async function buildTripPdf({ trip, settlement, profile }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const ink = [15, 23, 42];
  const muted = [100, 116, 139];
  const name = (id) => latin(trip.members.find((m) => m.id === id)?.name) || 'Unknown';
  const head = { fillColor: ink, textColor: 255, fontStyle: 'bold' };
  const styles = { fontSize: 8.5, cellPadding: 2, textColor: ink, lineColor: [226, 232, 240], lineWidth: 0.1 };
  const dates = trip.entries.map((e) => e.dateAD).filter(Boolean).sort();

  doc.setFillColor(185, 28, 28);
  doc.rect(0, 0, W, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text(`Trip Settlement: ${latin(trip.name) || 'Trip'}`, M, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  doc.text(`${dates.length ? `${formatAD(dates[0])} - ${formatAD(dates.at(-1))} · ` : ''}${trip.members.length} people · ${trip.entries.length} expenses · total NPR ${npr(settlement.total)}`, M, 23);
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}${profile?.fullName ? ` by ${latin(profile.fullName)}` : ''}`, W - M, 16, { align: 'right' });

  // Who pays whom first: it's what everyone opens the PDF for.
  autoTable(doc, {
    startY: 30,
    head: [['Who pays whom', 'To', 'Amount (NPR)', 'Status']],
    body: settlement.transfers.length
      ? settlement.transfers.map((t) => [name(t.fromMemberId), name(t.toMemberId), npr(t.amount), trip.paidTransfers?.[`${t.fromMemberId}>${t.toMemberId}`] ? 'Paid' : 'Due'])
      : [['Everyone is settled', '', '', '']],
    margin: { left: M, right: M },
    styles,
    headStyles: { ...head, fillColor: [185, 28, 28] },
    columnStyles: { 2: { halign: 'right' } },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    head: [['Person', 'Paid', 'Consumed', 'Veg', 'Non-veg', 'Drinks', 'Shared', 'Tax/SC/disc.', 'Balance']],
    body: settlement.members.map((m) => [
      latin(m.name), npr(m.totalPaid), npr(m.totalConsumed), npr(m.breakdown.veg), npr(m.breakdown.nonVeg),
      npr(m.breakdown.drink), npr(m.breakdown.shared), npr(m.breakdown.tax),
      `${m.netBalance > 0 ? 'gets ' : m.netBalance < 0 ? 'owes ' : ''}${npr(Math.abs(m.netBalance))}`,
    ]),
    margin: { left: M, right: M },
    styles,
    headStyles: head,
    columnStyles: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, { halign: 'right' }])),
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    head: [['Date', 'Expense', 'Bill', 'Seller PAN / Invoice', 'Paid by', 'Items', 'Total (NPR)']],
    body: [...trip.entries].sort((a, b) => (a.dateAD || '').localeCompare(b.dateAD || '')).map((e) => [
      `${e.dateAD || ''}${e.dateBS ? `\nBS ${e.dateBS}` : ''}`,
      latin(e.title) || '-',
      e.hasBill ? 'Bill' : 'No bill',
      e.hasBill ? `${e.sellerPan || '-'} / ${latin(e.invoiceNumber) || '-'}` : '-',
      name(e.paidByMemberId),
      (e.items || []).map((it) => `${latin(it.name) || 'Item'} ${npr(it.amount)} (${it.category}: ${it.assignedMemberIds.map(name).join(', ') || 'everyone'})`).join('\n'),
      npr(e.totalAmount),
    ]),
    foot: [['', '', '', '', '', 'Total', npr(settlement.total)]],
    margin: { left: M, right: M },
    styles,
    headStyles: head,
    footStyles: { fillColor: [241, 245, 249], textColor: ink, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 24 }, 5: { cellWidth: 110 }, 6: { halign: 'right' } },
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text('BillKhata · Trip Khata · made on this device', M, H - 5);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 5, { align: 'right' });
  }
  return doc;
}

export const tripPdfFilename = (trip) => `trip_${(latin(trip.name) || 'trip').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}.pdf`;
