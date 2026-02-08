# OpenVisionTherapy — Ideas & Roadmap

## Completed

### Dichoptic Reading Mode ✅
**Effort: Small | Impact: High | Evidence: Strong**

Both eyes see the reading panel, but the fellow eye at reduced contrast (from ContrastEngine). Turns monocular patching into actual dichoptic therapy. Contrast adjustable from launcher UI (0-100%).

---

## Next Up (High Priority)

### Suppression Check (Worth 4-Dot)
**Effort: Small | Impact: High | Evidence: Clinical standard**

4 colored dots viewed with per-eye filtering. In VR this is trivial — just put different dots on different layers. Run before and after each training session to track suppression changes over time.

Implementation:
- New exercise: `suppression-check.ts`
- 4 dots: 1 red (training eye), 2 green (non-training eye), 1 white (both eyes)
- Response recording: how many dots seen? (2=suppression, 3=suppression, 4=fusion, 5=diplopia)
- Track suppression score over time in IndexedDB
- Could run automatically as session warm-up/cool-down
- Quick (~2 min) — pair with other exercises in a session flow

### Depth Scaffolding Stereopsis Trainer
**Effort: Medium | Impact: High | Evidence: Theoretical (strong rationale) | VR-UNIQUE**

This is our biggest differentiator vs flat-screen competitors. Impossible on tablets/phones.

Train stereopsis by presenting 3D objects with binocular disparity, but start with redundant monocular depth cues (relative size, perspective, occlusion, lighting/shadow) alongside the stereo cues. Progressively remove monocular cues, forcing the brain to rely on binocular disparity.

Implementation:
- Simple 3D scene with objects at varying depths
- Task: identify which object is closest / farthest, or sort by depth
- Monocular cue levels: full → partial → stereo only
- Adaptive difficulty: adjust disparity magnitude and cue availability based on performance
- Track stereo acuity threshold over time
- Start with large disparities (easy) and decrease as the patient improves

Why this matters:
- Traditional stereograms require existing binocular function — many amblyopes fail immediately
- Depth scaffolding lowers the entry barrier by providing redundant cues
- VR provides true binocular disparity — cannot be simulated on flat screens
- Bridges the gap between "no stereopsis" and "stereogram-ready"

### In-VR Contrast Adjustment
**Effort: Small | Impact: Medium**

Currently contrast is set from the 2D launcher before entering VR. Allow adjustment during a session using controller buttons (A/B or thumbstick up/down).

Implementation:
- Map A/B buttons to increase/decrease fellow eye contrast by 5%
- Update HUD to show current contrast level
- Real-time re-render of non-training eye texture
- Clamp to 0-100% range
- Persist the adjusted value back to settings on session end

---

## Medium Priority

### Gabor Patch Training
**Effort: Medium | Impact: High | Evidence: Strong (Polat 2004)**

2AFC contrast detection task with oriented Gabor patches. Trains contrast sensitivity.

Implementation:
- Generate Gabor patches on canvas (sinusoidal grating x Gaussian envelope)
- Two-interval forced choice: which interval contained the target?
- Adaptive staircase (3-up/1-down) for contrast threshold
- 4 orientations, multiple spatial frequencies (3-8 cpd)
- 300-600 trials per session
- Track contrast sensitivity function over time
- Could be dichoptic: target to training eye, noise to fellow eye

### Dichoptic Multiple Object Tracking (MOT) in 3D
**Effort: Medium | Impact: High | Evidence: Moderate | VR-UNIQUE**

Track moving objects (spheres, cubes) that are split between eyes — some visible only to training eye, some only to fellow eye. Objects move through 3D space with binocular disparity cues. Combines attention training with binocular fusion demands.

Implementation:
- N objects (start with 4-6), subset highlighted as targets
- All objects move randomly in 3D space for a duration
- Player identifies which objects were targets
- Split objects between eyes — some training-only, some fellow-only, some both
- Gradually increase fellow-eye-only targets as fusion improves
- True 3D trajectories with stereo depth — VR-native, impossible on flat screens
- Adaptive: increase object count, speed, or eye-split ratio

### Session History Dashboard
**Effort: Small | Impact: Medium**

Show training history on the launcher page. Data already exists in IndexedDB.

- Calendar heatmap or simple list
- Session duration, pages read, contrast progression over time
- Streak tracking for motivation
- Export data as JSON/CSV
- Suppression check trends (once implemented)

### Font Loading
**Effort: Small | Impact: Medium**

Currently limited to system fonts (sans-serif, serif, monospace). Could load web fonts for better reading experience.

- OpenDyslexic font — designed for dyslexia, may help with amblyopic reading too
- Google Fonts loading via @font-face
- Font preview in launcher settings
- Ensure fonts load before pagination (avoid FOUT in canvas rendering)

---

## Lower Priority / Future Phases

### Anti-Crowding Depth Exercise
**Effort: Medium | Impact: Medium | Evidence: Moderate | VR-UNIQUE**

Crowding (difficulty identifying objects flanked by similar items) is exaggerated in amblyopia. In VR, place target and flanker letters/symbols at different stereoscopic depths. Gradually reduce the depth separation to train crowding resistance.

Implementation:
- Central target letter/symbol surrounded by flankers
- Flankers at different binocular disparity depths from target
- Task: identify the target
- Adaptive: reduce depth separation as performance improves
- Also vary flanker-target spacing (standard crowding parameter)
- Compare performance between training eye and fellow eye

### Dichoptic Tetris
**Effort: Large | Impact: High | Evidence: Strong (Li 2013)**

Falling pieces visible to amblyopic eye, placed pieces to fellow eye. Requires game logic, piece rendering, collision detection, scoring.

### Push-Pull Rivalry Exercise
**Effort: Medium | Impact: Medium | Evidence: Emerging**

Alternate which eye receives the dominant stimulus at a controlled rate, creating dynamic competition that may more effectively reduce suppression than static dichoptic presentation.

Implementation:
- During reading or object viewing, alternate training/fellow eye contrast over time
- Configurable alternation rate (e.g., 2-10 second cycles)
- Smooth transitions to avoid jarring switches
- Track which rate produces best subjective fusion reports

### Dichoptic Movie Viewing
**Effort: Large | Impact: Medium | Evidence: Moderate (Luminopia model)**

Video playback with per-eye contrast. Essentially what Luminopia does. Needs video element -> texture pipeline, sync, controls. Could use Three.js VideoTexture.

### Random Dot Stereograms
**Effort: Medium | Impact: Medium | Evidence: Moderate**

Generate random dot patterns with binocular disparity revealing hidden shapes. Tests and trains stereopsis. More useful after depth scaffolding trainer has built baseline stereo ability.

### Guided Therapy Programs
**Effort: Medium | Impact: High**

Pre-built multi-week programs with scheduled exercises, difficulty progression, and progress tracking. "Week 1: 15min dichoptic reading + suppression check daily." Based on research protocols (see RESEARCH.md).

- Beginner: Monocular reading → dichoptic reading → suppression checks
- Intermediate: Add Gabor patches, start depth scaffolding
- Advanced: Dichoptic MOT, anti-crowding, reduce contrast gap toward 100%/100%

### Contrast Calibration
**Effort: Medium | Impact: Medium**

Display test patterns to calibrate perceived contrast on the specific headset. Account for Quest 3 display gamma. Important for ensuring the 20% contrast setting actually looks like 20% on the user's hardware.

### Passthrough Integration
**Effort: Large | Impact: Medium**

Use Quest 3 passthrough for mixed-reality exercises. Real-world objects with per-eye overlays. Could enable "augmented reading" — real book visible to training eye, blurred/dimmed passthrough to fellow eye.

### Multisensory Integration Exercise
**Effort: Medium | Impact: Low-Medium | Evidence: Emerging**

Amblyopia is associated with a widened audiovisual temporal binding window. Exercise: match sounds to visual events with precise timing. Audio beep + visual flash at varying offsets — patient reports whether they occurred simultaneously. Tighten the window adaptively.

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
- [ ] Bayesian adaptive difficulty engine (replace simple staircases with QUEST or Psi method)
- [ ] Automated contrast progression based on session performance history

## Wild Ideas

- Eye tracking integration if Quest hardware ever adds it (or WebXR Eye Tracking API matures)
- Gaze-contingent foveal blur (CureSight approach) — blocked on eye tracking hardware
- AI-generated reading content matched to reading level
- Biometric feedback (heart rate via Quest sensor) for session comfort monitoring
- Community exercise sharing / exercise scripting language
- Clinical dashboard for practitioners managing multiple patients
- Inverse occlusion "priming" — brief fellow-eye patching period before dichoptic training
- Natural scene contrast training using photographs instead of text
- Collaboration with Pupil Labs for research-grade eye tracking validation (~€5,900 Neon XR)

## Strategic Direction

**Our biggest differentiator vs Luminopia/CureSight/Vivid Vision**: We run on consumer hardware (Quest 3), require no prescription, are free and open source, and can build **VR-native exercises that exploit true stereoscopic depth**. Flat-screen competitors cannot do depth scaffolding, 3D MOT, anti-crowding with depth, or stereogram training.

Priority order for maximum differentiation:
1. ✅ Dichoptic reading (done — table stakes)
2. Suppression check (essential measurement tool)
3. Depth scaffolding stereopsis trainer (VR-unique, novel)
4. Dichoptic 3D MOT (VR-unique, combines attention + fusion)
5. Anti-crowding with depth (VR-unique, targets specific deficit)
6. Everything else builds on this foundation
