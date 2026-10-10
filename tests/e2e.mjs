// E2E smoke test. Runs against any URL (file:// for the original, the Vite
// dev server for the refactored app) and prints a JSON-ish report.
// Usage: node tests/e2e.mjs <baseUrl> [label] [skipDurationTest]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, '..', 'test-images');

const baseUrl = process.argv[2];
const label = process.argv[3] || 'run';
const skipDuration = process.argv[4] === 'skip-duration';

const R = { label, url: baseUrl, checks: {} };
const errors = [];
let page;

async function waitStatus(sub, timeout = 30000) {
  await page.waitForFunction(
    s => document.getElementById('status').textContent.includes(s),
    sub, { timeout, polling: 50 });
}

function log(step) { console.log('  →', step); }

async function uploadAndStart(img) {
  await page.setInputFiles('#fileInput', path.join(IMG_DIR, img));
  await waitStatus('Drawing', 60000);
  // wait for actual progress beyond 0%
  await page.waitForFunction(
    () => document.getElementById('progPct').textContent !== '0%',
    null, { timeout: 15000, polling: 25 }).catch(() => {});
}

async function run() {
  const browser = await chromium.launch();
  page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(baseUrl, { waitUntil: 'load' });

  // 1. page loads + OpenCV initialises
  log('waiting for OpenCV init');
  await page.waitForFunction(
    () => document.getElementById('dzHint').textContent.includes('Click, drop'),
    null, { timeout: 40000 });
  R.checks.opencvInit = true;
  log('OpenCV ready');

  // 2. auto-detect: neon-on-black image → neon mode + original colors
  log('uploading neon-on-black');
  await uploadAndStart('neon-on-black.png');
  R.checks.neonMode = await page.evaluate(() => window.__neon.state.mode === 'neon');
  R.checks.neonOriginal = await page.evaluate(() => window.__neon.state.colorMode === 'original');
  R.checks.strokesFound = await page.evaluate(() => window.__neon.state.chunks.length > 0);
  log('drawing neon image…');
  await waitStatus('Done', 40000);
  R.checks.firstDrawDone = true;
  log('first draw done');

  if (!skipDuration) {
    // 3. Duration 10 → ends in ~10s. Set slider BEFORE upload (fresh timeline).
    log('setting duration 10s');
    await page.evaluate(() => {
      const el = document.getElementById('dur');
      el.value = '10';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#playBtn');                    // replay
    await waitStatus('Drawing');
    const t0 = Date.now();
    await waitStatus('Done', 40000);
    R.checks.durationSec = +(((Date.now() - t0) / 1000).toFixed(2));
    log('duration-10 finished in ' + R.checks.durationSec + 's');
  }

  // 4. Pause / Resume
  log('testing pause/resume');
  await page.click('#playBtn');
  await waitStatus('Drawing');
  await page.click('#pauseBtn');
  await waitStatus('Paused.');
  R.checks.pause = true;
  await page.click('#pauseBtn');
  await waitStatus('Drawing');
  R.checks.resume = true;
  log('pause/resume ok');

  // 5. Skip to end
  log('testing skip');
  await page.click('#skipBtn');
  await waitStatus('Done', 10000);
  R.checks.skip = true;

  // 6. Replay works
  log('testing replay');
  await page.click('#playBtn');
  await waitStatus('Drawing');
  R.checks.replay = true;
  await page.click('#skipBtn');
  await waitStatus('Done', 10000);
  log('replay ok');

  // 7. second image (photo mode) → gradient colors
  log('uploading line-art-white');
  await page.evaluate(() => { const el = document.getElementById('dur'); el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#playBtn');                    // replay existing with new duration
  await waitStatus('Done', 40000);
  await uploadAndStart('line-art-white.png');
  R.checks.photoGradient = await page.evaluate(() =>
    window.__neon.state.mode === 'photo' && window.__neon.state.colorMode === 'gradient');
  await waitStatus('Done', 40000);
  log('photo/gradient ok');

  // 8. colorful photo keeps its colors
  log('uploading colorful');
  await uploadAndStart('colorful.png');
  R.checks.colorfulOriginal = await page.evaluate(() => window.__neon.state.colorMode === 'original');
  await waitStatus('Done', 40000);
  log('colorful ok');

  // 9. PNG export
  log('testing PNG export');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#pngBtn'),
  ]);
  const dlp = await download.path();
  R.checks.pngExport = download.suggestedFilename() === 'neon-sketch.png' && dlp && fs.existsSync(dlp) && fs.statSync(dlp).size > 1000;
  log('png ok');

  // 10. blank image → "No lines found" (wait for the error, not 'Drawing')
  log('uploading blank (expect error)');
  await page.setInputFiles('#fileInput', path.join(IMG_DIR, 'blank-white.png'));
  await page.waitForFunction(
    () => {
      const b = document.getElementById('errorBox');
      return !b.hidden && b.textContent.includes('No lines found - try raising Detail or switching Mode.');
    },
    null, { timeout: 30000, polling: 50 });
  R.checks.noLinesError = true;
  log('no-lines error ok');

  // 11. WebM recording (start → stop → download)
  log('testing WebM recording');
  await page.setInputFiles('#fileInput', path.join(IMG_DIR, 'neon-on-black.png'));
  await waitStatus('Drawing', 60000);
  await page.evaluate(() => { document.getElementById('rec').checked = true; document.getElementById('rec').dispatchEvent(new Event('change', { bubbles: true })); });
  await waitStatus('Recording');
  await page.waitForTimeout(1500);
  const [vdl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.evaluate(() => { const r = document.getElementById('rec'); r.checked = false; r.dispatchEvent(new Event('change', { bubbles: true })); }),
  ]);
  const vpath = await vdl.path();
  R.checks.webmExport = vdl.suggestedFilename() === 'neon-sketch.webm' && vpath && fs.existsSync(vpath) && fs.statSync(vpath).size > 1000;
  log('webm ok');

  // 12. 375px viewport: no horizontal overflow, canvas visible
  log('testing 375px viewport');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  const overflowInfo = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && r.height > 0) {
        wide.push(el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className && el.className.baseVal === undefined ? el.className : '').split(' ')[0] + ' w=' + Math.round(r.width));
      }
    });
    return { scrollW: document.documentElement.scrollWidth, wide: wide.slice(0, 10) };
  });
  R.checks.noOverflow375 = overflowInfo.scrollW <= 375;
  if (!R.checks.noOverflow375) R.overflowDetail = overflowInfo;
  R.checks.canvasVisible375 = await page.isVisible('#baseCv');

  // 13. screenshot mid-draw for visual diffing
  log('capturing screenshot');
  await page.evaluate(() => {
    const el = document.getElementById('dur');
    el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#playBtn');
  await page.waitForFunction(() => {
    const s = document.getElementById('progPct').textContent;
    return parseInt(s, 10) >= 50 && parseInt(s, 10) <= 56;
  }, null, { timeout: 30000, polling: 20 });
  await page.click('#pauseBtn');                    // freeze for a stable shot
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'screenshot-' + label + '.png') });

  R.consoleErrors = errors;
  R.passed = Object.values(R.checks).every(Boolean) && errors.length === 0;
  console.log(JSON.stringify(R, null, 2));
  await browser.close();
  process.exit(R.passed ? 0 : 1);
}

run().catch(e => {
  console.error('E2E FAILED:', e.message);
  if (page) {
    page.evaluate(() => ({
      status: document.getElementById('status').textContent,
      err: document.getElementById('errorBox').hidden ? null : document.getElementById('errorBox').textContent.slice(0, 150),
    })).then(s => console.error('page state at failure:', JSON.stringify(s))).catch(() => {});
  }
  process.exit(2);
});
