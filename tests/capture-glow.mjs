// Deterministic mid-draw canvas capture for glow comparison.
// Usage: node tests/capture-glow.mjs <outfile>
import { chromium } from 'playwright';

const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto('http://localhost:5180/', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('dzHint').textContent.includes('Click, drop'), null, { timeout: 40000 });
await page.setInputFiles('#fileInput', 'C:\\Users\\mundr\\neon-sketch\\test-images\\neon-on-black.png');
await page.waitForFunction(() => document.getElementById('status').textContent.includes('Drawing'), null, { timeout: 60000 });
await page.evaluate(() => { const el = document.getElementById('dur'); el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#playBtn');
await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Done'), null, { timeout: 90000, polling: 50 });
await page.waitForTimeout(200);
const pct = await page.textContent('#progPct');
await page.locator('#canvasWrap').screenshot({ path: out });
console.log('captured', out, 'at', pct);
await browser.close();
