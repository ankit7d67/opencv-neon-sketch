// Verifies the Smooth toggle: off = original pipeline, on = Chaikin-smoothed
// strokes with no cross-stroke artifacts, off again = original chunk count.
// Usage: node tests/verify-smooth.mjs [baseUrl]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] || 'http://localhost:5180/';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const waitStatus = (sub, timeout = 60000) => page.waitForFunction(
  s => document.getElementById('status').textContent.includes(s),
  sub, { timeout, polling: 50 });
const snapshot = () => page.evaluate(() => ({
  chunks: window.__neon.state.chunks.length,
  strokes: window.__neon.state.chunks.filter(c => c.newStroke).length,
  smooth: window.__neon.state.settings.smooth,
  crossStroke: (window.__diag.crossStroke || []).length,
}));

await page.goto(baseUrl, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('dzHint').textContent.includes('Click, drop'),
  null, { timeout: 40000 });

await page.evaluate(() => {
  const d = document.getElementById('dur');
  d.value = '10'; d.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.setInputFiles('#fileInput', path.join(__dirname, '..', 'test-images', 'radhekrihna.png'));
await waitStatus('Drawing', 120000);
await waitStatus('Done', 60000);
const off = await snapshot();
await page.screenshot({ path: path.join(__dirname, 'shot-smooth-off.png') });

// toggle on
await page.evaluate(() => {
  const el = document.getElementById('smooth');
  el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
});
await waitStatus('Drawing', 120000);
await waitStatus('Done', 60000);
const on = await snapshot();
await page.screenshot({ path: path.join(__dirname, 'shot-smooth-on.png') });

// toggle off again — chunk count must return to the original
await page.evaluate(() => {
  const el = document.getElementById('smooth');
  el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true }));
});
await waitStatus('Drawing', 120000);
await waitStatus('Done', 60000);
const off2 = await snapshot();

const R = {
  off, on, off2,
  checks: {
    onDoublesChunks: on.chunks > off.chunks,
    strokesUnchanged: on.strokes === off.strokes,
    noCrossStroke: on.crossStroke === 0,
    offRestores: off2.chunks === off.chunks,
    noErrors: errors.length === 0,
  },
  errors,
};
R.passed = Object.values(R.checks).every(Boolean);
console.log(JSON.stringify(R, null, 2));
await browser.close();
process.exit(R.passed ? 0 : 1);
