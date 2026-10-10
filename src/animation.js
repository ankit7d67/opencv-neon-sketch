// Stroke rendering + the clock-driven animation loop.
import { state } from './state.js';
import { baseCtx, glowCtx, penCtx, clearBase, clearPen, setStatus, setProgress, updateButtons } from './ui.js';
import { compositeRecord } from './export.js';

const DEV = import.meta.env.DEV;

export function seg(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// one tiny piece of stroke. Glow canvas underneath (source-over, thicker,
// softened by CSS blur) + core line on top (source-over). No 'lighter'
// during animation → no bright beads where round caps overlap.
export function drawPiece(a, b, color) {
  if (DEV && window.__diag) window.__diag.piecesFrame = (window.__diag.piecesFrame || 0) + 1;
  const w = state.settings.thickness;
  // core line
  const ctx = baseCtx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 1;
  ctx.lineWidth = w;
  seg(ctx, a, b);
  // glow halo
  if (state.settings.glow) {
    const g = glowCtx;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = color;
    g.globalAlpha = 0.16; g.lineWidth = w + 8; seg(g, a, b);
    g.globalAlpha = 0.38; g.lineWidth = w + 3; seg(g, a, b);
  }
}

export function setPen(pt, color) {
  clearPen();
  if (!state.settings.penTip || !pt) return;
  const ctx = penCtx;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = color;                            // halo r=9, stroke color
  ctx.beginPath(); ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#ffffff';                        // core r=3
  ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function resetDrawState() {
  const anim = state.anim;
  anim.curChunk = 0; anim.vIdx = 0; anim.penChunk = 0;
  const first = state.chunks[0];
  anim.penPt = first ? { x: first.pts[0].x, y: first.pts[0].y } : null;
  anim.penColor = first ? first.color : '#fff';
}

// draw only the newly-revealed part up to time t
export function drawUpTo(anim, t) {
  const chunks = state.chunks;
  let i = anim.curChunk;
  while (i < chunks.length) {
    const c = chunks[i];
    if (t < c.start) {                              // pause gap — pen waits at stroke start
      anim.penPt = { x: c.pts[0].x, y: c.pts[0].y };
      anim.penColor = c.color;
      anim.penChunk = i;
      setPen(anim.penPt, c.color);
      return;
    }
    if (t >= c.start + c.dur) {                     // chunk fully due — draw it whole
      let from = (i === anim.curChunk && anim.vIdx > 0) ? anim.penPt : c.pts[0];
      for (let k = anim.vIdx; k < c.pts.length - 1; k++) {
        drawPiece(from, c.pts[k + 1], c.color);
        from = c.pts[k + 1];
      }
      i++; anim.curChunk = i; anim.vIdx = 0;
      anim.penPt = from;
      anim.penChunk = i - 1;
      continue;
    }
    // dev-only: a stale pen tip about to be drawn at a fresh chunk means the
    // next segment joins two different strokes (the "web of lines" symptom)
    if (DEV && anim.vIdx === 0 && anim.penChunk !== i && anim.penPt && window.__diag && window.__diag.crossStroke) {
      const dist = Math.hypot(anim.penPt.x - c.pts[0].x, anim.penPt.y - c.pts[0].y);
      if (dist > 1.5) {
        const prev = chunks[i - 1];
        window.__diag.crossStroke.push({
          chunkIdx: i, newStroke: !!c.newStroke, runId: c.runId,
          prevRunId: prev ? prev.runId : null, dist: +dist.toFixed(1),
          from: { x: Math.round(anim.penPt.x), y: Math.round(anim.penPt.y) },
          to: { x: c.pts[0].x, y: c.pts[0].y },
        });
      }
    }
    anim.penChunk = i;                             // tip now belongs to chunk i
    drawPartial(anim, c, t - c.start);   // chunk-local time
    return;
  }
}

function drawPartial(anim, c, t) {
  const pts = c.pts, times = c.times;
  while (anim.vIdx < pts.length - 1 && t >= times[anim.vIdx + 1]) {
    drawPiece(anim.penPt, pts[anim.vIdx + 1], c.color);
    anim.penPt = pts[anim.vIdx + 1];
    anim.vIdx++;
  }
  if (anim.vIdx < pts.length - 1) {
    const k = anim.vIdx;
    const span = times[k + 1] - times[k];
    const f = span > 0 ? Math.min(1, Math.max(0, (t - times[k]) / span)) : 1;
    const tx = pts[k].x + (pts[k + 1].x - pts[k].x) * f;
    const ty = pts[k].y + (pts[k + 1].y - pts[k].y) * f;
    drawPiece(anim.penPt, { x: tx, y: ty }, c.color);
    anim.penPt = { x: tx, y: ty };
  }
  setPen(anim.penPt, c.color);
}

function tick() {
  const anim = state.anim;
  if (!anim.alive || !anim.playing) return;
  if (DEV && window.__diag) {                      // dev-only frame profiling
    const d = window.__diag;
    const now = performance.now();
    if (d.frameLast) d.frameDeltas.push(+(now - d.frameLast).toFixed(2));
    d.frameLast = now;
    d.framePieces.push(d.piecesFrame || 0);
    d.piecesFrame = 0;
  }
  const elapsed = anim.offset + (performance.now() - anim.stamp);
  drawUpTo(anim, elapsed);
  const p = state.totalMs > 0 ? Math.min(100, (elapsed / state.totalMs) * 100) : 100;
  setProgress(p);
  // keep the recording indicator visible — the tick overwrites status every frame
  setStatus(state.recording ? 'Recording video… ' + Math.round(p) + '%' : 'Drawing… ' + Math.round(p) + '%');
  compositeRecord();
  if (elapsed >= state.totalMs) { finishAnim(); return; }
  anim.raf = requestAnimationFrame(tick);
}

function finishAnim() {
  const anim = state.anim;
  anim.playing = false;
  anim.finished = true;
  cancelAnimationFrame(anim.raf);
  clearPen();
  setProgress(100);
  setStatus('Done — Download PNG, record video, or hit Replay.');
  updateButtons();
  compositeRecord();
}

export function replay() {
  if (!state.processed || !state.chunks.length) return;
  if (DEV) {                                       // dev-only diag reset per run
    const d = window.__diag = window.__diag || {};
    d.crossStroke = []; d.frameDeltas = []; d.framePieces = [];
    d.piecesFrame = 0; d.frameLast = 0; d.penLifts = 0;
  }
  cancelAnim();
  clearBase();
  clearPen();
  state.anim = { alive: true, started: true, playing: false, finished: false,
                 offset: 0, stamp: 0, raf: 0, curChunk: 0, vIdx: 0, penPt: null, penColor: '#fff' };
  resetDrawState();
  updateButtons();
  if (state.totalMs <= 0) { skipToEnd(); return; }  // Duration 0 = instant
  const anim = state.anim;
  setPen(anim.penPt, anim.penColor);
  anim.playing = true;
  anim.stamp = performance.now();
  setStatus('Drawing…');
  anim.raf = requestAnimationFrame(tick);
}

export function togglePause() {
  const anim = state.anim;
  if (!state.processed || !anim.started || anim.finished) return;
  if (anim.playing) {
    anim.offset += performance.now() - anim.stamp;
    anim.playing = false;
    cancelAnimationFrame(anim.raf);
    setStatus('Paused.');
  } else {
    anim.stamp = performance.now();
    anim.playing = true;
    setStatus('Drawing…');
    anim.raf = requestAnimationFrame(tick);
  }
  updateButtons();
  compositeRecord();
}

export function skipToEnd() {
  const anim = state.anim;
  if (!state.processed || !anim.started || anim.finished) return;
  anim.playing = false;
  cancelAnimationFrame(anim.raf);
  const chunks = state.chunks;
  if (anim.curChunk < chunks.length) {
    const c = chunks[anim.curChunk];
    let from = anim.vIdx > 0 ? anim.penPt : c.pts[0];
    for (let k = anim.vIdx; k < c.pts.length - 1; k++) {
      drawPiece(from, c.pts[k + 1], c.color);
      from = c.pts[k + 1];
    }
  }
  for (let i = anim.curChunk + 1; i < chunks.length; i++) {
    const c = chunks[i];
    for (let k = 0; k < c.pts.length - 1; k++) drawPiece(c.pts[k], c.pts[k + 1], c.color);
  }
  finishAnim();
}

export function cancelAnim() {
  const anim = state.anim;
  if (anim) { anim.alive = false; anim.playing = false; cancelAnimationFrame(anim.raf); }
}
