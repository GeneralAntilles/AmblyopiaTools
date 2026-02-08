# OpenVisionTherapy — Research & Evidence Base

## Amblyopia Overview

Amblyopia ("lazy eye") is a neurodevelopmental disorder where the brain suppresses input from one eye, leading to reduced visual acuity despite a structurally normal eye. Affects ~2-3% of the population. Traditional treatment: patching the fellow eye to force amblyopic eye usage. Modern evidence increasingly supports **dichoptic training** as more effective.

### Types
- **Strabismic** — caused by eye misalignment
- **Refractive** — caused by unequal refractive error between eyes (this project's primary target)
- **Deprivation** — caused by obstruction (cataract, ptosis) during critical period
- **Mixed** — combination of above

## Evidence for Therapeutic Approaches

### Dichoptic Training (strongest evidence for this project)

**Key principle**: Present different stimuli to each eye simultaneously, with reduced contrast to the fellow eye. Forces the brain to use both eyes together rather than suppressing one.

- **Li et al., 2013** — Dichoptic Tetris improved visual acuity more than monocular Tetris (patching). 1-2 lines of acuity improvement in adults. *Curr Biol 23(18):R623-R625*
- **Hess et al., 2014** — iPod-based dichoptic game improved acuity and stereopsis in amblyopic children. Faster improvement than patching. *JAMA Ophthalmol 132(4):462-469*
- **To et al., 2011** — Reduced interocular suppression after dichoptic training. Suppression is the key mechanism underlying amblyopia. *Invest Ophthalmol Vis Sci 52(3):1504-1510*
- **Hess et al., 2010** — First demonstration that dichoptic training can improve binocular function in adult amblyopes. Previously thought impossible. *Curr Biol 20(11):1069-1074*

**Practical parameters from research:**
- Fellow eye contrast starts at 20-30% of amblyopic eye
- Increase fellow eye contrast by ~2% per successful session
- Sessions: 15-30 min/day, 5 days/week
- Improvement typically seen within 2-6 weeks
- 3-up/1-down staircase for adaptive contrast adjustment

### Monocular Training / Digital Patching

Less effective than dichoptic but still beneficial. What our monocular reading exercise currently does.

- **Pediatric Eye Disease Investigator Group (PEDIG)** — Established patching protocols. 2h/day patching nearly as effective as 6h/day.
- **Holmes et al., 2016** — Binocular iPad game vs patching: game was not superior to patching alone (BUT game compliance was low). *JAMA Ophthalmol 134(12):1391-1400*

Takeaway: Pure monocular occlusion works but dichoptic is better. Our monocular reading exercise is a starting point; adding dichoptic contrast mode makes it evidence-based.

### Perceptual Learning (Gabor Patches)

- **Polat et al., 2004** — Repeated contrast detection of Gabor patches improved contrast sensitivity and visual acuity in adult amblyopes. *Proc Natl Acad Sci 101(17):6692-6697*
- **Levi & Li, 2009** — Review: perceptual learning can improve spatial vision in amblyopia. Transfer depends on task and training regime. *Vision Res 49(21):2535-2549*
- **Huang et al., 2008** — 50 hours of perceptual learning improved acuity by 1-2 lines in adult amblyopes. *Invest Ophthalmol Vis Sci 49(11):4732-4739*

**Practical parameters:**
- Gabor wavelength: 3-8 cpd (cycles per degree)
- Orientations: typically 4 (0°, 45°, 90°, 135°)
- Contrast threshold measured via 2AFC (two-alternative forced choice)
- 300-600 trials per session

### Stereopsis Recovery

- **Ding & Levi, 2011** — Recovery of stereopsis through perceptual learning in human adults with abnormal binocular vision. *Proc Natl Acad Sci 108(37):E733-E741*
- Random dot stereograms can train binocular fusion
- Requires some baseline binocular function to work

### Suppression Measurement

- **Worth 4-Dot Test** — Clinical standard for detecting suppression
  - 4 colored dots viewed through red/green filters
  - Responses indicate fusion, suppression, or diplopia
  - Can be replicated in VR with per-eye color/visibility control
- **Bagolini Striated Lenses** — Detect suppression during natural viewing
- **Contrast balance point** — The fellow eye contrast level where both eyes contribute equally

## Therapeutic Protocols

### Recommended Session Structure
1. **Warm-up** (2 min): Suppression check to measure baseline
2. **Training** (15-20 min): Main exercise (dichoptic reading, Gabor patches, etc.)
3. **Cool-down** (2 min): Repeat suppression check to measure acute change
4. **Rest**: Take breaks if any discomfort, headache, or nausea

### Contrast Progression
- Start: Fellow eye at 20% contrast, amblyopic eye at 100%
- Increase fellow eye by 2% after 3 consecutive successful sessions
- Decrease by 2% after any failed session (couldn't complete, reported difficulty)
- Goal: Both eyes at equal contrast (100%/100%)
- Typical progression: 6-12 weeks to reach equal contrast

### Safety Considerations
- Stop immediately if: headache, nausea, eye pain, diplopia that doesn't resolve
- VR-specific: Take headset breaks every 20-30 min
- Not a replacement for clinical care — use alongside professional guidance
- Monitor IOP concerns with prolonged headset use (position-dependent)

## Implementation Priority (Evidence-Ranked)

1. **Dichoptic reading mode** — Add contrast-balanced fellow eye text to existing reading exercise. Highest evidence-to-effort ratio.
2. **Suppression check** — Worth 4-dot test equivalent. Essential for tracking progress. Quick to implement.
3. **Gabor patch training** — Well-studied perceptual learning task. Good for contrast sensitivity.
4. **Dichoptic Tetris** — Fun and well-studied. More complex to implement.
5. **Stereogram trainer** — Requires existing binocular function. Later phase.
6. **Dichoptic movie viewing** — Passive training. Needs video pipeline work.

## VR-Specific Considerations

- **IPD**: Quest 3 adjusts lenses physically. Software IPD correction not needed but worth verifying per-eye camera separation.
- **Vergence-accommodation conflict**: VR displays are at fixed focal distance (~1.3m for Quest 3). Reading panel at Z=-2.0 creates slight vergence demand beyond accommodation plane. Keep content at comfortable depth.
- **Frame rate**: Maintain 90fps on Quest 3 for comfort. Canvas texture updates are the main bottleneck — cache aggressively.
- **Passthrough**: Quest 3 supports passthrough. Future exercises could blend real-world and virtual stimuli.

## Open Questions

- [ ] Optimal session duration in VR (research used flat screens, VR comfort limits may differ)
- [ ] Whether rounded-corner panel transparency affects per-eye rendering fidelity
- [ ] How to validate contrast calibration without a photometer (Quest 3 display gamma)
- [ ] Whether passive dichoptic reading is as effective as active dichoptic tasks (Tetris, etc.)
- [ ] Transfer effects: does VR dichoptic training transfer to real-world tasks?
