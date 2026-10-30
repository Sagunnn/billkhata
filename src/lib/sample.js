// Demo data so the app can be tried straight away. Receipts are drawn on a canvas,
// so every sample has a "photo" and can be fed through OCR. All shops, PANs and
// coupon numbers are made up.
import { PAYMENT } from './constants.js';
import { finalizeExpense } from './expense.js';
import { compressImage } from './image.js';
import { addDaysAD, adToBs, todayAD } from './nepaliDate.js';
import { makeItem } from './splitter.js';

export const DEMO_PROFILE = {
  fullName: 'Demo User',
  phone: '9800000000',
  address: 'Baneshwor-10, Kathmandu',
  pan: '',
  region: 'Nepal',
};

/** Draws a thermal-printer style receipt and returns a PNG data URL. */
export function drawReceipt(r) {
  const lineH = 34;
  const lines = [
    { t: r.merchant, size: 30, bold: true, center: true },
    { t: r.address, center: true },
    r.pan ? { t: `PAN No: ${r.pan}`, center: true } : null,
    { t: r.vat ? 'TAX INVOICE' : 'ESTIMATE', bold: true, center: true },
    { t: '' },
    { t: `Bill No: ${r.invoice}` },
    { t: `Date: ${r.dateBS}  (${r.dateAD})` },
    { t: '-'.repeat(38) },
    ...r.items.map(([name, amt]) => ({ t: name, right: amt.toFixed(2) })),
    { t: '-'.repeat(38) },
    r.vat ? { t: 'Sub Total', right: (r.total - r.vat).toFixed(2) } : null,
    r.vat ? { t: 'VAT 13%', right: r.vat.toFixed(2) } : null,
    { t: 'Grand Total', right: r.total.toLocaleString('en-IN', { minimumFractionDigits: 2 }), bold: true, size: 26 },
    { t: `Paid by: ${r.paidBy}` },
    { t: '' },
    { t: 'Thank you! Visit again', center: true },
  ].filter(Boolean);

  const W = 620;
  const H = 70 + lines.length * lineH;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1b1b1b';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = 45 + i * lineH;
    g.font = `${l.bold ? 'bold ' : ''}${l.size || 22}px "Courier New", monospace`;
    if (l.center) {
      g.textAlign = 'center';
      g.fillText(l.t, W / 2, y);
    } else {
      g.textAlign = 'left';
      g.fillText(l.t, 36, y);
    }
    if (l.right) {
      g.textAlign = 'right';
      g.fillText(l.right, W - 36, y);
    }
  });
  return c.toDataURL('image/png');
}

function receiptFor(spec) {
  return drawReceipt({
    merchant: spec.merchantName,
    address: spec.address,
    pan: spec.sellerPan,
    invoice: spec.invoiceNumber,
    dateAD: spec.billDateAD,
    dateBS: spec.billDateBS,
    items: spec.items,
    total: spec.totalAmount,
    vat: spec.vatAmount,
    paidBy: spec.paymentMethod === PAYMENT.DIGITAL ? 'Fonepay QR' : 'Cash',
  });
}

function specs(today) {
  const day = (n) => {
    const ad = addDaysAD(today, -n);
    return { billDateAD: ad, billDateBS: adToBs(ad) };
  };
  return [
    {
      // The main demo: an eligible cash bill, ready for "Apply to IRD Lucky Draw".
      merchantName: 'Annapurna Kirana Pasal', address: 'Baneshwor, Kathmandu', sellerPan: '609876543',
      invoiceNumber: 'AKP-2083-0457', ...day(0), totalAmount: 1356, vatAmount: 156,
      paymentMethod: PAYMENT.CASH, category: 'Groceries',
      items: [['Basmati Rice 5kg', 650], ['Masoor Dal 2kg', 380], ['Mustard Oil 1L', 170]],
    },
    {
      merchantName: 'Thamel Momo House', address: 'Thamel, Kathmandu', sellerPan: '604411223',
      invoiceNumber: 'TMH-8812', ...day(1), totalAmount: 840.5, vatAmount: 96.7,
      paymentMethod: PAYMENT.DIGITAL, category: 'Food & Dining',
      items: [['Buff Momo x2', 360], ['Veg Momo', 150], ['Gorkha Beer', 150], ['Lemon Tea x3', 83.8]],
    },
    {
      merchantName: 'Kathmandu Fashion Hub', address: 'New Road, Kathmandu', sellerPan: '602233445',
      invoiceNumber: 'KFH/83/1290', ...day(3), totalAmount: 3390, vatAmount: 390,
      paymentMethod: PAYMENT.CASH, category: 'Retail/Shopping', irdCoupon: '208307004512',
      items: [['Cotton Kurta', 1800], ['Dhaka Topi', 1200]],
    },
    {
      merchantName: 'Valley Telecom Recharge', address: 'Putalisadak, Kathmandu', sellerPan: '601122334',
      invoiceNumber: 'VTR-5521', ...day(2), totalAmount: 500, vatAmount: 57.52,
      paymentMethod: PAYMENT.CASH, category: 'Utilities & Telecom',
      items: [['Prepaid Data Pack', 442.48]],
    },
    {
      merchantName: 'Bhaktapur Chiya Pasal', address: 'Durbar Square, Bhaktapur', sellerPan: '',
      invoiceNumber: '42', ...day(4), totalAmount: 80, vatAmount: null,
      paymentMethod: PAYMENT.CASH, category: 'Food & Dining',
      items: [['Milk Tea x2', 50], ['Sel Roti', 30]],
    },
    {
      merchantName: 'Lalitpur Health Pharmacy', address: 'Pulchowk, Lalitpur', sellerPan: '605566778',
      invoiceNumber: 'LHP-0091', ...day(16), totalAmount: 1130, vatAmount: 130,
      paymentMethod: PAYMENT.CBMS, category: 'Other',
      items: [['Vitamin C 30 tabs', 600], ['First-aid kit', 400]],
    },
    {
      merchantName: 'Sajha Bus Ticket Counter', address: 'Lagankhel, Lalitpur', sellerPan: '600998877',
      invoiceNumber: 'SB-77310', ...day(6), totalAmount: 35, vatAmount: null,
      paymentMethod: PAYMENT.CASH, category: 'Transport',
      items: [['Bus fare', 35]],
    },
  ];
}

export async function buildSampleExpenses(today = todayAD()) {
  const out = [];
  for (const [i, s] of specs(today).entries()) {
    const { items, address, ...fields } = s;
    // Item rows from the receipt, so Split Khata has something to split straight away.
    const lineItems = items.map(([name, amount], k) => makeItem({ id: `sample-${i + 1}-item-${k + 1}`, name: name.replace(/\s+x\d+$/, ''), qty: Number(name.match(/x(\d+)$/)?.[1] || 1), amount }));
    const { dataUrl } = await compressImage(receiptFor(s));
    const now = new Date(Date.now() - i * 3600_000).toISOString();
    out.push(finalizeExpense({
      id: `sample-${i + 1}`,
      ...fields,
      irdCoupon: fields.irdCoupon || '',
      irdAppliedAt: fields.irdCoupon ? now : null,
      notes: '',
      receiptImage: dataUrl,
      lineItems,
      isNepalBill: true,
      isSample: true,
      ocrEngine: 'sample',
      createdAt: now,
    }));
  }
  return out;
}

/** A fresh receipt image (not saved) for trying the OCR flow. */
export function sampleReceiptForScan(today = todayAD()) {
  const ad = today;
  return receiptFor({
    merchantName: 'Himal Fresh Mart', address: 'Lakeside, Pokhara', sellerPan: '607788990',
    invoiceNumber: 'HFM-2083-1187', billDateAD: ad, billDateBS: adToBs(ad),
    totalAmount: 2034, vatAmount: 234, paymentMethod: PAYMENT.CASH,
    items: [['Apples 2kg', 700], ['Yak Cheese 500g', 850], ['Brown Bread', 250]],
  });
}
