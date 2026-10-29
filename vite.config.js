import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, minify } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const HELPER_PATH = fileURLToPath(new URL('./src/ird-helper/helper.js', import.meta.url));
const SITE = 'https://expense.sagunpradhan.com.np';
const USERSCRIPT_FILE = 'billkhata-ird.user.js';

/**
 * Builds the IRD helper two ways from src/ird-helper/helper.js:
 * - a readable Tampermonkey userscript, served at /billkhata-ird.user.js
 * - a minified copy the app turns into the bookmarklet and console script
 */
async function buildHelper() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const src = readFileSync(HELPER_PATH, 'utf8');
  const runner = `(function(){${src}\nbillkhataIrdHelper(window.__billkhataMode||'bookmarklet');})();`;
  const { code, errors } = await minify('helper.js', runner, { compress: true, mangle: true });
  if (errors?.length) throw new Error(`IRD helper did not minify: ${errors.map((e) => e.message).join('; ')}`);
  const userscript = `// ==UserScript==
// @name         BillKhata → IRD prize coupon auto-fill
// @namespace    ${SITE}
// @version      ${version}
// @description  One click fills the prize.ird.gov.np cash-bill form with a bill sent from BillKhata, then saves the coupon back. You still pass the security check and submit.
// @author       BillKhata
// @match        https://prize.ird.gov.np/*
// @icon         ${SITE}/favicon.svg
// @run-at       document-idle
// @grant        none
// @homepageURL  ${SITE}
// @downloadURL  ${SITE}/${USERSCRIPT_FILE}
// @updateURL    ${SITE}/${USERSCRIPT_FILE}
// ==/UserScript==

${src}
billkhataIrdHelper('userscript');
`;
  return { minified: code.trim(), userscript, version };
}

function irdHelperPlugin() {
  const VIRTUAL = 'virtual:ird-helper';
  const RESOLVED = `\0${VIRTUAL}`;
  return {
    name: 'billkhata-ird-helper',
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(HELPER_PATH);
      const { minified, version } = await buildHelper();
      return `export const HELPER_MIN = ${JSON.stringify(minified)};
export const HELPER_VERSION = ${JSON.stringify(version)};
export const USERSCRIPT_PATH = ${JSON.stringify(`/${USERSCRIPT_FILE}`)};`;
    },
    configureServer(server) {
      server.middlewares.use(`/${USERSCRIPT_FILE}`, async (_req, res) => {
        const { userscript } = await buildHelper();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(userscript);
      });
    },
    async generateBundle() {
      const { userscript } = await buildHelper();
      this.emitFile({ type: 'asset', fileName: USERSCRIPT_FILE, source: userscript });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), irdHelperPlugin()],
  build: { chunkSizeWarningLimit: 1200 },
});
