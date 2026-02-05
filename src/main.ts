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
    // Load settings
    const settings = await settingsStore.getSettings();

    // Create XR session manager
    xrManager = new XRSessionManager(canvas);

    xrManager.setCallbacks({
      onSessionStarted: async (session) => {
        canvas.style.display = 'block';

        // Initialize per-eye renderer
        const gl = xrManager!.getGL()!;
        perEyeRenderer = new PerEyeRenderer(canvas, gl);
        perEyeRenderer.setTrainingEye(settings.trainingEye as EyeSide);
        await perEyeRenderer.setSession(session);

        // Initialize input
        inputManager = new InputManager();
        inputManager.setSession(session);

        // Initialize contrast engine
        contrastEngine = new ContrastEngine({
          dominantEyeContrast: settings.contrastDominant,
          amblyopicEyeContrast: settings.contrastAmblyopic,
        });

        // Initialize VR HUD
        vrHud = new VRHud();
        perEyeRenderer.getTrainingScene().add(vrHud.getGroup());

        // Start the exercise
        await startExercise(exerciseId, settings);

        // Start analytics session
        analytics.startSession(exerciseId);
      },

      onSessionEnded: async () => {
        canvas.style.display = 'none';

        // Get stats before teardown
        const stats = activeExercise?.getSessionStats();

        // Teardown exercise
        activeExercise?.teardown();
        activeExercise = null;

        // End analytics session
        const record = await analytics.endSession(stats);

        // Dispose resources
        vrHud?.dispose();
        vrHud = null;
        inputManager?.dispose();
        inputManager = null;
        perEyeRenderer?.dispose();
        perEyeRenderer = null;
        contrastEngine = null;
        xrManager = null;

        // Show session summary
        if (stats) {
          const summaryEl = document.getElementById('session-summary')!;
          showSessionSummary(summaryEl, stats);
        }

        // Re-enable button
        vrBtn.disabled = false;
        vrBtn.textContent = 'Enter VR';

        console.log('Session ended:', record);
      },

      onFrame: (time, frame, refSpace) => {
        // Calculate delta time
        const dt = lastFrameTime ? (time - lastFrameTime) / 1000 : 0;
        lastFrameTime = time;

        // Poll input
        inputManager?.update();

        // Update exercise
        activeExercise?.update(dt);

        // Update HUD timer
        if (vrHud && analytics.getActiveSession()) {
          const elapsed = Date.now() - analytics.getActiveSession()!.startTime;
          vrHud.updateTimer(elapsed);
        }

        // Render per-eye
        perEyeRenderer?.renderFrame(frame, refSpace);
      },

      onError: (error) => {
        console.error('XR Error:', error);
        vrBtn.disabled = false;
        vrBtn.textContent = 'Enter VR';
        canvas.style.display = 'none';
      },
    });

    await xrManager.start();
  } catch (error) {
    console.error('Failed to start VR:', error);
    vrBtn.disabled = false;
    vrBtn.textContent = 'Enter VR';

    const statusDiv = document.getElementById('webxr-status')!;
    statusDiv.innerHTML = `<div class="no-webxr">Failed to start VR session: ${error instanceof Error ? error.message : String(error)}</div>`;
  }
}

/**
 * Instantiate and set up the requested exercise.
 */
async function startExercise(
  exerciseId: string,
  settings: Awaited<ReturnType<typeof settingsStore.getSettings>>
): Promise<void> {
  if (!perEyeRenderer || !inputManager || !contrastEngine) return;

  switch (exerciseId) {
    case 'monocular-reading': {
      const readingText = launcher.getReadingText();
      const currentSettings = launcher.getCurrentSettings();

      const exercise = new MonocularReadingExercise({
        text: readingText || undefined,
        fontSize: currentSettings.fontSize as number,
        lineHeight: currentSettings.lineHeight as number,
        wordsPerPage: currentSettings.wordsPerPage as number,
        fontFamily: currentSettings.fontFamily as string,
        nonTrainingDisplay: currentSettings.nonTrainingDisplay as 'blank' | 'fixation' | 'pattern',
      });

      exercise.setExitCallback(() => {
        xrManager?.end();
      });

      await exercise.setup({
        renderer: perEyeRenderer,
        input: inputManager,
        contrast: contrastEngine,
      });

      activeExercise = exercise;

      // Update HUD
      vrHud?.updateStatus('Monocular Reading — Grip to exit');
      break;
    }

    default:
      console.warn(`Exercise "${exerciseId}" not yet implemented`);
      vrHud?.updateStatus(`Exercise "${exerciseId}" coming soon`);
  }
}

// Boot
init().catch(console.error);
