// Spinner overlay lifecycle: hidden on load, visible during processing,
// hidden after. Captures screenshots at each stage for visual inspection.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__neon, null, { timeout: 40000 });

const load = await page.evaluate(() => ({
  spinnerHiddenAttr: document.getElementById('spinner').hidden,
  spinnerDisplayed: getComputedStyle(document.getElementById('spinner')).display,
  dropzoneDisplayed: getComputedStyle(document.getElementById('dropzone')).display,
}));
console.log('on load:', JSON.stringify(load));
await page.screenshot({ path: 'tests/verify-home.png' });

// upload + poll visibility rapidly to catch the spinner while it's up
await page.setInputFiles('#fileInput', 'C:\\Users\\mundr\\neon-sketch\\test-images\\neon-on-black.png');
let sawSpinner = false;
let status = '';
for (let i = 0; i < 600 && !status.startsWith('Done'); i++) {
  if (await page.isVisible('#spinner')) sawSpinner = true;
  status = await page.textContent('#status');
  if (status.startsWith('Error')) break;
}
console.log('spinner visible during processing:', sawSpinner);

const after = await page.evaluate(() => ({
  spinnerHiddenAttr: document.getElementById('spinner').hidden,
  spinnerDisplayed: getComputedStyle(document.getElementById('spinner')).display,
  status: document.getElementById('status').textContent.slice(0, 40),
}));
console.log('after processing:', JSON.stringify(after));

await page.waitForTimeout(300);
await page.screenshot({ path: 'tests/verify-after.png' });

const pass = load.spinnerDisplayed === 'none' && load.dropzoneDisplayed !== 'none'
  && sawSpinner && after.spinnerDisplayed === 'none' && errors.length === 0;
console.log(JSON.stringify({ lifecyclePass: pass, errors }));
await browser.close();
process.exit(pass ? 0 : 1);
