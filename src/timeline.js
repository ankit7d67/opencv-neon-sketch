// Clock-based timeline: constant pen speed, drawing ends in exactly Duration seconds.
import { state } from './state.js';

export function buildTimeline() {
  const chunks = state.chunks;
  const totalMs = state.settings.duration * 1000;
  const numStrokes = chunks.reduce((n, c) => n + (c.newStroke ? 1 : 0), 0);
  let totalLength = 0;
  for (const c of chunks) {
    let L = 0;
    for (let i = 1; i < c.pts.length; i++) {
      L += Math.hypot(c.pts[i].x - c.pts[i - 1].x, c.pts[i].y - c.pts[i - 1].y);
    }
    c.len = L; totalLength += L;
  }
  const pauseMs = numStrokes ? Math.min(40, 0.25 * totalMs / numStrokes) : 0;
  const msPerPx = totalLength > 0 ? Math.max(0, (totalMs - numStrokes * pauseMs) / totalLength) : 0;
  let cursor = 0;
  for (const c of chunks) {
    if (c.newStroke) cursor += pauseMs;
    c.start = cursor;
    c.times = [0];
    for (let i = 1; i < c.pts.length; i++) {
      const d = Math.hypot(c.pts[i].x - c.pts[i - 1].x, c.pts[i].y - c.pts[i - 1].y);
      c.times.push(c.times[i - 1] + d * msPerPx);
    }
    c.dur = c.times[c.times.length - 1];
    cursor += c.dur;
  }
  state.totalMs = totalMs;
}
