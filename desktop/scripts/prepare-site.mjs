/* Builds desktop/site: a self-contained copy of just the OBI-1 page.
   Only the files obi.html references are copied. The nav is trimmed to the
   theme toggle (no links to pages that aren't bundled) and the Web Serial
   shim is injected so native serialport works through the OBI code. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(__dirname, '..', 'site');

const CSS_FILES = ['style.css', 'tool.css'];
const JS_FILES = ['theme.js', 'reveal.js', 'common.js', 'obi.js'];

await rm(SITE, { recursive: true, force: true });
await mkdir(path.join(SITE, 'css'), { recursive: true });
await mkdir(path.join(SITE, 'js', 'modules'), { recursive: true });
await mkdir(path.join(SITE, 'js', 'interfaces'), { recursive: true });

/* ---- obi.html, transformed for the desktop bundle ---- */
const source = await readFile(path.join(ROOT, 'obi.html'), 'utf8');
let html = source;
html = html.replace(
  '<script src="js/theme.js"></script>',
  '<script src="js/theme.js"></script>\n  <script src="js/serial-shim.js"></script>'
);
html = html.replace(
  '<a class="brand" href="index.html">',
  '<a class="brand" href="obi.html">'
);
html = html.replace(
  /(<div class="nav-links">)([\s\S]*?)(<\/div>)/,
  (_m, open, inner, close) => open + inner.replace(/<a [\s\S]*?<\/a>/g, '') + close
);
await writeFile(path.join(SITE, 'obi.html'), html);

/* ---- shared assets ---- */
for (const file of CSS_FILES) {
  await cp(path.join(ROOT, 'css', file), path.join(SITE, 'css', file));
}
for (const file of JS_FILES) {
  await cp(path.join(ROOT, 'js', file), path.join(SITE, 'js', file));
}
await cp(path.join(ROOT, 'js', 'modules', 'makita_lxt.js'), path.join(SITE, 'js', 'modules', 'makita_lxt.js'));
await cp(path.join(ROOT, 'js', 'interfaces', 'arduino_obi.js'), path.join(SITE, 'js', 'interfaces', 'arduino_obi.js'));
await cp(path.resolve(__dirname, '..', 'serial-shim.js'), path.join(SITE, 'js', 'serial-shim.js'));

console.log(`OBI-only site prepared in ${SITE}`);
