// Renders neon-on-black at Duration 10 to Done, screenshots.
// Used to measure run-to-run render noise (rAF landing points) for the
// "Neon unchanged" check. Usage: node tests/neon-shot.mjs <url> <outPath>
import { chromium } from 'playwright';
import path from 'node:path';

const baseUrl = process.argv[2] || 'http://localhost:5180/';
const out = process.argv[3] || 'tests/shot-neon-tmp.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
await page.goto(baseUrl, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('dzHint').textContent.includes('Click, drop'),
  null, { timeout: 40000 });
await page.evaluate(() => {
  const d = document.getElementById('dur');
  d.value = '10'; d.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.setInputFiles('#fileInput', path.join(process.cwd(), 'test-images', 'neon-on-black.png'));
await page.waitForFunction(
  () => document.getElementById('status').textContent.includes('Drawing'),
  null, { timeout: 60000, polling: 50 });
await page.waitForFunction(
  () => document.getElementById('status').textContent.includes('Done'),
  null, { timeout: 40000, polling: 50 });
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
