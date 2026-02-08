# OpenVisionTherapy — Research & Evidence Base

## Amblyopia Overview

Amblyopia ("lazy eye") is a neurodevelopmental disorder where the brain suppresses input from one eye, leading to reduced visual acuity despite a structurally normal eye. Affects ~2-3% of the population. Traditional treatment: patching the fellow eye to force amblyopic eye usage. Modern evidence increasingly supports **dichoptic training** as more effective.

### Types
- **Strabismic** — caused by eye misalignment
- **Refractive** — caused by unequal refractive error between eyes (this project's primary target)
- **Deprivation** — caused by obstruction (cataract, ptosis) during critical period
- **Mixed** — combination of above

### Adult Amblyopia: Age Is Not a Barrier

A 2025 meta-analysis of **22 RCTs involving 422 adult amblyopes** confirms that treatment produces statistically significant improvement in visual acuity regardless of age. This overturns the longstanding clinical assumption that amblyopia is only treatable in childhood (the "critical period" dogma). Key findings:

- Adults show **1-2 lines of acuity improvement** with dichoptic training
- Gains are comparable to pediatric outcomes, though may require longer treatment duration
- Perceptual learning and dichoptic approaches work in adults; patching alone is less effective
- Neuroplasticity in the adult visual cortex is sufficient for meaningful recovery

This is directly relevant to OpenVisionTherapy — the platform is viable for adult users, not just children.

## Evidence for Therapeutic Approaches

### Dichoptic Training (strongest evidence for this project)

**Key principle**: Present different stimuli to each eye simultaneously, with reduced contrast to the fellow eye. Forces the brain to use both eyes together rather than suppressing one.

#### Foundational Studies
- **Hess et al., 2010** — First demonstration that dichoptic training can improve binocular function in adult amblyopes. Previously thought impossible. *Curr Biol 20(11):1069-1074*
- **To et al., 2011** — Reduced interocular suppression after dichoptic training. Suppression is the key mechanism underlying amblyopia. *Invest Ophthalmol Vis Sci 52(3):1504-1510*
- **Li et al., 2013** — Dichoptic Tetris improved visual acuity more than monocular Tetris (patching). 1-2 lines of acuity improvement in adults. *Curr Biol 23(18):R623-R625*
- **Hess et al., 2014** — iPod-based dichoptic game improved acuity and stereopsis in amblyopic children. Faster improvement than patching. *JAMA Ophthalmol 132(4):462-469*

#### Commercial Products & Recent Trials

- **Luminopia (FDA-cleared 2021)** — Dichoptic video therapy using modified TV/movie content. Expanded FDA clearance to ages 8-12 in April 2025. PUPiL registry shows **83% adherence rate** and **1.7 lines mean improvement** in visual acuity. Originally FDA-cleared for ages 4-7, this expansion validates the approach across a wider age range.

- **CureSight (NovaBay/NovaSight, FDA-cleared)** — Uses **gaze-contingent foveal blur** on the fellow eye during normal video viewing. First device to show **superiority over patching** in a randomized controlled trial (per-protocol analysis). The gaze-contingent approach is notable — it tracks where the patient is looking and applies blur specifically to the foveal region of the fellow eye, forcing the amblyopic eye to process the central content.

- **Vivid Vision** — VR-based dichoptic therapy platform. Clinical data shows results **comparable to patching**, with adult patients doing better in VR than on flat screens. Uses Oculus/Quest hardware.

- **PEDIG ATS23/ATS24 trials** — Ongoing large-scale trials from the Pediatric Eye Disease Investigator Group evaluating digital dichoptic therapies. Results expected to further clarify optimal protocols.

- **Retention data** — Follow-up studies show gains from dichoptic training **persist 1-5 years** after treatment cessation, suggesting the neural changes are durable, not just temporary adaptation.

**Practical parameters from research:**
- Fellow eye contrast starts at 20-30% of amblyopic eye
- Increase fellow eye contrast by ~2% per successful session
- Sessions: 15-30 min/day, 5 days/week
- Improvement typically seen within 2-6 weeks
- 3-up/1-down staircase for adaptive contrast adjustment

### Monocular Training / Digital Patching

Less effective than dichoptic but still beneficial. What our monocular reading exercise provides.

- **Pediatric Eye Disease Investigator Group (PEDIG)** — Established patching protocols. 2h/day patching nearly as effective as 6h/day.
- **Holmes et al., 2016** — Binocular iPad game vs patching: game was not superior to patching alone (BUT game compliance was low). *JAMA Ophthalmol 134(12):1391-1400*

Takeaway: Pure monocular occlusion works but dichoptic is better. Our monocular reading exercise is a starting point; the dichoptic contrast mode makes it evidence-based.

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
- **Depth scaffolding** (novel approach): Start with monocular depth cues (size, perspective, occlusion) alongside binocular disparity, then progressively remove the monocular cues. This is uniquely possible in VR and impossible on flat screens. Lowers the entry barrier for stereopsis training by not requiring the patient to already have binocular function.

### Suppression Measurement

- **Worth 4-Dot Test** — Clinical standard for detecting suppression
  - 4 colored dots viewed through red/green filters
  - Responses indicate fusion, suppression, or diplopia
  - Can be replicated in VR with per-eye color/visibility control
- **Bagolini Striated Lenses** — Detect suppression during natural viewing
- **Contrast balance point** — The fellow eye contrast level where both eyes contribute equally

### Gaze-Contingent Approaches

CureSight's success highlights the power of **gaze-contingent** therapy — applying selective visual modifications based on where the patient is looking. Key insight: foveal processing is where amblyopic deficits are most pronounced. By selectively degrading the fellow eye's foveal input while leaving peripheral vision intact, you can:

- Force the amblyopic eye to handle central/detailed processing
- Maintain binocular peripheral awareness (more natural than patching)
- Create a more comfortable experience than full-eye occlusion

**Hardware limitation**: Quest 3 has no eye tracking. Quest Pro had it but is discontinued. The W3C WebXR eye tracking API is still in incubation with no browser implementations. Third-party options like Pupil Labs Neon XR (~€5,900, Unity only) exist for research contexts but aren't viable for consumer use. This approach is currently blocked for our platform.

### Reading & Amblyopia

Research on reading behavior with amblyopia reveals specific deficits:

- Amblyopic eyes show **more fixations, longer fixation durations, and more regressions** during reading
- Reading speed is reduced, particularly for small text and crowded layouts
- These deficits persist even after acuity improvement, suggesting higher-order processing issues
- Reading exercises may specifically target these functional deficits beyond just acuity

This validates our reading-based approach — it's not just a convenience, it targets real functional deficits.

### Novel Approaches from Recent Research

#### Push-Pull Rivalry
Alternating which eye receives the dominant stimulus at a controlled rate. Unlike static dichoptic presentation, this creates dynamic competition between the eyes that may more effectively reduce suppression. Could be implemented as a mode where training/non-training eye contrast alternates during reading.

#### Dichoptic Multiple Object Tracking (MOT) in 3D
Track moving objects that are split between eyes with binocular disparity cues. Combines attention training with binocular fusion demands. VR-native: impossible on flat screens.

#### Anti-Crowding with Depth
Crowding (difficulty identifying objects flanked by similar items) is exaggerated in amblyopia. In VR, flankers can be placed at different depths from the target, using binocular disparity to separate them. Gradually reduce the depth separation to train crowding resistance.

#### Inverse Occlusion
Paradoxically, brief periods of **fellow-eye deprivation** (patching the good eye for very short durations, ~2 hours) have been shown to temporarily boost amblyopic eye function. The mechanism may relate to homeostatic plasticity. Could be combined with other training as a "priming" step.

#### Multisensory Integration
Amblyopia is associated with a **widened audiovisual temporal binding window** — amblyopes integrate audio and visual stimuli over a larger time range than normal. Multisensory exercises (matching sounds to visual events with precise timing) could help tighten this window as a complementary therapy.

#### Natural Scene Contrast Training
Rather than synthetic stimuli (Gabor patches), use photographs or rendered scenes with per-eye contrast manipulation. May transfer better to real-world visual tasks. Our dichoptic reading mode is a form of this.

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

### Dose-Response
- Luminopia data suggests **1 hour/day, 6 days/week** is effective for children
- Adult studies typically use 30-60 min/day
- VR comfort limits may constrain session duration (Quest 3: ~30 min comfortable for most users)
- Compliance is the #1 predictor of outcomes — engaging content matters more than optimal stimulus parameters

### Safety Considerations
- Stop immediately if: headache, nausea, eye pain, diplopia that doesn't resolve
- VR-specific: Take headset breaks every 20-30 min
- Not a replacement for clinical care — use alongside professional guidance
- Monitor IOP concerns with prolonged headset use (position-dependent)

## Implementation Priority (Evidence-Ranked)

1. ~~**Dichoptic reading mode**~~ ✅ — Implemented. Contrast-balanced fellow eye text in reading exercise.
2. **Suppression check** — Worth 4-dot test equivalent. Essential for tracking progress. Quick to implement.
3. **Depth scaffolding stereopsis trainer** — VR-unique exercise impossible on flat screens. Strong differentiator.
4. **Gabor patch training** — Well-studied perceptual learning task. Good for contrast sensitivity.
5. **Dichoptic MOT in 3D** — Attention + binocular fusion training. VR-native.
6. **Dichoptic Tetris** — Fun and well-studied. More complex to implement.
7. **Stereogram trainer** — Requires existing binocular function. Lower entry barrier with depth scaffolding.
8. **Dichoptic movie viewing** — Passive training. Needs video pipeline work.

## Hardware Landscape

### Quest 3
- **Display**: LCD, ~25 PPD, 120Hz capable
- **IPD**: 53-75mm continuous mechanical adjustment
- **Eye tracking**: **None**. This is the major limitation.
- **Passthrough**: Full color, good quality. Mixed reality exercises viable.
- **WebXR**: Full support for immersive-vr sessions. No WebXR eye tracking API exists.
- **Controllers**: 6DOF tracking, thumbstick, trigger, grip, A/B/X/Y buttons

### Quest Pro (discontinued)
- Had eye tracking (Tobii-based), but Meta discontinued the line
- Eye tracking data was accessible in native apps, unclear WebXR support

### Pupil Labs Neon XR
- Third-party research-grade eye tracking add-on for Quest 3
- ~€5,900 price point, Unity SDK only
- Not viable for consumer/open-source use, but relevant for research validation

### Apple Vision Pro
- Best hardware eye tracking available, but Apple **blocks all eye tracking data access** from applications for privacy
- Not viable for gaze-contingent therapy

## VR-Specific Considerations

- **IPD**: Quest 3 adjusts lenses physically. Software IPD correction not needed but worth verifying per-eye camera separation.
- **Vergence-accommodation conflict**: VR displays are at fixed focal distance (~1.3m for Quest 3). Reading panel at Z=-2.0 creates slight vergence demand beyond accommodation plane. Keep content at comfortable depth.
- **Frame rate**: Maintain 90fps on Quest 3 for comfort. Canvas texture updates are the main bottleneck — cache aggressively.
- **Passthrough**: Quest 3 supports passthrough. Future exercises could blend real-world and virtual stimuli.
- **VR as differentiator**: The key advantage of VR over flat-screen dichoptic therapy (Luminopia, CureSight) is **true stereoscopic depth**. Exercises that exploit binocular disparity, depth scaffolding, and 3D object tracking are impossible on flat screens. This should be our strategic focus for exercises beyond reading.

## Competitive Landscape

| Product | Approach | Platform | FDA Status | Key Advantage |
|---------|----------|----------|------------|---------------|
| Luminopia | Dichoptic video | iPad/headset | Cleared (4-12) | Content library, compliance |
| CureSight | Gaze-contingent blur | Tablet+eye tracker | Cleared | Superiority over patching |
| Vivid Vision | VR dichoptic games | Oculus/Quest | Not cleared | VR-native, clinical use |
| **OpenVisionTherapy** | VR dichoptic reading + exercises | Quest 3 (WebXR) | N/A (open source) | Free, open, VR-native depth exercises |

Our differentiators: **open source, free, no prescription required, VR-native depth exercises, WebXR (no app store), extensible**.

## Open Questions

- [ ] Optimal session duration in VR (research used flat screens, VR comfort limits may differ)
- [ ] Whether rounded-corner panel transparency affects per-eye rendering fidelity
- [ ] How to validate contrast calibration without a photometer (Quest 3 display gamma)
- [ ] Whether passive dichoptic reading is as effective as active dichoptic tasks (Tetris, etc.)
- [ ] Transfer effects: does VR dichoptic training transfer to real-world tasks?
- [ ] Dose-response curve for VR dichoptic reading specifically (no published data)
- [ ] Whether depth scaffolding approach for stereopsis is effective (theoretical, needs validation)
- [ ] Feasibility of WebXR eye tracking if W3C spec matures and Quest implements it
- [ ] Whether multisensory (audio+visual) exercises provide additive benefit in VR
