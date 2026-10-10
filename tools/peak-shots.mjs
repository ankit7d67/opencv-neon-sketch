// Brightness-peak comparison: max lum, and count of pixels above thresholds.
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

for (const file of process.argv.slice(2)) {
  const { data, bpp } = decode(fs.readFileSync(file));
  let max = 0, over200 = 0, over150 = 0, over100 = 0;
  const lums = [];
  for (let i = 0; i < data.length; i += bpp) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (l > max) max = l;
    if (l > 200) over200++;
    if (l > 150) over150++;
    if (l > 100) over100++;
    lums.push(l);
  }
  lums.sort((a, b) => a - b);
  const p99 = lums[Math.floor(lums.length * 0.99)];
  const p999 = lums[Math.floor(lums.length * 0.999)];
  console.log(`${file.split(/[\\/]/).pop()}: max=${max.toFixed(0)} p99=${p99.toFixed(0)} p99.9=${p999.toFixed(0)} >200:${over200} >150:${over150} >100:${over100}`);
}
