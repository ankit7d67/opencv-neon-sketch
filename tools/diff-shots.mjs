// Pixel diff between two same-size PNGs.
import fs from 'node:fs';
import zlib from 'node:zlib';

function decode(buf) {
  let pos = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, bpp, data: out };
}

const A = decode(fs.readFileSync(process.argv[2]));
const B = decode(fs.readFileSync(process.argv[3]));
if (A.w !== B.w || A.h !== B.h || A.bpp !== B.bpp) { console.log('size mismatch', A.w, A.h, A.bpp, 'vs', B.w, B.h, B.bpp); process.exit(1); }

let diff = 0, bigDiff = 0, maxDelta = 0, hotA = 0, hotB = 0;
const n = A.w * A.h;
for (let i = 0; i < A.data.length; i += A.bpp) {
  const la = 0.299 * A.data[i] + 0.587 * A.data[i + 1] + 0.114 * A.data[i + 2];
  const lb = 0.299 * B.data[i] + 0.587 * B.data[i + 1] + 0.114 * B.data[i + 2];
  if (la > 240) hotA++;
  if (lb > 240) hotB++;
  const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
  if (d > 8) diff++;
  if (d > 40) bigDiff++;
  if (d > maxDelta) maxDelta = d;
}
console.log(`${process.argv[2].split(/[\\/]/).pop()}: hot=${hotA}`);
console.log(`${process.argv[3].split(/[\\/]/).pop()}: hot=${hotB}`);
console.log(`pixels differing (>8): ${diff} (${(100 * diff / n).toFixed(1)}%)  big(>40): ${bigDiff}  maxDelta=${maxDelta}`);
