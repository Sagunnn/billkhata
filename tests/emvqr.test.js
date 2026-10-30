import test from 'node:test';
import assert from 'node:assert/strict';
import { amountQrText, buildDynamicNepalQR, buildEsewaAmountQR, crc16, emvField, isValidEmv, parseTLV, qrKind, serializeTLV } from '../src/lib/emvqr.js';

// The worked example from the EMVCo Merchant-Presented QR specification (UTF-8 fields included).
const SPEC = '00020101021229300012D156000000000510A93FO3230Q31280012D15600000001030812345678520441115802CN5914BEST TRANSPORT6007BEIJING64200002ZH0104最佳运输0202北京540523.7253031565502016233030412340603***0708A60086670902ME91320016A0112233449988770708123456786304A13A';

/** A static NepalQR-style payload (made up account data), signed with a correct CRC. */
function staticNepalQr() {
  const account = serializeTLV([{ tag: '00', value: 'np.nepalqr.p2p' }, { tag: '01', value: 'NB0112345678' }]);
  const body = serializeTLV([
    { tag: '00', value: '01' }, { tag: '01', value: '11' }, { tag: '26', value: account }, { tag: '52', value: '4829' },
    { tag: '53', value: '524' }, { tag: '58', value: 'NP' }, { tag: '59', value: 'SAGUN PRADHAN' }, { tag: '60', value: 'KATHMANDU' },
  ]) + '6304';
  return body + crc16(body);
}

test('CRC-16/CCITT-FALSE check values', () => {
  assert.equal(crc16('123456789'), '29B1');
  assert.equal(crc16(SPEC.slice(0, -4)), 'A13A');
  assert.equal(isValidEmv(SPEC), true);
});

test('TLV lengths count characters (Chinese text in the spec example)', () => {
  const lang = parseTLV(SPEC).find((f) => f.tag === '64');
  assert.equal(lang.value, '0002ZH0104最佳运输0202北京');
});

test('buildDynamicNepalQR: tag 01 -> 12, tag 54 after 53, fresh CRC', () => {
  const base = staticNepalQr();
  assert.equal(isValidEmv(base), true);
  const dyn = buildDynamicNepalQR(base, 412.5);
  assert.equal(isValidEmv(dyn), true);
  assert.equal(emvField(dyn, '01'), '12');
  assert.equal(emvField(dyn, '54'), '412.50');
  assert.ok(dyn.includes('53035245406412.50'), 'amount right after currency');
  // Everything else is untouched.
  for (const tag of ['00', '26', '52', '53', '58', '59', '60']) assert.equal(emvField(dyn, tag), emvField(base, tag), tag);
  assert.equal(parseTLV(dyn).at(-1).tag, '63');
});

test('an existing amount is replaced, not duplicated', () => {
  const twice = buildDynamicNepalQR(buildDynamicNepalQR(staticNepalQr(), 100), 75.25);
  assert.equal(parseTLV(twice).filter((f) => f.tag === '54').length, 1);
  assert.equal(emvField(twice, '54'), '75.25');
  const spec = buildDynamicNepalQR(SPEC, 1);
  assert.equal(emvField(spec, '54'), '1.00');
  assert.equal(isValidEmv(spec), true);
});

test('a misread QR (bad CRC) is refused', () => {
  const bad = staticNepalQr().slice(0, -1) + '0';
  assert.equal(qrKind(bad), 'emv-invalid');
  assert.throws(() => buildDynamicNepalQR(bad, 10), /checksum/);
  assert.equal(amountQrText(bad, 10), null);
  assert.throws(() => buildDynamicNepalQR(staticNepalQr(), 0));
});

test('eSewa JSON gets an amount; other QR text gets none', () => {
  const t = '{"eSewa_id":"9800000000","name":"Sagun Pradhan"}';
  assert.deepEqual(JSON.parse(buildEsewaAmountQR(t, 412.5)), { eSewa_id: '9800000000', name: 'Sagun Pradhan', amount: '412.50' });
  assert.equal(qrKind(t), 'esewa');
  assert.equal(amountQrText('https://example.com/pay', 10), null);
  assert.equal(qrKind('https://example.com/pay'), 'other');
  assert.equal(amountQrText(staticNepalQr(), 0), null);
});
