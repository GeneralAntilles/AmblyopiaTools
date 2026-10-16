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

| Exercise | Type | What it does |
|---|---|---|
| Reading | Monocular / dichoptic | Your own text or EPUB to the training eye; fellow eye sees the page at reduced contrast (dichoptic) or a blank/fixation/noise panel |
| Dichoptic 2048 | Dichoptic | 2048 with tiles shown only to the training eye |
| Depth Scaffolding | Binocular | Pick the closest object while monocular depth cues are stripped away, leaving only stereo disparity |
| Suppression Check | Diagnostic | Worth 4-dot test at three distances, with vergence offset measurement |
| Brock String | Binocular | Progressive near-point-of-convergence staircase |
| Vergence Training | Binocular | Convergence/divergence staircase with disparity rings |

Fellow-eye contrast rises +2% after each successful session (auto-progression, on by default). Ideas and planned exercises live in [IDEAS.md](IDEAS.md).

## Development

```bash
npm run dev     # HTTPS dev server — open on the headset
npm test        # headless session tests
```

Open the dev URL with `?preview` to run exercises on a desktop browser: both eyes render side by side, arrow keys/Space/A/B/Esc stand in for the controllers. See [CLAUDE.md](CLAUDE.md) for architecture and how to add an exercise.

## Architecture

```
src/
├── core/        # XR session, per-eye renderer, input, contrast, session host, settings
├── exercises/   # registry + one folder per exercise (exercise class + definition)
├── ui/          # 2D launcher, VR HUD, text panels, session summary
├── dev/         # desktop preview
└── utils/       # text rendering, EPUB loading, caches, formatting
tests/           # headless session tests
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

1. Gabor patch generator and staircase algorithm
2. Anaglyph (red/blue) fallback for desktop
3. Testing on various headsets

## License

Apache-2.0
