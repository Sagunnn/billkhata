// How to put BillKhata on the home screen, for the browser it's open in. Pure (user agent in, steps
// out), so it's unit-tested. Browsers don't let a page add itself, except Chrome-like ones through
// their own "Install" prompt, so most people need these steps.

const IN_APP = [
  ['Messenger', /Messenger|Orca-Android|FB_IAB\/MESSENGER/i], ['Facebook', /FBAN|FBAV|FB_IAB/], ['Instagram', /Instagram/],
  ['Viber', /Viber/i], ['TikTok', /TikTok|musical_ly|Bytedance/i], ['Snapchat', /Snapchat/i], ['LINE', /\bLine\//],
  ['WhatsApp', /WhatsApp/i], ['Gmail', /GSA\/|Gmail/i], ['Telegram', /Telegram/i],
];

/**
 * @returns {{ id: string, title: string, steps: string[], note?: string, inApp?: string }}
 *   id: 'ios-safari' | 'ios-other' | 'in-app' | 'android-chrome' | 'samsung' | 'android-firefox' |
 *       'desktop-chrome' | 'mac-safari' | 'other'
 */
export function installHelp(ua = '') {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
  const android = /Android/.test(ua);
  const app = IN_APP.find(([, re]) => re.test(ua))?.[0] || (android && /; wv\)/.test(ua) ? 'this app' : '');
  if (app) {
    return {
      id: 'in-app', inApp: app,
      title: `Open BillKhata in ${ios ? 'Safari' : 'Chrome'} first`,
      steps: [
        `You’re in ${app}’s own browser, which can’t add apps to the home screen.`,
        `Tap the ${ios ? '⋯ or the compass' : '⋮'} button and choose “Open in ${ios ? 'Safari' : 'Chrome'}” (or copy the link below and paste it there).`,
        'Then open this guide again: Settings → Add to home screen.',
      ],
    };
  }
  if (ios) {
    const safari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
    if (safari) {
      return {
        id: 'ios-safari', title: 'Add to your iPhone’s home screen',
        steps: [
          'Tap the Share button (a square with an arrow up) in the bar at the bottom of Safari. On iPad it’s at the top.',
          'Scroll down the list and tap “Add to Home Screen”.',
          'Tap “Add”. BillKhata opens from its own icon, full screen.',
        ],
        note: 'Don’t see Share? Tap the address bar once, or scroll up a little, to bring the bar back.',
      };
    }
    return {
      id: 'ios-other', title: 'Add to your iPhone’s home screen',
      steps: [
        'Tap the Share button (a square with an arrow up) next to the address bar.',
        'Tap “Add to Home Screen”, then “Add”.',
      ],
      note: 'If it isn’t there, open expense.sagunpradhan.com.np in Safari and add it from Safari’s Share button.',
    };
  }
  if (android && /SamsungBrowser/.test(ua)) {
    return {
      id: 'samsung', title: 'Add to your home screen',
      steps: ['Tap the menu (☰) at the bottom right.', 'Tap “Add page to”, then “Home screen”.', 'Tap “Add”.'],
    };
  }
  if (android && /Firefox/.test(ua)) {
    return {
      id: 'android-firefox', title: 'Add to your home screen',
      steps: ['Tap the menu (⋮).', 'Tap “Install” (or “Add to Home screen”).', 'Tap “Add”.'],
    };
  }
  if (android) {
    return {
      id: 'android-chrome', title: 'Add to your home screen',
      steps: ['Tap the menu (⋮) at the top right of Chrome.', 'Tap “Add to Home screen” or “Install app”.', 'Tap “Install” (or “Add”).'],
      note: 'Using Brave, Edge or Opera? The same option is in its menu.',
    };
  }
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
    return { id: 'mac-safari', title: 'Add to your Dock', steps: ['In Safari’s menu bar choose File → Add to Dock.', 'Click “Add”.'] };
  }
  if (/Chrome|Chromium|Edg\//.test(ua)) {
    return {
      id: 'desktop-chrome', title: 'Install on this computer',
      steps: ['Click the install icon at the right end of the address bar (a screen with an arrow).', 'Or open the browser menu → “Install BillKhata” (Cast, save and share → Install page… in newer Chrome).'],
    };
  }
  return {
    id: 'other', title: 'Add to your home screen',
    steps: ['Look in your browser’s menu or Share button for “Add to Home screen” or “Install”.'],
    note: 'Chrome on Android and Safari on iPhone both support it.',
  };
}
