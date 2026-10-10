// Image intake + the full OpenCV pipeline. Every Mat is .delete()d.
import { state, ABORT, yieldToBrowser } from './state.js';
import {
  showError, showSpinner, setStatus, updateButtons, clearError,
  sizeCanvases, clearBase, clearPen, stageEl, canvasWrap, dropzone,
} from './ui.js';
import { buildTimeline } from './timeline.js';
import { replay, cancelAnim } from './animation.js';
import { stopRecording } from './export.js';

const DEV = import.meta.env.DEV;

export function hsvToCss(h, s, v) {
  const H = ((h * 2) % 360 + 360) % 360;           // OpenCV hue 0-179 → degrees
  const S = Math.max(0, Math.min(255, s)) / 255;
  const V = Math.max(0, Math.min(255, v)) / 255;
  const c = V * S, x = c * (1 - Math.abs((H / 60) % 2 - 1)), m = V - c;
  let r = 0, g = 0, b = 0;
  if (H < 60) { r = c; g = x; } else if (H < 120) { r = x; g = c; }
  else if (H < 180) { g = c; b = x; } else if (H < 240) { g = x; b = c; }
  else if (H < 300) { r = x; b = c; } else { r = c; b = x; }
  const t = n => Math.round((n + m) * 255);
  return `rgb(${t(r)},${t(g)},${t(b)})`;
}

// full pipeline: detect → binary → skeleton → contours → chunks → colors
async function runPipeline(rgb, gen) {
  const rows = rgb.rows, cols = rgb.cols;
  const mats = [];
  const keep = m => { mats.push(m); return m; };
  // dev-only diagnostics: per-stage ms + stroke-sanity numbers (window.__diag)
  const D = DEV ? (window.__diag = window.__diag || {}) : null;
  if (D) { D.stages = {}; D.img = { w: cols, h: rows }; }
  let _t = DEV ? performance.now() : 0;
  const mark = name => {
    if (D) { D.stages[name] = +(performance.now() - _t).toFixed(1); _t = performance.now(); }
  };
  const pipeT0 = DEV ? performance.now() : 0;
  try {
    /* --- auto-detect: neon vs photo, colorful vs dull --- */
    const gray = keep(new cv.Mat());
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    let sum = 0;                                    // mean(gray), manual = safe
    const gd = gray.data;
    for (let i = 0; i < gd.length; i++) sum += gd[i];
    const mean = sum / gd.length;
    const bright = keep(new cv.Mat());
    cv.threshold(gray, bright, 40, 255, cv.THRESH_BINARY);
    const fracBright = cv.countNonZero(bright) / (rows * cols);
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    // colorful fraction: manual HSV scan — inRange with Scalar/1×1-Mat bounds
    // is unreliable in OpenCV.js 4.9, so we count pixels directly (S > 60, V > 40)
    let colorful = 0;
    const hd = hsv.data;
    for (let i = 0; i < hd.length; i += 3) {
      if (hd[i + 1] > 60 && hd[i + 2] > 40) colorful++;
    }
    const fracColorful = colorful / (rows * cols);
    const autoNeon = mean < 70 && fracBright < 0.25;
    const mode = state.settings.mode === 'auto' ? (autoNeon ? 'neon' : 'photo') : state.settings.mode;
    const colorMode = state.settings.color === 'auto'
      ? ((mode === 'neon' || fracColorful > 0.12) ? 'original' : 'gradient')
      : state.settings.color;
    if (D) D.detect = { mean: +mean.toFixed(1), fracBright: +fracBright.toFixed(3), fracColorful: +fracColorful.toFixed(3), mode };
    mark('detect');

    /* --- binary line mask --- */
    const binary = keep(new cv.Mat());
    if (mode === 'neon') {
      cv.threshold(gray, binary, 40, 255, cv.THRESH_BINARY);
    } else {
      const bil = keep(new cv.Mat());
      cv.bilateralFilter(rgb, bil, 7, 40, 40);
      const bg = keep(new cv.Mat());
      cv.cvtColor(bil, bg, cv.COLOR_RGB2GRAY);
      const bl = keep(new cv.Mat());
      cv.blur(bg, bl, new cv.Size(3, 3));
      const o = keep(new cv.Mat());
      const otsu = cv.threshold(bl, o, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      const hi = Math.max(20, otsu / state.settings.detail);
      const edges = keep(new cv.Mat());
      cv.Canny(bl, edges, hi / 2, hi);
      const dilK = keep(cv.Mat.ones(2, 2, cv.CV_8U));
      cv.dilate(edges, binary, dilK);
    }
    mark('binary');

    /* --- skeletonize (morphological, cap 200 iters) --- */
    let temp = binary.clone();
    const skeleton = keep(new cv.Mat.zeros(rows, cols, cv.CV_8U));
    const cross = keep(cv.getStructuringElement(cv.MORPH_CROSS, new cv.Size(3, 3)));
    let iter = 0;
    try {
      while (cv.countNonZero(temp) > 0 && iter < 200) {
        const eroded = new cv.Mat();
        cv.erode(temp, eroded, cross);
        const opened = new cv.Mat();
        cv.dilate(eroded, opened, cross);
        const diff = new cv.Mat();
        cv.subtract(temp, opened, diff);
        cv.bitwise_or(skeleton, diff, skeleton);
        temp.delete(); temp = eroded;
        opened.delete(); diff.delete();
        if (++iter % 4 === 0) {                     // spinner ke liye browser ko haath
          await yieldToBrowser();
          if (gen !== state.gen) throw ABORT;
        }
      }
    } finally {
      temp.delete();
    }
    if (D) D.skeletonIters = iter;
    mark('skeleton');

    /* --- contours: drop tiny, longest first --- */
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(skeleton, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
    hierarchy.delete();
    const found = contours.size();
    const big = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const n = cnt.rows;
      if (n >= 12) {
        const ds = cnt.data32S;
        const pts = new Array(n);
        for (let j = 0; j < n; j++) pts[j] = { x: ds[j * 2], y: ds[j * 2 + 1] };
        big.push(pts);
      }
      cnt.delete();
    }
    contours.delete();
    big.sort((a, b) => b.length - a.length);
    if (D) D.contours = { found, kept: big.length };
    mark('contours');

    /* --- retrace removal: global visited map, split non-consecutive runs --- */
    const visited = new Uint8Array(rows * cols);
    const runs = [];
    const vStat = DEV ? { len: visited.length, maxIdx: -1, outOfRange: 0, xOver: 0, yOver: 0 } : null;
    for (const c of big) {
      let run = [], prev = -2;
      for (let i = 0; i < c.length; i++) {
        const p = c[i];
        if (vStat) {
          if (p.x >= cols) vStat.xOver++;
          if (p.y >= rows) vStat.yOver++;
        }
        const idx = p.y * cols + p.x;
        if (vStat) {
          if (idx > vStat.maxIdx) vStat.maxIdx = idx;
          if (idx < 0 || idx >= visited.length) vStat.outOfRange++;
        }
        if (!visited[idx]) {
          visited[idx] = 1;
          if (run.length && i !== prev + 1) {
            if (run.length >= 6) runs.push(run);
            run = [];
          }
          run.push(p); prev = i;
        }
      }
      if (run.length >= 6) runs.push(run);
    }
    // dev-only sanity: runs must be 8-adjacent pixel chains — non-adjacent
    // points here would mean the run split failed and simplification could shortcut
    if (D) {
      let badRuns = 0, badPairs = 0, pairs = 0, example = null;
      for (const r of runs) {
        let bad = false;
        for (let i = 1; i < r.length; i++) {
          pairs++;
          const dx = Math.abs(r[i].x - r[i - 1].x), dy = Math.abs(r[i].y - r[i - 1].y);
          if (dx > 1 || dy > 1) {
            badPairs++;
            if (!example) example = { from: { x: r[i - 1].x, y: r[i - 1].y }, to: { x: r[i].x, y: r[i].y }, at: i };
            bad = true;
          }
        }
        if (bad) badRuns++;
      }
      D.adjacency = { runs: runs.length, pairs, badRuns, badPairs, example };
      D.visited = vStat;
    }
    mark('retrace');

    /* --- approxPolyDP → 8-vertex chunks sharing one vertex --- */
    const chunks = [];
    let runId = 0;
    const longest = DEV ? [] : null;
    for (const run of runs) {
      if (gen !== state.gen) throw ABORT;
      const pm = new cv.Mat(run.length, 1, cv.CV_32SC2);
      const pd = pm.data32S;
      for (let j = 0; j < run.length; j++) { pd[j * 2] = run[j].x; pd[j * 2 + 1] = run[j].y; }
      const approx = new cv.Mat();
      cv.approxPolyDP(pm, approx, 1.0, false);
      pm.delete();
      const verts = [];
      for (let j = 0; j < approx.rows; j++) {
        verts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
      }
      approx.delete();
      if (longest) {                       // dev: longest segment after simplification
        let maxD = -1, seg = null;
        for (let j = 1; j < verts.length; j++) {
          const d = Math.hypot(verts[j].x - verts[j - 1].x, verts[j].y - verts[j - 1].y);
          if (d > maxD) { maxD = d; seg = { from: { ...verts[j - 1] }, to: { ...verts[j] } }; }
        }
        longest.push({ runId, inLen: run.length, outLen: verts.length, maxSeg: +maxD.toFixed(1), seg });
      }
      for (let s = 0; s < verts.length - 1; s += 7) {
        chunks.push({ pts: verts.slice(s, Math.min(s + 8, verts.length)), newStroke: s === 0, runId });
      }
      runId++;
    }
    if (D) {
      D.approx = { calls: runs.length, inTotal: runs.reduce((n, r) => n + r.length, 0) };
      longest.sort((a, b) => b.maxSeg - a.maxSeg);
      D.longestSegments = longest.slice(0, 8);
      D.runs = runs.length;
      D.chunks = chunks.length;
      D.strokes = chunks.reduce((n, c) => n + (c.newStroke ? 1 : 0), 0);
    }
    mark('simplify');
    if (!chunks.length) throw new Error('No lines found - try raising Detail or switching Mode.');

    /* --- chunk colors --- */
    let bhsv = null;
    if (colorMode === 'original') {
      const bs = new cv.Mat();
      const k = mode === 'neon' ? 3 : 5;
      cv.blur(rgb, bs, new cv.Size(k, k));
      bhsv = new cv.Mat();
      cv.cvtColor(bs, bhsv, cv.COLOR_RGB2HSV);
      bs.delete();
    }
    const hMax = rows - 1;
    for (const ch of chunks) {
      const mid = ch.pts[Math.floor(ch.pts.length / 2)];
      const x = Math.max(0, Math.min(cols - 1, mid.x));
      const y = Math.max(0, Math.min(rows - 1, mid.y));
      let css;
      if (colorMode === 'original') {
        const ptr = bhsv.ucharPtr(y, x);
        let s = ptr[1];
        s = mode === 'neon' ? Math.min(255, s * 1.3) : Math.min(255, s * 1.4 + 30);
        css = hsvToCss(ptr[0], s, 255);
      } else {
        const h = 55 + 60 * (hMax > 0 ? y / hMax : 0);   // per-row hue 55→115
        css = hsvToCss(h, 200, 255);
      }
      ch.color = css;
    }
    if (bhsv) bhsv.delete();
    mark('colors');
    if (D) D.totalMs = +(performance.now() - pipeT0).toFixed(1);

    return { chunks, mode, colorMode, w: cols, h: rows };
  } finally {
    for (const m of mats) m.delete();                // har Mat ka hisaab
  }
}

// intake: validate type/size, load, hand off to startProcessing
export function handleFile(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) return showError('Only image files are supported (image/*).');
  if (file.size > 25 * 1024 * 1024) return showError('Image too large — maximum is 25 MB.');
  if (!state.cvReady) return showError('Still loading OpenCV.js — try again in a second.');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); startProcessing(img); };
  img.onerror = () => { URL.revokeObjectURL(url); showError('Could not read that image file.'); };
  img.src = url;
}

// new upload: fit → white bg → INTER_AREA → RGB, then pipeline
async function startProcessing(img) {
  const gen = ++state.gen;
  cancelAnim();
  stopRecording(true);
  clearError();
  showSpinner(true);
  setStatus('Processing…');
  await yieldToBrowser();                          // spinner dikhe before heavy work
  let rgb3 = null;
  try {
    if (state.cache) { state.cache.rgb.delete(); state.cache = null; }
    const maxH = Math.min(0.7 * window.innerHeight, 800);
    const maxW = Math.max(120, stageEl.clientWidth - 28);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const scale = Math.min(maxW / nw, maxH / nh, 1);
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const oc = document.createElement('canvas');
    oc.width = nw; oc.height = nh;
    const octx = oc.getContext('2d');
    octx.fillStyle = '#ffffff';                    // transparent → white
    octx.fillRect(0, 0, nw, nh);
    octx.drawImage(img, 0, 0);
    let src = null, rgb = null;
    try {
      src = cv.imread(oc);
      rgb = new cv.Mat();
      cv.resize(src, rgb, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    } finally { if (src) src.delete(); }
    rgb3 = new cv.Mat();
    cv.cvtColor(rgb, rgb3, cv.COLOR_RGBA2RGB);
    rgb.delete();
    state.cache = { rgb: rgb3 };
    const res = await runPipeline(rgb3, gen);
    if (gen !== state.gen) return;                 // koi naya upload aa gaya
    applyResult(res);
    canvasWrap.hidden = false;
    dropzone.classList.add('hidden');
    replay();
  } catch (e) {
    if (e !== ABORT) showError(e.message || String(e));
  } finally {
    if (gen === state.gen) showSpinner(false);
  }
}

// re-run pipeline from cached image (Detail / Mode / Color changed)
export async function reprocess() {
  if (!state.cache) return;
  const gen = ++state.gen;
  cancelAnim();
  stopRecording(true);
  clearError();
  showSpinner(true);
  setStatus('Processing…');
  await yieldToBrowser();
  try {
    const res = await runPipeline(state.cache.rgb, gen);
    if (gen !== state.gen) return;
    applyResult(res);
    replay();
  } catch (e) {
    if (e !== ABORT) showError(e.message || String(e));
  } finally {
    if (gen === state.gen) showSpinner(false);
  }
}

function applyResult(res) {
  state.chunks = res.chunks;
  state.mode = res.mode;
  state.colorMode = res.colorMode;
  state.imgW = res.w;
  state.imgH = res.h;
  state.processed = true;
  buildTimeline();
  sizeCanvases();
  clearBase();
  clearPen();
  setStatus(`Ready — ${res.mode} mode, ${res.colorMode} colors.`);
  updateButtons();
}
