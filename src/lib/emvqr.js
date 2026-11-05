// EMVCo merchant-presented QR (the format NepalQR / Fonepay / mobile-banking "receive money" QRs use):
// parse it and check its CRC, so a misread QR is flagged. Pure functions, unit-tested. Amounts are
// never written into a QR: banking apps ignore them on personal QRs, so the QR is shown as uploaded.
//
// Payload = TLV fields: 2-digit tag, 2-digit length (in characters), value.
// 00 = format "01" (first), 01 = "11" static / "12" dynamic, 53 = currency ("524" NPR),
// 54 = amount, 58 = country, 63 = CRC (always last, 4 hex chars, CRC-16/CCITT-FALSE over
// everything before it including "6304", as UTF-8 bytes).

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as 4 upper-case hex characters. */
export function crc16(str) {
  let c = 0xffff;
  for (const b of new TextEncoder().encode(str)) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

/** Splits a payload into [{ tag, value }]. Throws on anything that isn't clean TLV. */
export function parseTLV(s) {
  const out = [];
  let i = 0;
  const chars = [...String(s)]; // lengths count characters, not UTF-16 units
  while (i < chars.length) {
    const tag = chars.slice(i, i + 2).join('');
    const len = Number(chars.slice(i + 2, i + 4).join(''));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > chars.length) throw new Error('Not an EMVCo QR payload');
    out.push({ tag, value: chars.slice(i + 4, i + 4 + len).join('') });
    i += 4 + len;
  }
  return out;
}

/** True for a well-formed EMVCo payload whose CRC is correct. */
export function isValidEmv(s) {
  try {
    const fields = parseTLV(s);
    const last = fields.at(-1);
    return fields[0]?.tag === '00' && fields[0].value === '01' && last?.tag === '63' && last.value.length === 4
      && crc16(String(s).slice(0, -4)) === last.value.toUpperCase();
  } catch {
    return false;
  }
}

/** What kind of payment QR a decoded text is. */
export function qrKind(text = '') {
  if (isValidEmv(text)) return 'emv';
  if (/^000201/.test(text)) return 'emv-invalid';
  try { if ('eSewa_id' in JSON.parse(text)) return 'esewa'; } catch { /* not JSON */ }
  return text ? 'other' : '';
}
