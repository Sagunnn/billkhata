import { REGIONS } from './constants.js';

/** Nepal uses lakh grouping (1,23,456); en-IN gives that. */
export function money(n, region = REGIONS.NEPAL, { symbol = true, decimals } = {}) {
  const v = Number(n) || 0;
  const d = decimals ?? (Number.isInteger(v) ? 0 : 2);
  const s = v.toLocaleString(region === REGIONS.NEPAL ? 'en-IN' : 'en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  if (!symbol) return s;
  return region === REGIONS.NEPAL ? `रु ${s}` : s;
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
