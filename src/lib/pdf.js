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
  doc.text('BillKhata Expense Report', M, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  const range = from || to
    ? `${from ? formatAD(from) : 'start'} – ${to ? formatAD(to) : 'today'}`
    : 'All dates';
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, W - M, 16, { align: 'right' });

  doc.setTextColor(...ink);
  doc.setFontSize(10);
  const lines = [
    ['Name', latin(profile.fullName) || '—'],
    ['Phone', profile.phone || '—'],
    ['Personal PAN', profile.pan || '—'],
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

  // Itemised table
  const rows = [...expenses]
    .sort((a, b) => (a.billDateAD || '').localeCompare(b.billDateAD || ''))
    .map((e) => [
      `${e.billDateAD || ''}\n${e.billDateBS ? `BS ${e.billDateBS}` : ''}`,
      latin(e.merchantName),
      e.sellerPan || '—',
      latin(e.invoiceNumber) || '—',
      e.category,
      e.paymentMethod,
      e.irdCoupon || '—',
      npr(e.totalAmount),
    ]);
  autoTable(doc, {
    startY: boxY + 26,
    head: [['Date (AD / BS)', 'Merchant', 'Seller PAN', 'Invoice #', 'Category', 'Payment', 'IRD Coupon #', 'Amount (NPR)']],
    body: rows,
    foot: [['', '', '', '', '', '', 'Total', { content: npr(t.total), styles: { halign: 'right' } }]],
    margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 2, textColor: ink, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: ink, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], textColor: ink, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 28 }, 2: { cellWidth: 22 }, 6: { cellWidth: 28 }, 7: { halign: 'right', cellWidth: 28 } },
  });

  // Receipt appendix
  const withImages = expenses.filter((e) => e.receiptImage);
  if (includeImages && withImages.length) {
    const cols = 4;
    const rowsPerPage = 2;
    const gap = 6;
    const cellW = (W - 2 * M - gap * (cols - 1)) / cols;
    const cellH = (H - 30 - gap * (rowsPerPage - 1)) / rowsPerPage;
    withImages.forEach((e, i) => {
      const slot = i % (cols * rowsPerPage);
      if (slot === 0) {
        doc.addPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...ink);
        doc.text('Appendix: receipt images', M, 14);
      }
      const x = M + (slot % cols) * (cellW + gap);
      const y = 20 + Math.floor(slot / cols) * (cellH + gap);
      const props = doc.getImageProperties(e.receiptImage);
      const maxH = cellH - 12;
      const scale = Math.min(cellW / props.width, maxH / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      doc.setDrawColor(203, 213, 225);
      doc.rect(x, y, cellW, cellH);
      doc.addImage(e.receiptImage, 'JPEG', x + (cellW - w) / 2, y + 1, w, h, undefined, 'FAST');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(doc.splitTextToSize(`${e.billDateAD} · ${latin(e.merchantName)} · NPR ${npr(e.totalAmount)}`, cellW - 4), x + 2, y + cellH - 7);
      if (e.irdCoupon) doc.text(`Coupon ${e.irdCoupon}`, x + 2, y + cellH - 2.5);
    });
  }

  // Page footers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`BillKhata · expense.sagunpradhan.com.np · data stays on your device`, M, H - 5);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 5, { align: 'right' });
  }
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
