// The portal helper as the app hands it out: bookmarklet, per-bill console script and
// userscript link. The code itself lives in src/ird-helper/helper.js; vite.config.js
// minifies it into the `virtual:ird-helper` module.
import { HELPER_MIN, HELPER_VERSION, USERSCRIPT_PATH } from 'virtual:ird-helper';
import { portalPayload } from './ird.js';

export { HELPER_VERSION };

export const appOrigin = () => window.location.origin;

/** Absolute URL Tampermonkey can install from. */
export const userscriptUrl = () => `${appOrigin()}${USERSCRIPT_PATH}`;

/** Install-once bookmarklet: picks up whichever bill BillKhata last sent to the portal tab. */
export const bookmarklet = () => `javascript:${encodeURIComponent(HELPER_MIN)}`;

/** For pasting into the portal's developer console when the portal was opened by hand. */
export function consoleScript(e, profile) {
  const payload = portalPayload(e, profile, appOrigin());
  return `window.__billkhataMode='bookmarklet';window.__billkhata_payload=${JSON.stringify(payload)};${HELPER_MIN}`;
}
