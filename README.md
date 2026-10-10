# Neon Sketch

Turn any image into a **glowing neon line-sketch** — animated stroke by stroke with a moving pen tip, entirely in your browser. Built with vanilla JS, Canvas 2D and OpenCV.js. No React, no framework, no build-time magic beyond Vite.

**Your images never leave your device.** All processing happens locally — no uploads, no servers.

## Features

- **Stroke-by-stroke animation** with a glowing pen tip that waits at the start of each stroke
- **Auto mode detection**: dark neon-on-black line art → threshold + original colors; normal photos → Canny edges + gradient colors; colorful images keep their original colors
- **Controls**: Duration (0–60 s, 0 = instant), Detail (0.5–2), Line thickness (1–5), Mode (Auto/Neon/Photo), Color style (Auto/Original/Gradient), Glow and Pen-tip toggles
- **Playback**: Replay, Pause/Resume, Skip to end
- **Export**: PNG (with additive glow bloom) and WebM video (via `captureStream` + `MediaRecorder`)
- **Input**: click, drag-drop anywhere, or paste (Ctrl+V) — `image/*` only, max 25 MB
- Responsive from 375 px up, `devicePixelRatio`-aware, `prefers-reduced-motion` friendly (defaults to instant)

## How the pipeline works

1. **Fit** — the image is drawn on an offscreen canvas (transparent → white) and resized with `INTER_AREA` to fit the stage (max height `min(0.7·vh, 800)`, max width = container).
2. **Detect** — Auto picks *neon* when `mean(gray) < 70` and the fraction of pixels above gray 40 is `< 0.25`, else *photo*. *Colorful* when the fraction of saturated pixels (HSV `S > 60, V > 40`) exceeds `0.12`.
3. **Binary lines** — Neon: threshold gray at 40. Photo: `bilateralFilter(7,40,40)` → gray → 3×3 blur → Otsu value → `hi = max(20, otsu/Detail)`, `lo = hi/2` → Canny → 2×2 dilate.
4. **Skeletonize** — morphological loop (erode/dilate with 3×3 cross), capped at 200 iterations.
5. **Contours** — `findContours(RETR_LIST, CHAIN_APPROX_NONE)`, drop contours under 12 points, sort longest first.
6. **Retrace removal** — a global visited map keeps only first occurrences; non-consecutive runs become separate strokes (runs under 6 points dropped).
7. **Simplify** — `approxPolyDP(ε=1.0)`, then split into chunks of ≤ 8 vertices sharing one vertex; each chunk is one color, sampled at its middle vertex.
8. **Colors** — Original: blurred HSV with boosted saturation, `V = 255`. Gradient: per-row hue 55 (top) → 115 (bottom), `S = 200, V = 255`.
9. **Timeline** — clock-based: `pauseMs = min(40, 0.25·totalMs/strokes)`, `msPerPx = (totalMs − strokes·pauseMs)/totalLength`, per-vertex cumulative times. The pen moves at constant speed and the drawing ends in exactly Duration seconds on any device.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5180
```

Open the URL, drop an image, and watch it draw.

## Build & deploy

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

`vite.config.js` sets `base: './'`, so the build can be served from any subdirectory or static host (GitHub Pages, Netlify, itch.io…) without changes. `public/opencv.js` is copied as-is — OpenCV.js loads locally, no CDN needed.

## Project layout

```
index.html          markup only
src/
  main.js           entry: event wiring + boot
  state.js          shared app state
  ui.js             DOM refs + UI helpers
  processing.js     OpenCV pipeline (detect → skeleton → contours → chunks)
  timeline.js       clock-based timeline math
  animation.js      stroke rendering + rAF loop
  export.js         PNG export + WebM recording
src/styles.css      all styles
public/opencv.js   local OpenCV.js 4.9.0 (no CDN)
tests/e2e.mjs       Playwright smoke test (page load, OpenCV init, upload,
                    Duration-10 timing, pause/resume/skip/replay, PNG/WebM,
                    375 px viewport, screenshot)
test-images/        generated test fixtures
tools/make-test-images.mjs   regenerates the fixtures
```

## Tests

```bash
npm run test:images   # regenerate test fixtures
node tests/e2e.mjs http://localhost:5180
node tests/e2e.mjs file:///absolute/path/to/original.html baseline
```

The e2e test records console errors and checks: page load, OpenCV init, the "Processing…" overlay being hidden at idle and after processing (it must only appear *during* processing), auto-detect (neon/photo/colorful), a 10-second Duration run, Pause/Resume/Skip/Replay, PNG export, "No lines found" error path, WebM recording, and a 375 px viewport. It also writes a `screenshot-<label>.png` mid-draw for visual comparison, and `tests/verify-spinner.mjs` covers the overlay lifecycle (hidden → visible → hidden).

## Credits

- [OpenCV.js](https://docs.opencv.org/4.9.0/opencv.js) — OpenCV 4.9.0 compiled to WebAssembly, loaded from `public/` (no CDN).
- Test fixtures are generated locally with plain Node (no dependencies).

## Privacy

Everything runs client-side. Images are processed in memory and discarded — nothing is transmitted anywhere.
