// Auto-fill on a phone. A web app can't put code on prize.ird.gov.np, and phone browsers mostly
// can't run Tampermonkey, but they do run a bookmark whose address is the helper (a bookmarklet):
// from the bookmarks menu (Safari, Brave and Samsung Internet) or by typing its name into the
// address bar (Chrome). Pure (user agent in, steps out), so it's unit-tested.

export const FILL_BOOKMARK = 'BillKhata fill';

/**
 * @returns {{ id: string, setup: string[], use: string, note?: string, tampermonkey?: boolean, works: boolean, pasteBack?: boolean } | null}
 *   pasteBack: an iPhone home-screen app, whose bills Safari can't reach: the coupon comes back by
 *   copy and paste, not by the helper's Save button
 *   null on a computer (drag the bookmarklet or install the userscript instead)
 *   works: false when this browser can't run fill bookmarks (then: another browser, or copy fields)
 */
export function phoneFillHelp(ua = '', { brave = false, standalone = false } = {}) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
  const android = /Android/.test(ua);
  if (!ios && !android) return null;
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Viber|TikTok|Snapchat|\bLine\/|WhatsApp|Telegram/i.test(ua) || (android && /; wv\)/.test(ua));
  if (inApp) {
    return {
      id: 'in-app', works: false, setup: [], use: '',
      note: `This is an app’s own browser, which can’t keep bookmarks. Open BillKhata in ${ios ? 'Safari' : 'Chrome'} to set up auto-fill, or copy the fields one by one below.`,
    };
  }
  const paste = `Clear the address and paste what you copied (it starts with “javascript:”).`;
  const fromBookmarks = (where) => `On the IRD form, tap ${where} → “${FILL_BOOKMARK}”. It fills the form straight away.`;
  // A home-screen app has no browser buttons: the bookmark is added in the browser, and the portal
  // is opened there (the app's own window for other sites has no bookmarks).
  const browser = ios ? (brave ? 'Brave' : 'Safari') : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : brave ? 'Brave' : 'Chrome';
  const inBrowser = standalone ? `Open ${browser} (this app can’t add bookmarks) on any page. ` : '';
  const opened = standalone
    ? (ios ? `After Open portal & auto-fill, if the portal opens in a window inside BillKhata, tap the compass to move it to ${browser}. The bookmark works there.`
      : `After Open portal & auto-fill, if the portal opens in a window inside BillKhata, tap ⋮ → “Open in ${browser}”. The bookmark works there.`)
    : undefined;
  // iPhone: the home-screen app keeps its bills apart from Safari, so the coupon comes back by paste.
  const coupon = standalone && ios ? 'When the coupon appears, tap Copy in the BillKhata box, come back here and tap Paste 12-digit coupon.' : undefined;
  const notes = (...xs) => xs.filter(Boolean).join(' ') || undefined;

  if (ios && brave) {
    return {
      id: 'brave-ios', works: true, pasteBack: standalone, note: notes(opened, coupon),
      setup: [
        'Tap Copy below.',
        `${inBrowser}Tap ⋯ → “Add Bookmark”, name it “${FILL_BOOKMARK}” and save.`,
        `Open Bookmarks (the book icon), hold “${FILL_BOOKMARK}” → Edit. ${paste} Save.`,
      ],
      use: fromBookmarks('the book icon (Bookmarks)'),
    };
  }
  if (ios && /CriOS|FxiOS|EdgiOS/.test(ua)) {
    return {
      id: 'ios-other', works: false, setup: [], use: '',
      note: 'Chrome, Firefox and Edge on iPhone don’t run fill bookmarks. Open BillKhata in Safari to set it up there, or copy the fields one by one below.',
    };
  }
  if (ios) {
    return {
      id: 'ios-safari', works: true, pasteBack: standalone, note: notes(opened, coupon),
      setup: [
        'Tap Copy below.',
        `${inBrowser}Tap Share (the square with an arrow) → “Add Bookmark”. Name it “${FILL_BOOKMARK}” and tap Save.`,
        `${standalone ? 'Still in Safari, tap' : 'Tap'} the book icon → Bookmarks → Edit, then tap “${FILL_BOOKMARK}”. ${paste} Tap Done.`,
      ],
      use: fromBookmarks('the book icon'),
    };
  }
  if (/SamsungBrowser/.test(ua)) {
    return {
      id: 'samsung', works: true, note: opened,
      setup: [
        'Tap Copy below.',
        `${inBrowser}Tap the star (Add to bookmarks), then open Bookmarks, hold the new bookmark → Edit. Name it “${FILL_BOOKMARK}”. ${paste} Save.`,
      ],
      use: fromBookmarks('Bookmarks'),
    };
  }
  if (/Firefox\//.test(ua)) {
    return {
      id: 'android-firefox', works: true, tampermonkey: true, note: opened,
      setup: [
        `${inBrowser}Firefox for Android runs add-ons: tap ⋮ → Add-ons, find “Tampermonkey” and add it.`,
        'Then tap Install userscript below and press Install.',
      ],
      use: 'On the IRD form, the BillKhata box appears by itself; tap Fill the form.',
    };
  }
  // Chrome, Brave, Edge and other Chromium browsers on Android.
  return {
    id: brave ? 'brave-android' : 'android-chrome', works: true, note: opened,
    setup: [
      'Tap Copy below.',
      `${inBrowser}Tap ⋮ → the star to bookmark ${standalone ? 'it' : 'this page'}, then tap Edit at the bottom (or ⋮ → Bookmarks, ⋮ next to the new one → Edit). Name it “${FILL_BOOKMARK}”. ${paste} Go back to save.`,
    ],
    use: `On the IRD form, tap the address bar, type “billkhata” and tap the “${FILL_BOOKMARK}” suggestion with the star. It fills the form straight away.`,
  };
}
