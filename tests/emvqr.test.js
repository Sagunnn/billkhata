import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16, isValidEmv, parseTLV, qrKind } from '../src/lib/emvqr.js';

// The worked example from the EMVCo Merchant-Presented QR specification (UTF-8 fields included).
const SPEC = '00020101021229300012D156000000000510A93FO3230Q31280012D15600000001030812345678520441115802CN5914BEST TRANSPORT6007BEIJING64200002ZH0104最佳运输0202北京540523.7253031565502016233030412340603***0708A60086670902ME91320016A0112233449988770708123456786304A13A';

const tlv = (fields) => fields.map(({ tag, value }) => `${tag}${String([...value].length).padStart(2, '0')}${value}`).join('');

/** A static NepalQR-style payload (made-up account data), signed with a correct CRC. */
function staticNepalQr() {
  const account = tlv([{ tag: '00', value: 'np.nepalqr.p2p' }, { tag: '01', value: 'NB0112345678' }]);
  const body = tlv([
    { tag: '00', value: '01' }, { tag: '01', value: '11' }, { tag: '26', value: account }, { tag: '52', value: '4829' },
    { tag: '53', value: '524' }, { tag: '58', value: 'NP' }, { tag: '59', value: 'RAM BAHADUR' }, { tag: '60', value: 'KATHMANDU' },
  ]) + '6304';
  return body + crc16(body);
}

test('CRC-16/CCITT-FALSE check values', () => {
  assert.equal(crc16('123456789'), '29B1');
  assert.equal(crc16(SPEC.slice(0, -4)), 'A13A');
  assert.equal(isValidEmv(SPEC), true);
  assert.equal(isValidEmv(staticNepalQr()), true);
});

test('TLV lengths count characters (Chinese text in the spec example)', () => {
  const lang = parseTLV(SPEC).find((f) => f.tag === '64');
  assert.equal(lang.value, '0002ZH0104最佳运输0202北京');
});

test('a misread QR (bad CRC) is flagged; eSewa JSON and other text are told apart', () => {
  assert.equal(qrKind(staticNepalQr()), 'emv');
  assert.equal(qrKind(staticNepalQr().slice(0, -1) + '0'), 'emv-invalid');
  assert.equal(qrKind('{"eSewa_id":"9800000000","name":"Ram Bahadur"}'), 'esewa');
  assert.equal(qrKind('https://example.com/pay'), 'other');
  assert.equal(qrKind(''), '');
});

test('who a payment QR pays, as the QR says', async () => {
  const { qrPayee } = await import('../src/lib/emvqr.js');
  assert.equal(qrPayee(staticNepalQr()), 'RAM BAHADUR');
  assert.equal(qrPayee(SPEC), 'BEST TRANSPORT');
  assert.equal(qrPayee('{"eSewa_id":"9800000000","name":"Sita Sharma"}'), 'Sita Sharma · eSewa 9800000000');
  assert.equal(qrPayee('hello'), '');
  assert.equal(qrPayee(''), '');
});
