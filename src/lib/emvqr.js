// EMVCo merchant-presented QR (the format NepalQR / Fonepay / mobile-banking "receive money" QRs use):
// parse, add an amount, and re-sign with the CRC. Pure functions, unit-tested.
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

export const computeEMVCoCRC16 = crc16;

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

export function serializeTLV(fields) {
  return fields.map(({ tag, value }) => {
    const n = [...value].length;
    if (n > 99) throw new Error(`EMVCo field ${tag} is too long`);
    return `${tag}${String(n).padStart(2, '0')}${value}`;
  }).join('');
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

/** 412.5 -> "412.50". EMVCo allows up to 13 characters with "." as the decimal mark. */
export function emvAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Amount must be more than zero');
  const s = n.toFixed(2);
  if (s.length > 13) throw new Error('Amount is too large for a QR');
  return s;
}

/**
 * The same QR with the amount filled in: tag 01 -> "12" (dynamic), tag 54 -> amount (placed in
 * tag order, right after 53 currency), then a fresh tag 63 CRC. Refuses a payload whose own CRC
 * is wrong, so a misread QR never turns into a payable one.
 */
export function buildDynamicNepalQR(baseEmvString, amountNPR) {
  if (!isValidEmv(baseEmvString)) throw new Error('This QR isn’t a valid EMVCo / NepalQR code (bad checksum)');
  const fields = parseTLV(baseEmvString).filter((f) => f.tag !== '63' && f.tag !== '54');
  const poi = fields.find((f) => f.tag === '01');
  if (poi) poi.value = '12';
  else fields.splice(1, 0, { tag: '01', value: '12' });
  const at = fields.findIndex((f) => f.tag > '54');
  fields.splice(at < 0 ? fields.length : at, 0, { tag: '54', value: emvAmount(amountNPR) });
  const body = `${serializeTLV(fields)}6304`;
  return body + crc16(body);
}

/** Reads tag values for display/tests, e.g. emvField(payload, '54'). */
export function emvField(payload, tag) {
  try { return parseTLV(payload).find((f) => f.tag === tag)?.value ?? ''; } catch { return ''; }
}

/** eSewa personal QR JSON with the amount added, or null if the text isn't that JSON. */
export function buildEsewaAmountQR(text, amountNPR) {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || !('eSewa_id' in obj)) return null;
    return JSON.stringify({ ...obj, amount: emvAmount(amountNPR) });
  } catch {
    return null;
  }
}

/** What kind of payment QR a decoded text is. */
export function qrKind(text = '') {
  if (isValidEmv(text)) return 'emv';
  if (/^000201/.test(text)) return 'emv-invalid';
  try { if ('eSewa_id' in JSON.parse(text)) return 'esewa'; } catch { /* not JSON */ }
  return text ? 'other' : '';
}

/**
 * QR text for one person's share: EMVCo/NepalQR gets tag 54, eSewa JSON gets "amount".
 * Anything else (or a bad checksum) gets null, and the plain QR is used with the amount shown.
 */
export function amountQrText(text, amountNPR) {
  if (!(Number(amountNPR) > 0)) return null;
  const kind = qrKind(text);
  if (kind === 'emv') return buildDynamicNepalQR(text, amountNPR);
  if (kind === 'esewa') return buildEsewaAmountQR(text, amountNPR);
  return null;
}
