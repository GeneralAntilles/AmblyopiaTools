# OpenVisionTherapy

WebXR platform for amblyopia (lazy eye) vision therapy exercises. Delivers dichoptic and monocular training exercises through VR headset browsers with zero app store friction.

**Disclaimer:** This is not a medical device. OpenVisionTherapy is an open-source tool for vision therapy exercises. Use under the guidance of a qualified vision therapy practitioner. Do not use if you experience discomfort, headaches, or nausea.

## Quick Start

```bash
npm install
npm run dev
```

Open the displayed URL on your Quest 3 browser (or any WebXR-capable browser). The dev server binds to `0.0.0.0` so it's accessible on your local network.

For production builds:

```bash
npm run build
npx serve dist
```

## Target Hardware

- **Primary:** Meta Quest 3 via WebXR in Quest Browser
- **Secondary:** Any WebXR-capable headset
- **Fallback:** Desktop browser with anaglyph mode (planned)

## Exercises

### Available (Phase 1)

**Monocular Reading** — Render paginated text to the training (amblyopic) eye only. The non-training eye sees a configurable blank screen, fixation cross, or low-contrast noise pattern. Controls: trigger/thumbstick to page, grip to exit.

### Planned

**Dichoptic Tetris** — Falling pieces at full contrast to the amblyopic eye, placed pieces at reduced contrast to the dominant eye. Based on the signal integration paradigm from Li et al.

**Dichoptic Movie Viewing** — Video playback with per-eye contrast masks. Inspired by [AmblyoBye](https://github.com/alexmuraru27/AmblyoBye).

**Gabor Patch Perceptual Learning** — Contrast sensitivity training with adaptive staircase difficulty.

**Random Dot Stereograms** — Stereopsis recovery training with binocular disparity patterns.

**Suppression Check** — Worth 4-dot analog for detecting binocular suppression.

## Architecture

```
src/
├── core/
│   ├── xr-session.ts        # WebXR session lifecycle
│   ├── per-eye-renderer.ts  # Per-eye rendering (training vs. non-training)
│   ├── contrast-engine.ts   # Dichoptic contrast balancing
│   ├── input-manager.ts     # Controller/hand input
│   └── settings-store.ts    # IndexedDB persistence
├── exercises/
│   ├── base-exercise.ts     # Abstract exercise class
│   └── monocular-reading/   # Monocular reading exercise
├── ui/
│   ├── launcher.ts          # 2D exercise picker and settings
│   ├── vr-hud.ts            # In-VR status display
│   └── session-summary.ts   # Post-session stats
├── utils/
│   ├── text-renderer.ts     # Canvas text → WebGL texture
│   ├── texture-cache.ts     # LRU texture cache
│   └── analytics.ts         # Local session tracking
└── main.ts
```

### Key Design Decisions

- **Three.js, not A-Frame** — We need low-level per-eye control for dichoptic rendering. A-Frame abstracts away the view-level render loop.
- **Canvas text rendering** — Text is rendered to an offscreen canvas and uploaded as a texture. This avoids SDF/glyph complexity in shaders.
- **IndexedDB, not localStorage** — localStorage is unavailable in some WebXR contexts. IndexedDB works reliably on Quest Browser.
- **No cloud, no telemetry** — All data stays on-device. Session history is stored locally.

## Tech Stack

- TypeScript
- Three.js (WebXR rendering)
- Vite (build/dev)
- idb (IndexedDB wrapper)
- Vitest (testing)

## Research

Exercises are based on published vision therapy research:

- **Dichoptic training superiority over patching:**
  Hess RF, Thompson B, Baker DH. "Binocular vision in amblyopia: structure, suppression and plasticity." *Ophthalmic Physiol Opt.* 2014;34(2):146-162.

- **Dichoptic Tetris (signal integration):**
  Li J, Thompson B, Deng D, et al. "Dichoptic training enables the adult amblyopic brain to learn." *Curr Biol.* 2013;23(8):R308-R309.

- **Dichoptic movie viewing:**
  Li SL, et al. "Dichoptic movie viewing treats childhood amblyopia." *J AAPOS.* 2014;18(6):e18.

- **Gabor patch perceptual learning:**
  Polat U, Ma-Naim T, Belkin M, Sagi D. "Improving vision in adult amblyopia by perceptual learning." *PNAS.* 2004;101(17):6692-6697.

- **Contrast sensitivity training:**
  Levi DM, Li RW. "Perceptual learning as a potential treatment for amblyopia: a mini-review." *Vision Res.* 2009;49(21):2535-2549.

- **Random dot stereograms for stereopsis:**
  Ding J, Levi DM. "Recovery of stereopsis through perceptual learning in human adults with abnormal binocular vision." *PNAS.* 2011;108(37):E733-E741.

## Contributing

Contributions welcome. Priority areas:

1. Dichoptic Tetris implementation
2. Gabor patch generator and staircase algorithm
3. Anaglyph (red/blue) fallback for desktop
4. Testing on various headsets

## License

Apache-2.0
