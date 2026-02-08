# OpenVisionTherapy — Developer Guide

## Quick Reference

```bash
npm run dev        # HTTPS dev server on all interfaces (https://local-ip:5173)
npm run build      # tsc + vite build → dist/
npm run test       # vitest run
npx tsc --noEmit   # type check only
```

HTTPS is required — WebXR won't activate on plain HTTP. The `@vitejs/plugin-basic-ssl@1` (v1 for Vite 5) handles this with a self-signed cert. Quest Browser will show a certificate warning; accept it.

## Architecture

```
index.html             → DOM targets for 2D launcher
src/main.ts            → boot, XR lifecycle, exercise orchestration
src/core/
  xr-session.ts        → WebXR session request/end (no render loop)
  per-eye-renderer.ts  → Three.js layers-based per-eye rendering
  input-manager.ts     → Quest controller input → action events
  contrast-engine.ts   → Dichoptic contrast balancing (3-up/1-down staircase)
  settings-store.ts    → IndexedDB persistence via idb
src/exercises/
  base-exercise.ts     → Abstract: setup(), update(dt), teardown(), getSessionStats()
  monocular-reading/   → Paginated text reader with chapter/EPUB support + dichoptic mode
  suppression-check/   → Worth 4-dot test (per-eye dots, 10-trial diagnostic)
  brock-string/        → Virtual Brock string (convergence training, 3 beads at depth)
  vergence-training/   → Binocular disparity rings (convergence/divergence staircase)
src/ui/
  launcher.ts          → 2D settings, file loading, exercise selection, session history
  vr-hud.ts            → In-VR status + timer (both-eye HUD)
  session-summary.ts   → Post-session stats display
src/utils/
  text-renderer.ts     → Canvas text → Three.js CanvasTexture pipeline
  texture-cache.ts     → LRU texture cache (prevents GPU memory bloat)
  epub-loader.ts       → EPUB parsing via epubjs
  analytics.ts         → Local session history (IndexedDB)
```

## Per-Eye Rendering (critical to understand)

Three.js owns the XR render loop via `renderer.setAnimationLoop()`. We use the **Layers system** for per-eye content:

| Layer | Visible to | Usage |
|-------|-----------|-------|
| 0 | Both eyes | HUD, environment |
| 1 | Training (amblyopic) eye | Reading text, exercise content |
| 2 | Non-training (fellow) eye | Blank panel, fixation cross, etc. |

Camera layers are configured each frame in `configureCameraLayers()` by comparing ArrayCamera sub-camera X positions (left camera has smaller X). The training eye is whichever side the user configured.

**Do NOT manually bind framebuffers or viewports** — Three.js handles all XR framebuffer management when `xr.enabled = true`.

## Coordinate System

- `local-floor` reference space: Y=0 at floor, eye height ~1.6m
- Reading panel: 1.7m × 1.5m at (0, 1.4, -2.0) — centered at roughly chest-to-eye height
- HUD: Y ≈ 2.22 (above reading panel top edge at Y ≈ 2.15)
- Progress bar: just below panel bottom edge
- Page indicator: below progress bar

## Gotchas & Lessons Learned

### Canvas Texture References
`THREE.CanvasTexture` holds a **reference** to the canvas, not a copy. If you reuse one canvas across multiple textures, they all show the last thing drawn. **Each `renderToTexture()` call must create its own `HTMLCanvasElement`.**

### WebXR Secure Context
WebXR requires HTTPS. Use `@vitejs/plugin-basic-ssl@1` (v1 — v2 requires Vite 6). On Quest Browser, accept the self-signed certificate warning.

### Three.js XR vs Manual Rendering
When `renderer.xr.enabled = true`, calling `renderer.render()` ignores any manual framebuffer/viewport setup. Don't fight Three.js's XR pipeline — use its Layers system for per-eye control instead.

### Quest Controller Input
- `gp.axes[2]` = thumbstick X, `gp.axes[3]` = thumbstick Y
- Y axis: negative = up, positive = down
- Use deadzone (0.2) and threshold (0.5) for flick detection
- `selectstart` = trigger, `squeezestart` = grip
- `gp.buttons[4]` = A/X button, `gp.buttons[5]` = B/Y button (edge-triggered in InputManager)
- Input actions: `page-forward`, `page-back`, `chapter-next`, `chapter-prev`, `select`, `exit`, `button-a`, `button-b`

### Canvas Text Measurement
`paginateByFit()` and `renderToTexture()` must use identical font/padding settings or pages won't match the rendered output. Both use the same `wordWrap()` function internally.

### Transparent Canvas Backgrounds
Use `'rgba(0,0,0,0)'` as background + `transparent: true` on the material for floating UI elements (HUD, indicators). The `ctx.clearRect()` call is needed before drawing rounded rects on transparent canvases.

## Adding a New Exercise

1. Create `src/exercises/<name>/<name>.ts` extending `BaseExercise`
2. Implement `setup()`, `update(dt)`, `teardown()`, `getSessionStats()`
3. Add scene objects via `renderer.addToTrainingEye()` / `addToNonTrainingEye()` / `addToBothEyes()`
4. Subscribe to input via `input.onAction(callback)` — return the unsub function
5. Clean up all geometry, materials, and textures in `teardown()`
6. Add an entry to `EXERCISES[]` in `launcher.ts` with `available: true`
7. Add a case to `startExercise()` in `main.ts`

## Dependencies

- **three** — 3D rendering + WebXR. Using ^0.160.0 (not latest — API stability)
- **epubjs** — EPUB parsing. Types are loose; heavy use of `as any`
- **idb** — Promise-based IndexedDB wrapper
- Dev: TypeScript 5.3, Vite 5, Vitest
