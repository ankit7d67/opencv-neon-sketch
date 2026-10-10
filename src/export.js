// PNG export, WebM video recording, and the offscreen record-composite canvas.
import { state } from './state.js';
import { glowCv, baseCv, penCv, recCv, recCheckbox, recCtx, setStatus } from './ui.js';

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// PNG: glow + core, then additive blurred copies of the core (3px @0.7,
// 9px @0.45) — the additive blur lives only here, not in the live canvas.
export function exportPNG() {
  if (!state.processed || !baseCv) return;
  const out = document.createElement('canvas');
  out.width = baseCv.width;
  out.height = baseCv.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(glowCv, 0, 0);
  ctx.drawImage(baseCv, 0, 0);
  if ('filter' in ctx) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.filter = 'blur(3px)';
    ctx.drawImage(baseCv, 0, 0);
    ctx.globalAlpha = 0.45;
    ctx.filter = 'blur(9px)';
    ctx.drawImage(baseCv, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  out.toBlob(blob => { if (blob) downloadBlob(blob, 'neon-sketch.png'); }, 'image/png');
}

// video: offscreen composite canvas → captureStream → MediaRecorder → WebM
export function compositeRecord() {
  if (!state.recording || !recCtx) return;
  recCtx.drawImage(glowCv, 0, 0);
  recCtx.drawImage(baseCv, 0, 0);
  recCtx.drawImage(penCv, 0, 0);
}

export function startRecording() {
  stopRecording(false);                    // stop any old recording, keep checkbox state
  if (!recCv) return;
  const stream = recCv.captureStream(30);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';
  state.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  state.recBuf = [];
  state.recorder.ondataavailable = e => { if (e.data && e.data.size) state.recBuf.push(e.data); };
  state.recorder.onstop = () => {
    const buf = state.recBuf;
    state.recBuf = [];
    if (buf.length) downloadBlob(new Blob(buf, { type: 'video/webm' }), 'neon-sketch.webm');
  };
  state.recorder.start(250);
  state.recording = true;
  compositeRecord();
  setStatus('Recording video… uncheck to stop & download.');
}

export function stopRecording(internal) {
  const rec = state.recorder;
  if (rec && rec.state !== 'inactive') {
    const buf = state.recBuf;
    rec.onstop = () => {
      if (buf.length) downloadBlob(new Blob(buf, { type: 'video/webm' }), 'neon-sketch.webm');
    };
    try { rec.stop(); } catch (e) { /* already stopped */ }
  }
  state.recorder = null;
  state.recording = false;
  if (internal) recCheckbox.checked = false;
}
