import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneFillHelp } from '../src/lib/phoneFill.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  messenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0]',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
};

test('each phone browser gets its own way to run the fill bookmark', () => {
  assert.equal(phoneFillHelp(UA.mac), null, 'a computer uses the bookmarks bar or Tampermonkey');
  const safari = phoneFillHelp(UA.iphone);
  assert.equal(safari.id, 'ios-safari');
  assert.ok(safari.works && /book icon/.test(safari.use));
  assert.equal(phoneFillHelp(UA.iphone, { brave: true }).id, 'brave-ios');
  assert.equal(phoneFillHelp(UA.chromeIos).works, false);
  const chrome = phoneFillHelp(UA.android);
  assert.equal(chrome.id, 'android-chrome');
  assert.match(chrome.use, /type “billkhata”/);
  assert.equal(phoneFillHelp(UA.android, { brave: true }).id, 'brave-android');
  assert.equal(phoneFillHelp(UA.samsung).id, 'samsung');
  assert.ok(phoneFillHelp(UA.firefox).tampermonkey);
  assert.equal(phoneFillHelp(UA.messenger).id, 'in-app');
});

test('from the home-screen app, open the portal in the browser first', () => {
  assert.match(phoneFillHelp(UA.iphone, { standalone: true }).note, /Open in Safari/);
  assert.match(phoneFillHelp(UA.android, { standalone: true }).note, /Open in Chrome/);
  assert.equal(phoneFillHelp(UA.iphone).note, undefined);
});
