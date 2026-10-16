# OpenVisionTherapy — Developer Guide

## Quick Reference

```bash
npm run dev        # HTTPS dev server on all interfaces (https://local-ip:5173)
npm run build      # tsc + vite build → dist/
npm run test       # vitest run (headless session tests)
npx tsc --noEmit   # type check only
```

**Desktop preview:** open `https://localhost:5173/?preview` and "Enter Preview" runs the selected exercise in the browser, both eyes side by side (left eye on the left), keyboard standing in for controllers (arrows = stick, Space = trigger, A/B, Esc = grip). Use it to check per-eye content without a headset.

HTTPS is required — WebXR won't activate on plain HTTP. The `@vitejs/plugin-basic-ssl@1` (v1 for Vite 5) handles this with a self-signed cert. Quest Browser will show a certificate warning; accept it.

## Architecture

```
index.html                 → DOM targets for 2D launcher
src/main.ts                → boot, wires WebXR (or desktop preview) to the SessionHost
src/core/
  session-host.ts          → runs one session: build exercise, tick, teardown, record, progression
  xr-session.ts            → WebXR session request/end (no render loop)
  per-eye-renderer.ts      → EyeRenderer interface + Three.js layers-based WebXR implementation
  input-manager.ts         → Quest controller input → action events (dispatch() for non-XR input)
  contrast-engine.ts       → Fellow-eye contrast for the session (change listeners persist it)
  contrast-progression.ts  → Cross-session +2% rule, dichoptic sessions only
  settings-store.ts        → IndexedDB persistence via idb
src/exercises/
  registry.ts              → EXERCISES[] — the only list of exercises
  definition.ts            → ExerciseDefinition: launcher card, factory, summary/history, progression rule
  base-exercise.ts         → BaseExercise: scene ownership, input, timers, results card
  <name>/<name>.ts         → the exercise (extends BaseExercise)
  <name>/definition.ts     → its ExerciseDefinition
src/ui/
  launcher.ts              → 2D settings, file loading, exercise selection, session history
  text-panel.ts            → TextPanel + shared instruction/feedback/results text styles
  vr-hud.ts                → In-VR status + timer (both-eye HUD)
  session-summary.ts       → Post-session stats display
src/dev/desktop-preview.ts → ?preview renderer (side-by-side eyes, keyboard input)
src/utils/                 → text rendering, texture cache, EPUB loading, formatting
tests/                     → headless session tests (see Testing)
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
- `exit` (grip) is handled by `SessionHost`, which asks `main.ts` to end the session — exercises never see it

### Canvas Text Measurement
`paginateByFit()` and `renderToTexture()` must use identical font/padding settings or pages won't match the rendered output. Both use the same `wordWrap()` function internally.

### Transparent Canvas Backgrounds
Use `'rgba(0,0,0,0)'` as background + `transparent: true` on the material for floating UI elements (HUD, indicators). The `ctx.clearRect()` call is needed before drawing rounded rects on transparent canvases.

## Adding a New Exercise

1. Create `src/exercises/<name>/<name>.ts` extending `BaseExercise`:
   - `setup()` builds the scene with `this.add(obj, 'both' | 'training' | 'fellow')`, text with `this.panel(width)`, and subscribes with `this.onInput(cb)`. Set the HUD line with `this.ctx.hud.setStatus()`.
   - `onUpdate(dt)` for animation; `this.after(ms, fn)` for delays; `this.now()` for reaction times. Don't use `Date.now()` or `setTimeout` — the exercise clock keeps tests deterministic.
   - `getStats()` returns the metrics to record. Include `fellowEyeContrast` (0–100) only if the fellow eye saw reduced-contrast content — that is what makes a session count toward contrast progression.
   - Finish with `this.showResults(lines, position)`.
   - Don't handle `exit` (the host does) and don't write teardown for things added via `add()`/`own()` — they're disposed automatically.
2. Create `src/exercises/<name>/definition.ts` exporting an `ExerciseDefinition` (card text, `create()`, `summarize()`, `historyDetail()`, optional `settingsSection` and `progressionBlocker()`).
3. Add it to `EXERCISES` in `src/exercises/registry.ts`.
4. Add a session test in `tests/sessions.test.ts` that plays it to completion.

## Testing

Tests are feature-level: `tests/support/harness.ts` runs the real `SessionHost`, exercises and settings store (fake IndexedDB) with a headless renderer, scripted controller input and a manual clock. Write tests the way a user plays — start an exercise, press buttons, let time pass, check what was recorded or what each eye sees (`renderer.visibleMeshes('training' | 'fellow')`).

Prefer these over unit tests of individual functions; don't add tests that pin internal structure. A focused unit test is fine only where a feature test can't reach the behaviour.

## Dependencies

- **three** — 3D rendering + WebXR. Using ^0.160.0 (not latest — API stability)
- **epubjs** — EPUB parsing. Types are loose; heavy use of `as any`
- **idb** — Promise-based IndexedDB wrapper
- Dev: TypeScript 5.3, Vite 5, Vitest (jsdom, vitest-canvas-mock, fake-indexeddb)
