/**
 * OpenVisionTherapy — main entry point.
 *
 * Boots the launcher and connects the WebXR session lifecycle to the
 * SessionHost, which runs the exercise itself.
 */

import { XRSessionManager } from './core/xr-session';
import { PerEyeRenderer, type EyeSide } from './core/per-eye-renderer';
import { InputManager } from './core/input-manager';
import { SettingsStore } from './core/settings-store';
import { SessionHost } from './core/session-host';
import { Launcher } from './ui/launcher';
import { VRHud } from './ui/vr-hud';
import { showSessionSummary } from './ui/session-summary';
import { DesktopPreviewRenderer, isPreviewMode } from './dev/desktop-preview';

const settingsStore = new SettingsStore();
const launcher = new Launcher(settingsStore);
const host = new SessionHost(settingsStore);

/** XR-side resources for the current session. */
interface XRResources {
  xr: XRSessionManager;
  renderer: PerEyeRenderer;
  input: InputManager;
  hud: VRHud;
}
let xrResources: XRResources | null = null;
let preview: { renderer: DesktopPreviewRenderer; input: InputManager; hud: VRHud } | null = null;

async function init(): Promise<void> {
  await launcher.init();

  const vrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const statusDiv = document.getElementById('webxr-status')!;

  if (isPreviewMode()) {
    vrBtn.disabled = false;
    vrBtn.textContent = 'Enter Preview';
  } else if (await XRSessionManager.isSupported()) {
    vrBtn.disabled = false;
    vrBtn.textContent = 'Enter VR';
  } else {
    vrBtn.disabled = true;
    vrBtn.textContent = 'WebXR Not Available';
    statusDiv.innerHTML =
      '<div class="no-webxr">WebXR is not available in this browser. Open this page in a VR headset browser (e.g., Meta Quest Browser) to use immersive mode.</div>';
  }

  launcher.setEnterVRCallback(isPreviewMode() ? handleEnterPreview : handleEnterVR);
  host.onExitRequested = () => {
    if (preview) endPreview();
    else xrResources?.xr.end();
  };
}

/** Desktop stand-in for VR (see dev/desktop-preview.ts). */
async function handleEnterPreview(exerciseId: string): Promise<void> {
  const canvas = document.getElementById('xr-canvas') as HTMLCanvasElement;
  canvas.style.display = 'block';

  const settings = await settingsStore.getSettings();
  const renderer = new DesktopPreviewRenderer(canvas, settings.trainingEye);
  const input = new InputManager();
  const hud = new VRHud();
  renderer.addToBothEyes(hud.getGroup());
  preview = { renderer, input, hud };

  await host.start(exerciseId, launcher.getLaunchOptions(), { renderer, input, hud });
  renderer.start(input, (dt) => host.tick(dt));
}

async function endPreview(): Promise<void> {
  if (!preview) return;
  const { renderer, input, hud } = preview;
  preview = null;
  (document.getElementById('xr-canvas') as HTMLCanvasElement).style.display = 'none';

  const outcome = await host.end();
  hud.dispose();
  input.dispose();
  renderer.dispose();

  if (outcome) showSessionSummary(document.getElementById('session-summary')!, outcome);
  launcher.renderSessionHistory();
}

async function handleEnterVR(exerciseId: string): Promise<void> {
  const vrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const canvas = document.getElementById('xr-canvas') as HTMLCanvasElement;

  vrBtn.disabled = true;
  vrBtn.textContent = 'Starting VR...';

  try {
    const settings = await settingsStore.getSettings();

    const xr = new XRSessionManager();
    xr.setOnSessionEnded(handleSessionEnded);
    const session = await xr.requestSession();

    canvas.style.display = 'block';

    // Three.js owns the XR render loop
    const renderer = new PerEyeRenderer(canvas);
    renderer.setTrainingEye(settings.trainingEye as EyeSide);

    const input = new InputManager();
    input.setSession(session);

    const hud = new VRHud();
    renderer.addToBothEyes(hud.getGroup());

    xrResources = { xr, renderer, input, hud };

    await host.start(exerciseId, launcher.getLaunchOptions(), { renderer, input, hud });

    let lastFrameTime = 0;
    renderer.onFrame((time) => {
      const dt = lastFrameTime ? (time - lastFrameTime) / 1000 : 0;
      lastFrameTime = time;
      input.update();
      host.tick(dt);
    });

    await renderer.startSession(session);
  } catch (error) {
    console.error('Failed to start VR:', error);
    await xrResources?.xr.end();
    vrBtn.disabled = false;
    vrBtn.textContent = 'Enter VR';

    const statusDiv = document.getElementById('webxr-status')!;
    statusDiv.innerHTML = `<div class="no-webxr">Failed to start VR session: ${error instanceof Error ? error.message : String(error)}</div>`;
  }
}

/** Called when the XR session ends (grip exit or leaving VR from the system menu). */
async function handleSessionEnded(): Promise<void> {
  const vrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const canvas = document.getElementById('xr-canvas') as HTMLCanvasElement;
  canvas.style.display = 'none';

  const outcome = await host.end();

  if (xrResources) {
    xrResources.hud.dispose();
    xrResources.input.dispose();
    xrResources.renderer.dispose();
    xrResources = null;
  }

  if (outcome) {
    showSessionSummary(document.getElementById('session-summary')!, outcome);
    console.log('Session ended:', outcome.record);
  }

  vrBtn.disabled = false;
  vrBtn.textContent = 'Enter VR';
  launcher.renderSessionHistory();
}

init().catch(console.error);
