// Light or dark: the setting ('system' follows the phone), applied as data-theme on <html>.
// index.html applies it before the first paint too, so there is no flash.
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(choice = 'system') {
  if (choice === 'light' || choice === 'dark') return choice;
  return media?.matches ? 'dark' : 'light';
}

let current = 'system';
export function applyTheme(choice = 'system') {
  current = choice;
  const theme = resolveTheme(choice);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14120f' : '#f6f1e9');
  try { localStorage.setItem('billkhata_theme', choice); } catch { /* ignore */ }
}

media?.addEventListener?.('change', () => { if (current === 'system') applyTheme('system'); });
