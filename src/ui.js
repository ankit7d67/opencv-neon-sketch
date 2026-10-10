// Owns every DOM reference and all UI helpers. Other modules import these
// (canvas contexts are `export let` — live bindings, re-assigned in sizeCanvases).
import { state } from './state.js';

const $ = id => document.getElementById(id);

// stage & dropzone
export const stageEl = $('stage');
export const canvasWrap = $('canvasWrap');
export const glowCv = $('glowCv');
export const baseCv = $('baseCv');
export const penCv = $('penCv');
export const dropzone = $('dropzone');
export const dzHint = $('dzHint');
export const spinner = $('spinner');

// controls
export const durEl = $('dur');
export const durVal = $('durVal');
export const detEl = $('det');
export const detVal = $('detVal');
export const thickEl = $('thick');
export const thickVal = $('thickVal');
export const modeEl = $('mode');
export const colorEl = $('color');
export const glowEl = $('glow');
export const penEl = $('pentip');

// buttons
export const playBtn = $('playBtn');
export const pauseBtn = $('pauseBtn');
export const skipBtn = $('skipBtn');
export const pngBtn = $('pngBtn');
export const upBtn = $('upBtn');
export const recCheckbox = $('rec');

// progress & status
export const progWrap = $('progWrap');
export const progFill = $('progFill');
export const progPct = $('progPct');
export const statusEl = $('status');
export const errorBox = $('errorBox');
export const fileInput = $('fileInput');

// canvas contexts — re-assigned by sizeCanvases() on every new image
export let glowCtx = null, baseCtx = null, penCtx = null, recCv = null, recCtx = null;

export function setStatus(msg) { statusEl.textContent = msg; }

export function setProgress(p) {
  const v = Math.max(0, Math.min(100, p));
  progFill.style.width = v + '%';
  progPct.textContent = Math.round(v) + '%';
  progWrap.setAttribute('aria-valuenow', String(Math.round(v)));
}

export function showSpinner(on) { spinner.hidden = !on; }

let errTimer = 0;
export function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  setStatus('Error: ' + msg);
  clearTimeout(errTimer);
  errTimer = setTimeout(() => { errorBox.hidden = true; }, 9000);
}

export function clearError() { errorBox.hidden = true; }

export function updateButtons() {
  const has = state.processed, a = state.anim;
  playBtn.disabled = !has;
  pauseBtn.disabled = !(has && a.started && !a.finished);
  pauseBtn.textContent = a.playing ? '⏸ Pause' : '▶ Resume';
  skipBtn.disabled = !(has && a.started && !a.finished);
  pngBtn.disabled = !has;
  recCheckbox.disabled = !has;
}

export function sizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, state.imgW), h = Math.max(1, state.imgH);
  for (const c of [glowCv, baseCv, penCv]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  }
  glowCtx = glowCv.getContext('2d');
  glowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  baseCtx = baseCv.getContext('2d');
  baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  penCtx = penCv.getContext('2d');
  penCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  recCv = document.createElement('canvas');
  recCv.width = baseCv.width;
  recCv.height = baseCv.height;
  recCtx = recCv.getContext('2d');
}

export function clearBase() {
  if (baseCtx) baseCtx.clearRect(0, 0, state.imgW, state.imgH);
  if (glowCtx) glowCtx.clearRect(0, 0, state.imgW, state.imgH);
}
export function clearPen() { if (penCtx) penCtx.clearRect(0, 0, state.imgW, state.imgH); }
