// Single source of truth for app state. No DOM access lives here.
export const ABORT = { abort: true };              // internal cancel signal — never shown to user

export const state = {
  cvReady: false,
  gen: 0,                                   // bump to cancel stale processing / animation
  settings: { duration: 20, detail: 1, thickness: 2, mode: 'auto', color: 'auto', glow: true, penTip: true, smooth: false },
  cache: null,                              // { rgb: cv.Mat } — fitted original, re-used on settings change
  processed: false,
  chunks: [],                               // [{ pts:[{x,y}..], color, newStroke, start, dur, times:[] }]
  totalMs: 0,
  imgW: 0, imgH: 0,
  mode: '', colorMode: '',
  anim: { alive: false, started: false, playing: false, finished: false, offset: 0, stamp: 0, raf: 0,
          curChunk: 0, vIdx: 0, penPt: null, penColor: '#fff' },
  recording: false, recorder: null, recBuf: [],
};

export const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));
