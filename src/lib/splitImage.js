// "Download Split Summary Image": one PNG with everyone's share and the payer's QR,
// sized for chat apps (Viber, WhatsApp, Messenger). Drawn with canvas; nothing is uploaded.
import { qrDataUrl, loadImage } from './qr.js';
import { formatAD, formatBS } from './nepaliDate.js';

const W = 1080;
const PAD = 56;
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const BRAND = '#b91c1c';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif';

const npr = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fit(g, text, max) {
  let s = String(text);
  if (g.measureText(s).width <= max) return s;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Shares are drawn per member: name and amount, then each item line, then the VAT/SC line. */
function layout(result) {
  let h = 0;
  for (const m of result.members.filter((r) => !r.out)) h += 64 + m.lines.length * 34 + (m.lines.length && Math.abs(m.extra) >= 0.01 ? 34 : 0) + 24;
  return h;
}

/**
 * @returns {Promise<Blob>} PNG
 */
export async function drawSplitSummary({ split, result, payer = {} }) {
  const qrH = payer.qrText || payer.qrImage ? 420 : 0;
  const H = 300 + layout(result) + (result.unassigned ? 50 : 0) + qrH + 90;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = BRAND;
  g.fillRect(0, 0, W, 10);

  // Header
  let y = 84;
  g.fillStyle = MUTED;
  g.font = `600 26px ${FONT}`;
  g.fillText('BillKhata · Split bill', PAD, y);
  y += 56;
  g.fillStyle = INK;
  g.font = `800 50px ${FONT}`;
  g.fillText(fit(g, split.title || 'Bill', W - 2 * PAD), PAD, y);
  y += 46;
  g.font = `400 28px ${FONT}`;
  g.fillStyle = MUTED;
  const when = [formatAD(split.dateAD), split.dateBS ? `${formatBS(split.dateBS)} BS` : ''].filter(Boolean).join(' · ');
  const people = result.members.filter((r) => !r.out).length;
  g.fillText(`${when}${when ? ' · ' : ''}${people} people${split.mode === 'equal' ? ' · split equally' : ''}`, PAD, y);
  y += 54;
  g.fillStyle = INK;
  g.font = `700 32px ${FONT}`;
  g.fillText(`Bill total ${npr(result.total)}`, PAD, y);
  if (split.mode !== 'equal' && Math.abs(result.extra) >= 0.01) {
    g.font = `400 26px ${FONT}`;
    g.fillStyle = MUTED;
    const label = result.extra > 0 ? 'VAT / service charge' : 'discount';
    g.textAlign = 'right';
    g.fillText(`items ${npr(result.itemsSubtotal)} · ${label} ${result.extra > 0 ? '+' : ''}${(result.extraPct * 100).toFixed(1)}%`, W - PAD, y);
    g.textAlign = 'left';
  }
  y += 36;

  // Members (people left out of the split aren't shown)
  for (const m of result.members.filter((r) => !r.out)) {
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(PAD, y);
    g.lineTo(W - PAD, y);
    g.stroke();
    y += 48;
    g.fillStyle = INK;
    g.font = `800 36px ${FONT}`;
    g.fillText(fit(g, `${m.name}${m.isPayer ? ' (paid)' : ''}`, W - 2 * PAD - 300), PAD, y);
    g.textAlign = 'right';
    g.fillStyle = m.isPayer ? MUTED : BRAND;
    g.fillText(npr(m.share), W - PAD, y);
    g.textAlign = 'left';
    y += 16;
    g.font = `400 26px ${FONT}`;
    for (const l of m.lines) {
      y += 34;
      g.fillStyle = '#334155';
      const portion = l.of > 1 || l.weight > 1 ? `  (${l.weight}/${l.of})` : '';
      g.fillText(fit(g, `${l.name}${portion}`, W - 2 * PAD - 260), PAD + 24, y);
      g.textAlign = 'right';
      g.fillText(npr(l.amount), W - PAD, y);
      g.textAlign = 'left';
    }
    if (m.lines.length && Math.abs(m.extra) >= 0.01) {
      y += 34;
      g.fillStyle = MUTED;
      g.fillText(m.extra > 0 ? 'VAT / service charge share' : 'Discount share', PAD + 24, y);
      g.textAlign = 'right';
      g.fillText(`${m.extra > 0 ? '+' : '−'}${npr(Math.abs(m.extra))}`, W - PAD, y);
      g.textAlign = 'left';
    }
    y += 24;
  }
  if (result.unassigned) {
    y += 40;
    g.fillStyle = '#92400e';
    g.font = `600 26px ${FONT}`;
    g.fillText(`Not assigned to anyone yet: ${npr(result.unassigned)}`, PAD, y);
  }

  // Payment QR
  if (qrH) {
    y += 40;
    g.fillStyle = '#f8fafc';
    g.fillRect(PAD, y, W - 2 * PAD, qrH - 40);
    const qrSize = qrH - 100;
    const src = payer.qrText ? await qrDataUrl(payer.qrText, qrSize * 2) : payer.qrImage;
    const img = await loadImage(src);
    const scale = Math.min(qrSize / img.width, qrSize / img.height);
    g.drawImage(img, PAD + 30, y + 30, img.width * scale, img.height * scale);
    const tx = PAD + 30 + qrSize + 40;
    g.fillStyle = INK;
    g.font = `800 38px ${FONT}`;
    g.fillText(fit(g, `Pay ${payer.name || 'me'}`, W - PAD - tx - 20), tx, y + 100);
    g.font = `400 28px ${FONT}`;
    g.fillStyle = MUTED;
    g.fillText(fit(g, payer.qrLabel || 'Scan to pay', W - PAD - tx - 20), tx, y + 148);
    const esewa = /^eSewa/.test(payer.qrLabel || '');
    g.fillText(esewa ? 'Scan with the eSewa app.' : 'Scan with your banking', tx, y + 210);
    if (!esewa) g.fillText('or wallet app.', tx, y + 248);
    y += qrH - 40;
  }

  g.fillStyle = MUTED;
  g.font = `400 22px ${FONT}`;
  g.fillText('Made with BillKhata · expense.sagunpradhan.com.np', PAD, H - 36);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}
