// Builds statement PDFs like the ones banks email, for tests: a letterhead, account details,
// a column table with right-aligned amounts and wrapped narrations, over several pages.
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

export function statementPdf({ head, body, bank = 'Global IME Bank Limited', account = '0123456789012345', title = 'Statement of Account', rightAlign = [], foot = [] }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(bank, 40, 40);
  doc.setFontSize(9);
  doc.text(title, 40, 58);
  doc.text(`Account No: ${account}`, 40, 72);
  doc.text('Account Name: TEST CUSTOMER', 40, 84);
  doc.text('Branch: Thamel', 360, 72);
  const columnStyles = Object.fromEntries(rightAlign.map((i) => [i, { halign: 'right' }]));
  autoTable(doc, {
    startY: 100,
    head: [head],
    body,
    foot: foot.length ? [foot] : undefined,
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    columnStyles,
    didDrawPage: (d) => doc.text(`Page ${d.pageNumber}`, 500, 820),
  });
  return new Uint8Array(doc.output('arraybuffer'));
}
