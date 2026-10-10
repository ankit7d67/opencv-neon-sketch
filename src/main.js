// Entry point: wires the UI to the modules and boots the app.
import { state } from './state.js';
import {
  durEl, durVal, detEl, detVal, thickEl, thickVal, modeEl, colorEl,
  glowEl, penEl, smoothEl, playBtn, pauseBtn, skipBtn, pngBtn, upBtn, recCheckbox,
  dropzone, dzHint, fileInput, clearBase, clearPen, setStatus, showError, updateButtons,
} from './ui.js';
import { handleFile, reprocess } from './processing.js';
import { buildTimeline } from './timeline.js';
import { replay, togglePause, skipToEnd, resetDrawState, drawUpTo, setPen } from './animation.js';
import { exportPNG, startRecording, stopRecording, compositeRecord } from './export.js';

/* --------------------------- WIRING ---------------------------- */
const durLabel = v => (v === 0 ? 'instant' : v + 's');

durEl.addEventListener('input', () => {
  state.settings.duration = parseInt(durEl.value, 10);
  durVal.textContent = durLabel(state.settings.duration);
  if (!state.processed) return;
  // sirf timeline rebuild — progress fraction bacha ke chalao
  const anim = state.anim;
  const frac = (anim.started && !anim.finished && state.totalMs > 0)
    ? (anim.offset + (anim.playing ? performance.now() - anim.stamp : 0)) / state.totalMs
    : 0;
  buildTimeline();
  if (anim.started && !anim.finished) {
    clearBase();
    clearPen();
    resetDrawState();
    const target = frac * state.totalMs;
    if (target > 0) drawUpTo(anim, target);
    if (anim.curChunk >= state.chunks.length && state.chunks.length) {
      const last = state.chunks[state.chunks.length - 1];
      anim.penPt = { x: last.pts[last.pts.length - 1].x, y: last.pts[last.pts.length - 1].y };
      setPen(anim.penPt, last.color);
    }
    anim.offset = target;
    anim.stamp = performance.now();
    compositeRecord();
  }
});

let detTimer = 0;
detEl.addEventListener('input', () => {
  state.settings.detail = parseFloat(detEl.value);
  detVal.textContent = state.settings.detail.toFixed(1);
  clearTimeout(detTimer);
  detTimer = setTimeout(reprocess, 250);            // debounce — heavy pipeline
});

thickEl.addEventListener('input', () => {
  state.settings.thickness = parseFloat(thickEl.value);
  thickVal.textContent = String(state.settings.thickness);
  if (!state.processed || !state.anim.started) return;
  if (state.anim.finished) {                        // redraw finished art at new width
    clearBase();
    resetDrawState();
    drawUpTo(state.anim, Infinity);
    compositeRecord();
  } else {
    replay();
  }
});

modeEl.addEventListener('change', () => { state.settings.mode = modeEl.value; reprocess(); });
colorEl.addEventListener('change', () => { state.settings.color = colorEl.value; reprocess(); });
glowEl.addEventListener('change', () => { state.settings.glow = glowEl.checked; });
penEl.addEventListener('change', () => {
  state.settings.penTip = penEl.checked;
  if (!penEl.checked) clearPen();
});
smoothEl.addEventListener('change', () => { state.settings.smooth = smoothEl.checked; reprocess(); });

playBtn.addEventListener('click', replay);
pauseBtn.addEventListener('click', togglePause);
skipBtn.addEventListener('click', skipToEnd);
pngBtn.addEventListener('click', exportPNG);
upBtn.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });

recCheckbox.addEventListener('change', () => {
  if (recCheckbox.checked) {
    if (!state.processed) { recCheckbox.checked = false; return; }
    startRecording();
  } else {
    stopRecording(false);
  }
});

// drag-drop anywhere, paste anywhere
window.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('hot'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) dropzone.classList.remove('hot'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('hot');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    handleFile(e.dataTransfer.files[0]);
  }
});
window.addEventListener('paste', e => {
  if (!e.clipboardData || !e.clipboardData.items) return;
  for (const item of e.clipboardData.items) {
    if (item.type && item.type.startsWith('image/')) { handleFile(item.getAsFile()); break; }
  }
});

/* ------------------------------ INIT --------------------------- */
function boot() {
  state.cvReady = true;
  dzHint.textContent = 'Click, drop, or paste an image to begin';
  setStatus('Ready — drop, click, or paste an image.');
}

// cv.js can execute before or after this module — handle both orders.
if (window.cvReadyFired) {
  boot();
} else {
  window.addEventListener('opencv-ready', boot);
}

setTimeout(() => {
  if (!state.cvReady) {
    dzHint.textContent = 'OpenCV.js failed to load — check connection and reload.';
    showError('OpenCV.js failed to load. Check your connection and reload the page.');
  }
}, 15000);

if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  durEl.value = '0';
  state.settings.duration = 0;
  durVal.textContent = 'instant';
}

window.__neon = { state };   // test hook — lets the e2e suite read app state
updateButtons();
