/**
 * OpenVisionTherapy — main entry point.
 *
 * Initializes the launcher UI, handles WebXR session lifecycle,
 * and orchestrates exercises.
 */

import { XRSessionManager } from './core/xr-session';
import { PerEyeRenderer, type EyeSide } from './core/per-eye-renderer';
import { ContrastEngine } from './core/contrast-engine';
import { InputManager } from './core/input-manager';
import { SettingsStore } from './core/settings-store';
import { Analytics } from './utils/analytics';
import { Launcher } from './ui/launcher';
import { VRHud } from './ui/vr-hud';
import { showSessionSummary } from './ui/session-summary';
import { MonocularReadingExercise } from './exercises/monocular-reading/monocular-reading';
import { SuppressionCheckExercise } from './exercises/suppression-check/suppression-check';
import { BrockStringExercise } from './exercises/brock-string/brock-string';
import { VergenceTrainingExercise } from './exercises/vergence-training/vergence-training';
import type { BaseExercise } from './exercises/base-exercise';

// Global instances
const settingsStore = new SettingsStore();
const analytics = new Analytics(settingsStore);
const launcher = new Launcher(settingsStore);

let xrManager: XRSessionManager | null = null;
let perEyeRenderer: PerEyeRenderer | null = null;
let inputManager: InputManager | null = null;
let contrastEngine: ContrastEngine | null = null;
let vrHud: VRHud | null = null;
let activeExercise: BaseExercise | null = null;
let lastFrameTime = 0;

/**
 * Boot the application.
 */
async function init(): Promise<void> {
  // Initialize launcher
  await launcher.init();

  // Check WebXR support
  const vrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const statusDiv = document.getElementById('webxr-status')!;

  const supported = await XRSessionManager.isSupported();

  if (supported) {
    vrBtn.disabled = false;
    vrBtn.textContent = 'Enter VR';
  } else {
    vrBtn.disabled = true;
    vrBtn.textContent = 'WebXR Not Available';
    statusDiv.innerHTML =
      '<div class="no-webxr">WebXR is not available in this browser. Open this page in a VR headset browser (e.g., Meta Quest Browser) to use immersive mode.</div>';
  }

  // Wire up Enter VR
  launcher.setEnterVRCallback(handleEnterVR);
}

/**
 * Handle the "Enter VR" button click.
 */
async function handleEnterVR(exerciseId: string): Promise<void> {
  const vrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const canvas = document.getElementById('xr-canvas') as HTMLCanvasElement;

  vrBtn.disabled = true;
  vrBtn.textContent = 'Starting VR...';

  try {
    const settings = await settingsStore.getSettings();

    // 1. Request the XR session
    xrManager = new XRSessionManager();
    xrManager.setOnSessionEnded(handleSessionEnded);
    const session = await xrManager.requestSession();

    canvas.style.display = 'block';

    // 2. Create renderer (Three.js owns the XR render loop)
    perEyeRenderer = new PerEyeRenderer(canvas);
    perEyeRenderer.setTrainingEye(settings.trainingEye as EyeSide);

    // 3. Input
    inputManager = new InputManager();
    inputManager.setSession(session);

    // 4. Contrast engine
    contrastEngine = new ContrastEngine({
      dominantEyeContrast: settings.contrastDominant,
      amblyopicEyeContrast: settings.contrastAmblyopic,
    });

    // 5. VR HUD (visible to both eyes)
    vrHud = new VRHud();
    perEyeRenderer.addToBothEyes(vrHud.getGroup());

    // 6. Start the exercise
    await startExercise(exerciseId);

    // 7. Analytics
    analytics.startSession(exerciseId);

    // 8. Per-frame callback
    perEyeRenderer.onFrame((time, _frame) => {
      const dt = lastFrameTime ? (time - lastFrameTime) / 1000 : 0;
      lastFrameTime = time;

      inputManager?.update();
      activeExercise?.update(dt);

      if (vrHud && analytics.getActiveSession()) {
        const elapsed = Date.now() - analytics.getActiveSession()!.startTime;
        vrHud.updateTimer(elapsed);
      }
    });

    // 9. Hand session to Three.js — starts the render loop
    await perEyeRenderer.startSession(session);

  } catch (error) {
    console.error('Failed to start VR:', error);
    vrBtn.disabled = false;
    vrBtn.textContent = 'Enter VR';

    const statusDiv = document.getElementById('webxr-status')!;
    statusDiv.innerHTML = `<div class="no-webxr">Failed to start VR session: ${error instanceof Error ? error.message : String(error)}</div>`;
  }
}

/**
 * Called when the XR session ends (user exits VR or grip exit).
 */
async function handleSessionEnded(): Promise<void> {
  const vrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const canvas = document.getElementById('xr-canvas') as HTMLCanvasElement;

  canvas.style.display = 'none';

  // Get stats before teardown
  const stats = activeExercise?.getSessionStats();

  // Teardown
  activeExercise?.teardown();
  activeExercise = null;

  const record = await analytics.endSession(stats);

  vrHud?.dispose();
  vrHud = null;
  inputManager?.dispose();
  inputManager = null;
  perEyeRenderer?.dispose();
  perEyeRenderer = null;
  contrastEngine = null;
  xrManager = null;
  lastFrameTime = 0;

  // Show session summary
  if (stats) {
    const summaryEl = document.getElementById('session-summary')!;
    showSessionSummary(summaryEl, stats);
  }

  vrBtn.disabled = false;
  vrBtn.textContent = 'Enter VR';

  // Refresh session history on launcher
  launcher.renderSessionHistory();

  console.log('Session ended:', record);
}

/**
 * Instantiate and set up the requested exercise.
 */
async function startExercise(exerciseId: string): Promise<void> {
  if (!perEyeRenderer || !inputManager || !contrastEngine) return;

  switch (exerciseId) {
    case 'monocular-reading': {
      const readingText = launcher.getReadingText();
      const currentSettings = launcher.getCurrentSettings();
      const loadedBook = launcher.getLoadedBook();

      // Build chapter data from loaded book if available
      const chapters = loadedBook && loadedBook.chapters.length > 1
        ? loadedBook.chapters.map((ch) => ({ title: ch.title, text: ch.text }))
        : undefined;

      const exercise = new MonocularReadingExercise({
        text: readingText || undefined,
        fontSize: currentSettings.fontSize as number,
        lineHeight: currentSettings.lineHeight as number,
        fontFamily: currentSettings.fontFamily as string,
        nonTrainingDisplay: currentSettings.nonTrainingDisplay as 'blank' | 'fixation' | 'pattern' | 'dichoptic',
        chapters,
        startChapter: chapters ? launcher.getSelectedChapterIndex() : undefined,
      });

      exercise.setExitCallback(() => {
        xrManager?.end();
      });

      // In-VR contrast adjustment callback
      exercise.setContrastChangedCallback((contrast: number) => {
        const pct = Math.round(contrast * 100);
        vrHud?.updateStatus(`Dichoptic ${pct}% — A/B adjust, grip exit`);
        // Persist the new value
        settingsStore.saveSetting('contrastDominant', contrast);
      });

      await exercise.setup({
        renderer: perEyeRenderer,
        input: inputManager,
        contrast: contrastEngine,
      });

      activeExercise = exercise;

      const isDichoptic = currentSettings.nonTrainingDisplay === 'dichoptic';
      const contrastPct = isDichoptic ? Math.round((contrastEngine?.getDominantContrast() ?? 0.2) * 100) : 0;
      let statusText: string;
      if (isDichoptic) {
        statusText = `Dichoptic ${contrastPct}% — A/B adjust, grip exit`;
      } else if (chapters) {
        statusText = 'Reading — ↔ page, ↕ chapter, grip exit';
      } else {
        statusText = 'Reading — grip exit';
      }
      vrHud?.updateStatus(statusText);
      break;
    }

    case 'suppression-check': {
      const exercise = new SuppressionCheckExercise();
      exercise.setExitCallback(() => { xrManager?.end(); });

      await exercise.setup({
        renderer: perEyeRenderer,
        input: inputManager,
        contrast: contrastEngine,
      });

      activeExercise = exercise;
      vrHud?.updateStatus('Suppression Check — grip exit');
      break;
    }

    case 'brock-string': {
      const exercise = new BrockStringExercise();
      exercise.setExitCallback(() => { xrManager?.end(); });

      await exercise.setup({
        renderer: perEyeRenderer,
        input: inputManager,
        contrast: contrastEngine,
      });

      activeExercise = exercise;
      vrHud?.updateStatus('Brock String — trigger=fused, A=double, grip exit');
      break;
    }

    case 'vergence-training': {
      const exercise = new VergenceTrainingExercise();
      exercise.setExitCallback(() => { xrManager?.end(); });

      await exercise.setup({
        renderer: perEyeRenderer,
        input: inputManager,
        contrast: contrastEngine,
      });

      activeExercise = exercise;
      vrHud?.updateStatus('Vergence — trigger=fused, A=double, grip exit');
      break;
    }

    default:
      console.warn(`Exercise "${exerciseId}" not yet implemented`);
      vrHud?.updateStatus(`Exercise "${exerciseId}" coming soon`);
  }
}

// Boot
init().catch(console.error);
