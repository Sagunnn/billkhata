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
