// Add-to-home-screen help for the browser the app is open in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installHelp } from '../src/lib/install.js';

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iosInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 336.0.3.18.99',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
  androidMessenger: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/468.0.0.43.109;]',
  androidWebView: 'Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

test('each browser gets its own steps', () => {
  assert.equal(installHelp(UA.iosSafari).id, 'ios-safari');
  assert.match(installHelp(UA.iosSafari).steps.join(' '), /Share.*Add to Home Screen/);
  assert.equal(installHelp(UA.iosChrome).id, 'ios-other');
  assert.equal(installHelp(UA.androidChrome).id, 'android-chrome');
  assert.equal(installHelp(UA.samsung).id, 'samsung');
  assert.equal(installHelp(UA.macChrome).id, 'desktop-chrome');
  assert.equal(installHelp(UA.macSafari).id, 'mac-safari');
});

test('in-app browsers (Instagram, Messenger, a WebView) say to open Safari or Chrome first', () => {
  assert.deepEqual([installHelp(UA.iosInstagram).id, installHelp(UA.iosInstagram).inApp], ['in-app', 'Instagram']);
  assert.match(installHelp(UA.iosInstagram).title, /Safari/);
  assert.equal(installHelp(UA.androidMessenger).id, 'in-app');
  assert.match(installHelp(UA.androidMessenger).title, /Chrome/);
  assert.equal(installHelp(UA.androidWebView).inApp, 'this app');
});
