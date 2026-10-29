// Bikram Sambat (BS) <-> Gregorian (AD) conversion and IRD draw-window helpers.
// All dates are plain 'YYYY-MM-DD' strings so they sort and compare as text.
import { BS_EPOCH_AD, BS_MONTH_DAYS, BS_START_YEAR } from './bsCalendar.js';

const DAY_MS = 86400000;

export const BS_MONTHS = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

export const BS_MIN_YEAR = BS_START_YEAR;
export const BS_MAX_YEAR = BS_START_YEAR + BS_MONTH_DAYS.length - 1;

const pad = (n) => String(n).padStart(2, '0');
const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

export function parseYmd(str) {
  const m = DATE_RE.exec(String(str ?? '').trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Today's date in the browser's local time zone, as YYYY-MM-DD. */
export function todayAD(now = new Date()) {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isValidAD(str) {
  const p = parseYmd(str);
  if (!p) return false;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return t.getUTCFullYear() === p.y && t.getUTCMonth() === p.m - 1 && t.getUTCDate() === p.d;
}

export function bsDaysInMonth(y, m) {
  const row = BS_MONTH_DAYS[y - BS_START_YEAR];
  return row ? row[m - 1] : 0;
}

export function isValidBS(str) {
  const p = parseYmd(str);
  if (!p || p.y < BS_MIN_YEAR || p.y > BS_MAX_YEAR || p.m < 1 || p.m > 12) return false;
  return p.d >= 1 && p.d <= bsDaysInMonth(p.y, p.m);
}

/** 'YYYY-MM-DD' AD -> 'YYYY-MM-DD' BS, or null when out of range / invalid. */
export function adToBs(adStr) {
  if (!isValidAD(adStr)) return null;
  const p = parseYmd(adStr);
  let days = Math.round((Date.UTC(p.y, p.m - 1, p.d) - BS_EPOCH_AD) / DAY_MS);
  if (days < 0) return null;
  for (let yi = 0; yi < BS_MONTH_DAYS.length; yi++) {
    for (let mi = 0; mi < 12; mi++) {
      const len = BS_MONTH_DAYS[yi][mi];
      if (days < len) return ymd(BS_START_YEAR + yi, mi + 1, days + 1);
      days -= len;
    }
  }
  return null;
}

/** 'YYYY-MM-DD' BS -> 'YYYY-MM-DD' AD, or null when out of range / invalid. */
export function bsToAd(bsStr) {
  if (!isValidBS(bsStr)) return null;
  const p = parseYmd(bsStr);
  let days = 0;
  for (let yi = 0; yi < p.y - BS_START_YEAR; yi++) {
    for (const len of BS_MONTH_DAYS[yi]) days += len;
  }
  for (let mi = 0; mi < p.m - 1; mi++) days += BS_MONTH_DAYS[p.y - BS_START_YEAR][mi];
  days += p.d - 1;
  const t = new Date(BS_EPOCH_AD + days * DAY_MS);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function todayBS(now = new Date()) {
  return adToBs(todayAD(now));
}

/** '2083-07-12' -> '12 Kartik 2083' */
export function formatBS(bsStr) {
  const p = parseYmd(bsStr);
  if (!p || !isValidBS(bsStr)) return '';
  return `${p.d} ${BS_MONTHS[p.m - 1]} ${p.y}`;
}

/** '2026-10-29' -> '29 Oct 2026' */
export function formatAD(adStr) {
  const p = parseYmd(adStr);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function addDaysAD(adStr, n) {
  const p = parseYmd(adStr);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * DAY_MS);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The IRD lucky draw runs on fortnights of the Nepali month: days 1-15 and 16-end.
 * Returns the window that contains the given BS date.
 */
export function drawWindowFor(bsStr) {
  const p = parseYmd(bsStr);
  if (!p || !isValidBS(bsStr)) return null;
  const last = bsDaysInMonth(p.y, p.m);
  const firstHalf = p.d <= 15;
  const startDay = firstHalf ? 1 : 16;
  const endDay = firstHalf ? 15 : last;
  const startBS = ymd(p.y, p.m, startDay);
  const endBS = ymd(p.y, p.m, endDay);
  return {
    startBS,
    endBS,
    startAD: bsToAd(startBS),
    endAD: bsToAd(endBS),
    daysLeft: endDay - p.d,
    label: `${BS_MONTHS[p.m - 1]} ${startDay}–${endDay}, ${p.y}`,
  };
}

/** Converts Devanagari digits (०-९) to ASCII digits. */
export function toAsciiDigits(str) {
  return String(str ?? '').replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966));
}
