import test from 'node:test';
import assert from 'node:assert/strict';

// profile.js keeps these in localStorage; a Map stands in for it.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const profile = await import('../src/lib/profile.js');
const { buildBackup, validateBackup } = await import('../src/lib/backup.js');

const reset = () => store.clear();

test('a backup carries settings (never API keys), payment QR, friends, groups and deleted trips', () => {
  reset();
  profile.saveSettings({ ...profile.DEFAULT_SETTINGS, theme: 'dark', apiKeys: { gemini: 'AIza-secret', openai: '', anthropic: '' } });
  profile.savePaymentQr({ mode: 'esewa', esewaId: '9800000000', name: 'Ram' });
  profile.rememberFriends([{ name: 'Sita', diet: 'veg', alcohol: false }]);
  profile.saveGroups([{ name: 'Office', members: [{ name: 'Hari', diet: 'non-veg', alcohol: true }] }]);
  profile.rememberDeletedTrip('t1', '2026-11-01T00:00:00Z');
  const file = JSON.parse(JSON.stringify(buildBackup({}, [], [], {}, profile.backupExtras())));
  assert.ok(!JSON.stringify(file).includes('AIza-secret'), 'API keys stay on the device');
  const { extras } = validateBackup(file);
  assert.equal(extras.settings.theme, 'dark');
  assert.equal(extras.paymentQr.esewaId, '9800000000');
  assert.deepEqual(extras.friends.map((f) => f.name), ['Sita']);
  assert.deepEqual(extras.groups.map((g) => g.name), ['Office']);
  assert.deepEqual(extras.deletedTrips, { t1: '2026-11-01T00:00:00Z' });

  // A new phone: overwrite brings it all back, and keeps that phone's own API key.
  reset();
  profile.saveSettings({ ...profile.DEFAULT_SETTINGS, apiKeys: { gemini: 'AIza-this-phone', openai: '', anthropic: '' } });
  const settings = profile.restoreExtras(extras, 'overwrite');
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.apiKeys.gemini, 'AIza-this-phone');
  assert.equal(profile.loadPaymentQr().mode, 'esewa');
  assert.equal(profile.loadFriends()[0].name, 'Sita');
  assert.ok(profile.loadDeletedTrips().t1);
});

test('merge adds friends and keeps this device’s settings and QR', () => {
  reset();
  profile.savePaymentQr({ mode: 'image', image: 'data:image/png;base64,AAAA', text: '', label: 'Mine' });
  profile.rememberFriends([{ name: 'Gita', diet: 'veg', alcohol: false }]);
  const back = profile.restoreExtras({ settings: { theme: 'light' }, paymentQr: { mode: 'esewa', esewaId: '9811111111' }, friends: [{ name: 'Sita' }, { name: 'gita' }] }, 'merge');
  assert.equal(back, null, 'settings stay');
  assert.equal(profile.loadPaymentQr().label, 'Mine');
  assert.deepEqual(profile.loadFriends().map((f) => f.name).sort(), ['Gita', 'Sita']);
});

test('older backups without extras still restore; bad parts are left out', () => {
  assert.equal(validateBackup({ version: 1, expenses: [] }).extras, null);
  const { extras } = validateBackup({ version: 1, expenses: [], extras: { paymentQr: { mode: 'image', image: 'javascript:alert(1)' }, friends: [{ name: '' }, 5, { name: 'Ok' }], settings: { theme: 'dark', apiKeys: { gemini: 'x' } } } });
  assert.equal(extras.paymentQr, undefined);
  assert.deepEqual(extras.friends, [{ name: 'Ok' }]);
  assert.deepEqual(extras.settings, { theme: 'dark' });
});

test('deleted trips are remembered and can be brought back on purpose', () => {
  reset();
  profile.rememberDeletedTrip('a');
  profile.rememberDeletedTrip('b');
  profile.forgetDeletedTrips(['a']);
  assert.deepEqual(Object.keys(profile.loadDeletedTrips()), ['b']);
});
