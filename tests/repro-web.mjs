// Repro for the Photo/Auto "web of straight lines" bug.
// Renders test-images/radhekrihna.png with the user's settings (Original
// colors, thickness 1, Duration 60) at Detail 1 (Mode Auto) and Detail 2
// (Mode Photo explicit); screenshots at ~30% and 100%; dumps window.__diag
// (stage timings, run adjacency, cross-stroke draw events, frame stats).
// Usage: node tests/repro-web.mjs [baseUrl] [label]   (label: before|after)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const baseUrl = process.argv[2] || 'http://localhost:5180/';
const label = process.argv[3] || 'run';

let page;
const errors = [], warnings = [];

async function waitStatus(sub, timeout = 60000) {
  await page.waitForFunction(
    s => document.getElementById('status').textContent.includes(s),
    sub, { timeout, polling: 50 });
}

async function setCtrl(id, value, ev) {
  await page.evaluate(([i, v, e]) => {
    const el = document.getElementById(i);
    el.value = v;
    el.dispatchEvent(new Event(e, { bubbles: true }));
  }, [id, value, ev]);
}

const shot = tag => page.screenshot({ path: path.join(__dirname, `shot-${label}-${tag}.png`) });

async function wait30PauseShot(tag) {
  await waitStatus('Drawing', 240000);
  await page.waitForFunction(() => {
    const p = parseInt(document.getElementById('progPct').textContent, 10);
    return p >= 27 && p <= 36;
  }, null, { timeout: 180000, polling: 40 });
  await page.click('#pauseBtn');
  await waitStatus('Paused', 10000);
  await shot(tag + '-30');
  await page.click('#pauseBtn');
  await waitStatus('Drawing', 10000);
}

const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function pct(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
function frameStats(d) {
  const ds = (d.frameDeltas || []).filter(x => x < 200);   // drop pause gaps
  return {
    frames: (d.frameDeltas || []).length,
    deltaAvg: +avg(ds).toFixed(1),
    deltaP95: +pct(ds, 0.95).toFixed(1),
    deltaMax: ds.length ? +Math.max(...ds).toFixed(1) : 0,
    piecesAvg: +avg(d.framePieces || []).toFixed(1),
    piecesMax: (d.framePieces || []).length ? Math.max(...d.framePieces) : 0,
  };
}

async function run() {
  const browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('dzHint').textContent.includes('Click, drop'),
    null, { timeout: 40000 });

  // user-reported settings
  await setCtrl('thick', '1', 'input');
  await setCtrl('color', 'original', 'change');
  await setCtrl('dur', '60', 'input');

  // ---- Detail 1, Mode Auto (does Auto resolve to photo?) ----
  await setCtrl('det', '1', 'input');
  await setCtrl('mode', 'auto', 'change');
  await page.setInputFiles('#fileInput', path.join(ROOT, 'test-images', 'radhekrihna.png'));
  await wait30PauseShot('d1-auto');
  const d1info = await page.evaluate(() => ({
    mode: window.__neon.state.mode,
    colorMode: window.__neon.state.colorMode,
    chunks: window.__neon.state.chunks.length,
    strokes: window.__neon.state.chunks.filter(c => c.newStroke).length,
  }));
  await waitStatus('Done', 180000);
  await shot('d1-auto-100');
  const diag1 = await page.evaluate(() => window.__diag);
  diag1.frame = frameStats(diag1);
  fs.writeFileSync(path.join(__dirname, `diag-${label}-d1.json`), JSON.stringify(diag1, null, 2));
  console.log('D1 auto  →', JSON.stringify(d1info));
  console.log('D1 stages(ms) →', JSON.stringify(diag1.stages), 'totalMs:', diag1.totalMs);
  console.log('D1 crossStroke:', diag1.crossStroke.length, 'sample:', JSON.stringify(diag1.crossStroke.slice(0, 3)));
  console.log('D1 frames →', JSON.stringify(diag1.frame));

  // ---- Detail 2, Mode Photo (explicit) ----
  await setCtrl('det', '2', 'input');
  await setCtrl('mode', 'photo', 'change');
  await wait30PauseShot('d2-photo');
  const d2info = await page.evaluate(() => ({
    mode: window.__neon.state.mode,
    colorMode: window.__neon.state.colorMode,
    chunks: window.__neon.state.chunks.length,
    strokes: window.__neon.state.chunks.filter(c => c.newStroke).length,
  }));
  await waitStatus('Done', 180000);
  await shot('d2-photo-100');
  const diag2 = await page.evaluate(() => window.__diag);
  diag2.frame = frameStats(diag2);
  fs.writeFileSync(path.join(__dirname, `diag-${label}-d2.json`), JSON.stringify(diag2, null, 2));
  console.log('D2 photo →', JSON.stringify(d2info));
  console.log('D2 stages(ms) →', JSON.stringify(diag2.stages), 'totalMs:', diag2.totalMs);
  console.log('D2 crossStroke:', diag2.crossStroke.length, 'sample:', JSON.stringify(diag2.crossStroke.slice(0, 3)));
  console.log('D2 frames →', JSON.stringify(diag2.frame));

  // ---- Neon baseline for the unchanged-check (chunk hash + screenshot) ----
  await setCtrl('dur', '10', 'input');
  await setCtrl('mode', 'auto', 'change');
  await setCtrl('color', 'auto', 'change');
  await page.setInputFiles('#fileInput', path.join(ROOT, 'test-images', 'neon-on-black.png'));
  await waitStatus('Drawing', 60000);
  const neonInfo = await page.evaluate(() => {
    const cs = window.__neon.state.chunks;
    const s = JSON.stringify(cs.map(c => [c.pts.map(p => p.x + ',' + p.y).join(' '), c.newStroke, c.color]));
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return { mode: window.__neon.state.mode, colorMode: window.__neon.state.colorMode,
             chunks: cs.length, jsonLen: s.length, hash: h };
  });
  await waitStatus('Done', 40000);
  await shot('neon-100');
  const diagN = await page.evaluate(() => window.__diag);
  console.log('NEON     →', JSON.stringify(neonInfo), 'crossStroke:', diagN.crossStroke.length);

  console.log(JSON.stringify({ label, url: baseUrl, errors, warningCount: warnings.length,
                               warnings: warnings.slice(0, 5) }, null, 2));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

run().catch(e => {
  console.error('REPRO FAILED:', e);
  if (page) {
    page.evaluate(() => document.getElementById('status').textContent)
      .then(t => console.error('status at failure:', t)).catch(() => {});
  }
  process.exit(2);
});
