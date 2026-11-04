import { createHash } from 'node:crypto';
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

/**
 * Offline: writes sw.js (from src/sw-template.js) with this build's files, and offline-assets.json
 * for Settings → Download for offline use. CORE is what the app needs to open: index.html, the entry
 * chunk and its static imports, their CSS, the fonts and the public icons. ALL is every built file.
 */
function offlinePlugin() {
  const PUBLIC = ['favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
  return {
    name: 'billkhata-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== USERSCRIPT_FILE && f !== 'index.html');
      const size = (f) => { const x = bundle[f]; return x.type === 'chunk' ? Buffer.byteLength(x.code) : (typeof x.source === 'string' ? Buffer.byteLength(x.source) : x.source.length); };
      const core = new Set();
      const visit = (name) => {
        const c = bundle[name];
        if (!c || core.has(name)) return;
        core.add(name);
        if (c.type !== 'chunk') return;
        c.imports.forEach(visit);
        c.viteMetadata?.importedCss?.forEach((f) => core.add(f));
        c.viteMetadata?.importedAssets?.forEach((f) => core.add(f));
      };
      Object.values(bundle).filter((c) => c.type === 'chunk' && c.isEntry).forEach((c) => visit(c.fileName));
      // Fonts for English and Nepali (the Vietnamese, Greek and Cyrillic subsets load only if needed).
      files.filter((f) => f.endsWith('.woff2') && !/(vietnamese|greek|cyrillic)/.test(f)).forEach((f) => core.add(f));
      const coreList = [...core, ...PUBLIC, 'offline-assets.json'];
      const all = [...files, ...PUBLIC];
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const bytes = Object.fromEntries(files.map((f) => [f, size(f)]));
      const sw = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__CORE__', JSON.stringify(coreList))
        .replace('__ALL__', JSON.stringify(all));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
      this.emitFile({ type: 'asset', fileName: 'offline-assets.json', source: JSON.stringify({ version, core: coreList, all, bytes }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), irdHelperPlugin(), offlinePlugin()],
  build: { chunkSizeWarningLimit: 1200 },
  // ONNX Runtime fetches its own .wasm at run time; pre-bundling it breaks that.
  optimizeDeps: { exclude: ['onnxruntime-web', 'ppu-paddle-ocr'] },
  worker: { format: 'es' },
});
