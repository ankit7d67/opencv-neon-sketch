// Generates the test fixtures for neon-sketch (pure Node, no deps).
// Writes valid PNGs via a minimal encoder (zlib + hand-rolled CRC/chunks).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

/* ---------- minimal PNG encoder ---------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit depth, RGBA color type
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter type: None
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- tiny rasteriser ---------- */
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = Buffer.alloc(w * h * 4); }
  fill(r, g, b) {
    for (let i = 0; i < this.d.length; i += 4) { this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255; }
  }
  px(x, y, r, g, b) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255;
  }
  line(x0, y0, x1, y1, r, g, b, t = 3) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    const rad = t / 2;
    for (;;) {
      for (let oy = -rad; oy <= rad; oy++)
        for (let ox = -rad; ox <= rad; ox++)
          if (ox * ox + oy * oy <= rad * rad + 0.5) this.px(x + ox, y + oy, r, g, b);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  circle(cx, cy, r, col, t = 3, fillIt = false) {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d2 = x * x + y * y;
        if (fillIt ? d2 <= r * r : Math.abs(d2 - r * r) <= t * r) this.px(cx + x, cy + y, ...col);
      }
  }
  save(file) {
    fs.writeFileSync(file, encodePNG(this.w, this.h, this.d));
    console.log('wrote', file, `(${this.w}x${this.h})`);
  }
}

const OUT = path.join(process.argv[2] || '.', 'test-images');
fs.mkdirSync(OUT, { recursive: true });

/* 1. neon-on-black line art — dark bg, few saturated bright strokes
      → Auto picks "neon" mode + "original" colors */
{
  const c = new Canvas(600, 400);
  c.fill(0, 0, 0);
  const CYAN = [0, 255, 255], MAGENTA = [255, 0, 255], GREEN = [57, 255, 136], ORANGE = [255, 160, 0];
  // neon star
  c.line(300, 60, 350, 180, ...CYAN, 5);
  c.line(350, 180, 480, 185, ...MAGENTA, 5);
  c.line(480, 185, 380, 260, ...GREEN, 5);
  c.line(380, 260, 420, 380, ...ORANGE, 5);
  c.line(420, 380, 300, 310, ...CYAN, 5);
  c.line(300, 310, 180, 380, ...MAGENTA, 5);
  c.line(180, 380, 220, 260, ...GREEN, 5);
  c.line(220, 260, 120, 185, ...ORANGE, 5);
  c.line(120, 185, 250, 180, ...CYAN, 5);
  c.line(250, 180, 300, 60, ...MAGENTA, 5);
  // glow rings
  c.circle(120, 120, 55, CYAN, 4);
  c.circle(120, 120, 40, GREEN, 4);
  c.circle(490, 320, 45, MAGENTA, 4);
  c.circle(490, 320, 30, ORANGE, 4);
  c.save(path.join(OUT, 'neon-on-black.png'));
}

/* 2. plain line art on white — grayscale drawing on white
      → Auto picks "photo" mode + "gradient" colors */
{
  const c = new Canvas(600, 400);
  c.fill(255, 255, 255);
  const BLACK = [0, 0, 0];
  // house
  c.line(120, 200, 120, 340, ...BLACK, 3);
  c.line(120, 340, 300, 340, ...BLACK, 3);
  c.line(300, 340, 300, 200, ...BLACK, 3);
  c.line(120, 200, 210, 120, ...BLACK, 3);
  c.line(210, 120, 300, 200, ...BLACK, 3);
  // door + window
  c.line(190, 340, 190, 270, ...BLACK, 3);
  c.line(190, 270, 240, 270, ...BLACK, 3);
  c.line(240, 270, 240, 340, ...BLACK, 3);
  c.line(150, 230, 200, 230, ...BLACK, 3);
  c.line(150, 230, 150, 280, ...BLACK, 3);
  c.line(150, 280, 200, 280, ...BLACK, 3);
  c.line(200, 280, 200, 230, ...BLACK, 3);
  // sun + rays
  c.circle(460, 100, 40, BLACK, 3);
  for (let a = 0; a < 8; a++) {
    const r = (a * Math.PI) / 4;
    c.line(460 + Math.cos(r) * 55, 100 + Math.sin(r) * 55,
           460 + Math.cos(r) * 85, 100 + Math.sin(r) * 85, ...BLACK, 3);
  }
  // tree
  c.line(380, 340, 380, 240, ...BLACK, 3);
  c.circle(380, 210, 45, BLACK, 3);
  // ground line
  c.line(60, 340, 540, 340, ...BLACK, 3);
  c.save(path.join(OUT, 'line-art-white.png'));
}

/* 3. colorful picture — saturated sky/sun/grass/house
      → Auto picks "photo" mode but keeps "original" colors (colorful fraction > 0.12) */
{
  const c = new Canvas(600, 400);
  // sky gradient (blue → light blue)
  for (let y = 0; y < 260; y++) {
    const t = y / 260;
    const r = Math.round(60 + t * 120), g = Math.round(140 + t * 80), b = 255;
    for (let x = 0; x < 600; x++) c.px(x, y, r, g, b);
  }
  // grass
  for (let y = 260; y < 400; y++) {
    const t = (y - 260) / 140;
    for (let x = 0; x < 600; x++) c.px(x, y, Math.round(40 - t * 20), Math.round(180 - t * 60), 40);
  }
  // sun (yellow)
  c.circle(500, 80, 45, [255, 230, 0], 200, true);
  // house (red walls, brown roof)
  for (let y = 180; y < 320; y++) for (let x = 150; x < 350; x++) c.px(x, y, 220, 40, 40);
  for (let y = 120; y < 180; y++) {
    const half = 110 - (y - 120);
    for (let x = 250 - half; x < 250 + half; x++) c.px(x, y, 120, 70, 30);
  }
  // door (purple) + window (cyan)
  for (let y = 250; y < 320; y++) for (let x = 225; x < 275; x++) c.px(x, y, 150, 0, 200);
  for (let y = 200; y < 240; y++) for (let x = 170; x < 220; x++) c.px(x, y, 0, 220, 220);
  c.save(path.join(OUT, 'colorful.png'));
}

/* 4. blank white — no lines at all → "No lines found" error path */
{
  const c = new Canvas(300, 200);
  c.fill(255, 255, 255);
  c.save(path.join(OUT, 'blank-white.png'));
}
