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
  ocrEngine: OCR_ENGINES.TESSERACT,
  tesseractNepali: false,
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
  const s = read(SETTINGS_KEY) || {};
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
  members.filter((m) => !m.isPayer && m.name.trim()).forEach((m) => byName.set(m.name.trim().toLowerCase(), { name: m.name.trim(), diet: m.diet, alcohol: m.alcohol }));
  write(FRIENDS_KEY, [...byName.values()].slice(-60));
}
export const forgetFriend = (name) => write(FRIENDS_KEY, loadFriends().filter((f) => f.name.toLowerCase() !== String(name).toLowerCase()));

/** Saved groups: [{ name, members: [{ name, diet, alcohol }] }] */
export const loadGroups = () => (Array.isArray(read(GROUPS_KEY)) ? read(GROUPS_KEY) : []);
export function saveGroup(name, members) {
  const group = { name: String(name).trim(), members: members.filter((m) => !m.isPayer).map((m) => ({ name: m.name, diet: m.diet, alcohol: m.alcohol })) };
  write(GROUPS_KEY, [...loadGroups().filter((g) => g.name.toLowerCase() !== group.name.toLowerCase()), group].slice(-20));
}
export const deleteGroup = (name) => write(GROUPS_KEY, loadGroups().filter((g) => g.name.toLowerCase() !== String(name).toLowerCase()));
