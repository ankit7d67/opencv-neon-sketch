// Decodes the test PNGs (they are 8-bit RGBA, filter 0) and reports the
// same stats the pipeline computes: mean(gray), frac(gray>40), colorful fraction.
import zlib from 'node:zlib';
import fs from 'node:fs';

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let pos = 8; // skip signature
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error('unexpected filter ' + filter);
    raw.copy(out, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { w, h, data: out };
}

function stats(file) {
  const { w, h, data } = decodePNG(file);
  const n = w * h;
  let sum = 0, bright = 0, colorful = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += gray;
    if (gray > 40) bright++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const S = max === 0 ? 0 : ((max - min) / max) * 255;
    const V = max;
    if (S > 60 && V > 40) colorful++;
  }
  console.log(`${file.split('\\').pop()}: ${w}x${h} mean=${(sum / n).toFixed(1)} fracBright=${(bright / n).toFixed(3)} fracColorful=${(colorful / n).toFixed(3)}`);
}

for (const f of process.argv.slice(2)) stats(f);
