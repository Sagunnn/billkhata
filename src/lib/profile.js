// User profile and app settings, kept in localStorage.
// API keys stay in this browser only: they are never put in backups.
import { OCR_ENGINES, REGIONS, VISION_PROVIDERS } from './constants.js';

const PROFILE_KEY = 'user_profile';
const SETTINGS_KEY = 'billkhata_settings';

export const EMPTY_PROFILE = {
  fullName: '',
  phone: '',
  address: '',
  pan: '',
  region: REGIONS.NEPAL,
};

export const DEFAULT_SETTINGS = {
  ocrEngine: OCR_ENGINES.LOCAL,
  nepaliScript: false,
  theme: 'system', // 'system' | 'light' | 'dark'
  showLuckyDraw: true, // the marigold lucky-draw strip on Home
  visionProvider: 'gemini',
  apiKeys: { gemini: '', openai: '', anthropic: '' },
  models: Object.fromEntries(Object.entries(VISION_PROVIDERS).map(([k, v]) => [k, v.defaultModel])),
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked; nothing else to do */
  }
}

export const loadProfile = () => ({ ...EMPTY_PROFILE, ...(read(PROFILE_KEY) || {}) });
export const saveProfile = (p) => write(PROFILE_KEY, p);
export const hasProfile = () => Boolean(read(PROFILE_KEY));

export function loadSettings() {
  const { tesseractNepali, ...s } = read(SETTINGS_KEY) || {};
  // Before PaddleOCR the on-device engine was Tesseract; carry those choices over.
  if (s.ocrEngine === 'tesseract') s.ocrEngine = OCR_ENGINES.LOCAL;
  if (s.nepaliScript == null && tesseractNepali != null) s.nepaliScript = Boolean(tesseractNepali);
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(s.apiKeys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) },
  };
}
export const saveSettings = (s) => write(SETTINGS_KEY, s);

export function flag(name, value) {
  const key = `billkhata_${name}`;
  try {
    if (value === undefined) return localStorage.getItem(key) === '1';
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    return false;
  }
  return value;
}

/** Returns a map of field -> error message (empty when valid). */
export function validateProfile(p) {
  const errors = {};
  const name = String(p.fullName || '').trim();
  if (name.length < 2 || name.length > 120) errors.fullName = 'Name must be 2–120 characters.';
  if (!/^9[78]\d{8}$/.test(String(p.phone || '').trim())) errors.phone = 'Use a 10-digit mobile number starting with 98 or 97.';
  const addr = String(p.address || '').trim();
  if (addr.length < 5 || addr.length > 250) errors.address = 'Address must be 5–250 characters.';
  if (p.pan && !/^\d{9}$/.test(String(p.pan).trim())) errors.pan = 'PAN must be exactly 9 digits.';
  if (![REGIONS.NEPAL, REGIONS.INTL].includes(p.region)) errors.region = 'Pick a region.';
  return errors;
}

/* ---------- Split Khata: payment QR and saved friends ---------- */

const QR_KEY = 'billkhata_payment_qr';
const FRIENDS_KEY = 'billkhata_friends';
const GROUPS_KEY = 'billkhata_groups';
export const MAX_QR_IMAGE_BYTES = 100 * 1024;

/**
 * How friends pay you back:
 * - { mode: 'esewa', esewaId, name } builds an eSewa personal QR from your profile
 * - { mode: 'image', image, text, label } is your own bank / Fonepay / eSewa / Khalti QR photo;
 *   `text` is what the QR decodes to (empty if it couldn't be read), so links can carry it
 */
export function loadPaymentQr() {
  return read(QR_KEY) || { mode: '' };
}
export const savePaymentQr = (q) => write(QR_KEY, q);

/** Frequent friends: [{ name, diet: 'veg'|'non-veg', alcohol }] */
export const loadFriends = () => (Array.isArray(read(FRIENDS_KEY)) ? read(FRIENDS_KEY) : []);
export function rememberFriends(members) {
  const byName = new Map(loadFriends().map((f) => [f.name.toLowerCase(), f]));
  members.filter((m) => !m.isPayer && m.name.trim()).forEach((m) => byName.set(m.name.trim().toLowerCase(), { name: m.name.trim(), diet: m.diet, alcohol: m.alcohol, gender: m.gender || '', look: m.look || 0 }));
  write(FRIENDS_KEY, [...byName.values()].slice(-60));
}
export const forgetFriend = (name) => write(FRIENDS_KEY, loadFriends().filter((f) => f.name.toLowerCase() !== String(name).toLowerCase()));

/** Saved groups: [{ id, name, members: [{ name, diet, alcohol }] }] (tidied by groups.js). */
export const loadGroups = () => (Array.isArray(read(GROUPS_KEY)) ? read(GROUPS_KEY) : []);
export const saveGroups = (list) => write(GROUPS_KEY, list.slice(-20));

/* ---------- your pixel face (splits and trips) ---------- */

const AVATAR_KEY = 'billkhata_my_avatar';
/** Your face: { gender: ''|'m'|'f', look }. */
export function loadMyAvatar() {
  const v = read(AVATAR_KEY) || {};
  return { gender: v.gender === 'm' || v.gender === 'f' ? v.gender : '', look: Number(v.look) || 0 };
}
export function saveMyAvatar(v) {
  write(AVATAR_KEY, { gender: v.gender || '', look: Number(v.look) || 0 });
  try { window.dispatchEvent(new Event('billkhata-avatar')); } catch { /* not in a browser */ }
}

/* ---------- deleted trips ---------- */

const DELETED_TRIPS_KEY = 'billkhata_deleted_trips';

/**
 * Trips deleted on this device: { tripId: deletedAt }. An older copy of a deleted trip (a second
 * open copy of the app, a backup, a file) must not bring it back by itself.
 */
export function loadDeletedTrips() {
  const v = read(DELETED_TRIPS_KEY);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
export function rememberDeletedTrip(id, at = new Date().toISOString()) {
  write(DELETED_TRIPS_KEY, { ...loadDeletedTrips(), [id]: at });
}
/** The trip was brought back on purpose (opened from a friend's file, restored over everything). */
export function forgetDeletedTrips(ids = []) {
  const all = loadDeletedTrips();
  ids.forEach((id) => delete all[id]);
  write(DELETED_TRIPS_KEY, all);
}

/* ---------- the rest of a backup ---------- */

const RECEIVED_KEY = 'billkhata_received_splits';

/**
 * What a backup carries besides bills, trips and bank data: settings (never API keys), your
 * payment QR, saved friends and groups, splits friends sent, and trips deleted here.
 */
export function backupExtras() {
  const { apiKeys: _keys, ...settings } = loadSettings();
  return {
    settings,
    paymentQr: loadPaymentQr(),
    friends: loadFriends(),
    groups: loadGroups(),
    receivedSplits: Array.isArray(read(RECEIVED_KEY)) ? read(RECEIVED_KEY) : [],
    deletedTrips: loadDeletedTrips(),
    myAvatar: loadMyAvatar(),
  };
}

const byKey = (list, key) => [...new Map(list.filter(Boolean).map((x) => [key(x), x])).values()];

/**
 * Puts a backup's extras back. 'merge' adds friends, groups, received splits and deleted trips to
 * what's here and keeps this device's settings and QR (the QR only when none is set);
 * 'overwrite' replaces them. API keys on this device are always kept.
 * @returns the settings to apply, or null to keep the current ones
 */
export function restoreExtras(x, mode = 'merge') {
  if (!x) return null;
  const name = (v) => String(v?.name || '').toLowerCase();
  const over = mode === 'overwrite';
  if (x.friends) write(FRIENDS_KEY, (over ? x.friends : byKey([...x.friends, ...loadFriends()], name)).slice(-60));
  if (x.groups) write(GROUPS_KEY, (over ? x.groups : byKey([...x.groups, ...loadGroups()], name)).slice(-20));
  if (x.receivedSplits) {
    const here = Array.isArray(read(RECEIVED_KEY)) ? read(RECEIVED_KEY) : [];
    write(RECEIVED_KEY, (over ? x.receivedSplits : byKey([...x.receivedSplits, ...here], (s) => s?.id || JSON.stringify(s))).slice(-50));
    try { window.dispatchEvent(new Event('billkhata-received')); } catch { /* not in a browser */ }
  }
  if (x.paymentQr?.mode && (over || !loadPaymentQr().mode)) savePaymentQr(x.paymentQr);
  // Your pixel face: from the backup when this device has none yet (or everything is replaced).
  const mine = loadMyAvatar();
  if (x.myAvatar && (over || (!mine.gender && !mine.look))) saveMyAvatar(x.myAvatar);
  if (x.deletedTrips) write(DELETED_TRIPS_KEY, over ? x.deletedTrips : { ...x.deletedTrips, ...loadDeletedTrips() });
  if (!over || !x.settings) return null;
  const { apiKeys: _ignored, ...settings } = x.settings;
  return { ...settings, apiKeys: loadSettings().apiKeys };
}
