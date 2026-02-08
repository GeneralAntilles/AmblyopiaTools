# OpenVisionTherapy — Ideas & Roadmap

## Next Up (High Priority)

### Dichoptic Reading Mode
**Effort: Small | Impact: High | Evidence: Strong**

The single highest-value improvement. Both eyes see the reading panel, but the fellow eye at reduced contrast (from ContrastEngine). Turns monocular patching into actual dichoptic therapy.

Implementation:
- Add `'dichoptic'` to nonTrainingDisplay options
- In dichoptic mode, render same page text to non-training eye with alpha = `contrastEngine.getDominantContrast()`
- Re-render non-training eye on every page change
- Add contrast ratio to HUD display
- Save/load contrast settings per-session
- Manual contrast adjustment (A/B buttons or in-VR slider?)

### Suppression Check (Worth 4-Dot)
**Effort: Small | Impact: High | Evidence: Clinical standard**

4 colored dots viewed with per-eye filtering. In VR this is trivial — just put different dots on different layers. Run before and after each training session.

Implementation:
- New exercise: `suppression-check.ts`
- 4 dots: 1 red (training eye), 2 green (non-training eye), 1 white (both eyes)
- Response recording: how many dots seen? (2=suppression, 3=suppression, 4=fusion, 5=diplopia)
- Track suppression score over time
- Could run automatically as session warm-up/cool-down

---

## Medium Priority

### Gabor Patch Training
**Effort: Medium | Impact: High | Evidence: Strong (Polat 2004)**

2AFC contrast detection task with oriented Gabor patches. Trains contrast sensitivity.

Implementation:
- Generate Gabor patches on canvas (sinusoidal grating × Gaussian envelope)
- Two-interval forced choice: which interval contained the target?
- Adaptive staircase for contrast threshold
- 4 orientations, multiple spatial frequencies
- Track contrast sensitivity function over time

### Session History Dashboard
**Effort: Small | Impact: Medium**

Show training history on the launcher page. Data already exists in IndexedDB.

- Calendar heatmap or simple list
- Session duration, pages read, contrast progression
- Streak tracking for motivation
- Export data as JSON/CSV

### Font Loading
**Effort: Small | Impact: Medium**

Currently limited to system fonts (sans-serif, serif, monospace). Could load web fonts for better reading experience.

- OpenDyslexic font — designed for dyslexia, may help with amblyopic reading too
- Google Fonts loading via @font-face
- Font preview in launcher settings

---

## Lower Priority / Future Phases

### Dichoptic Tetris
**Effort: Large | Impact: High | Evidence: Strong (Li 2013)**

Falling pieces visible to amblyopic eye, placed pieces to fellow eye. Requires game logic, piece rendering, collision detection, scoring.

### Dichoptic Movie Viewing
**Effort: Large | Impact: Medium | Evidence: Moderate**

Video playback with per-eye contrast masks. Needs video element → texture pipeline, sync, controls. Could use Three.js VideoTexture.

### Random Dot Stereograms
**Effort: Medium | Impact: Medium | Evidence: Moderate**

Generate random dot patterns with binocular disparity revealing hidden shapes. Tests and trains stereopsis.

### Guided Therapy Programs
**Effort: Medium | Impact: High**

Pre-built multi-week programs with scheduled exercises, difficulty progression, and progress tracking. "Week 1: 15min monocular reading + suppression check daily"

### Contrast Calibration
**Effort: Medium | Impact: Medium**

Display test patterns to calibrate perceived contrast on the specific headset. Account for Quest 3 display gamma.

### Passthrough Integration
**Effort: Large | Impact: Medium**

Use Quest 3 passthrough for mixed-reality exercises. Real-world objects with per-eye overlays.

### Multiplayer / Social
**Effort: Large | Impact: Low-Medium**

Shared reading sessions, competitive Tetris, accountability partners.

---

## Technical Debt / Polish

- [ ] Code splitting for exercise modules (currently one big bundle)
- [ ] Unit tests for text-renderer, contrast-engine, pagination
- [ ] E2E test framework for WebXR (hard — maybe WebXR emulator?)
- [ ] PWA manifest for installability on Quest Browser
- [ ] Offline support via service worker
- [ ] Accessibility: screen reader support for launcher page
- [ ] Performance: profile texture generation on Quest 3 hardware
- [ ] Error boundaries: graceful handling of WebXR session failures

## Wild Ideas

- Eye tracking integration (Quest Pro / future Quest) for gaze-contingent exercises
- AI-generated reading content matched to reading level
- Biometric feedback (heart rate via Quest sensor) for session comfort monitoring
- Community exercise sharing / exercise scripting language
- Clinical dashboard for practitioners managing multiple patients
