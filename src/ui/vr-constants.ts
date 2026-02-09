/**
 * Shared VR UI constants for consistent styling across exercises.
 *
 * All VR panels, text, and feedback should reference these values
 * instead of defining their own. Keeps the visual language unified.
 */

// === Colors ===
export const COLORS = {
  // Panel / environment
  PANEL_BG: '#16111e',
  PANEL_BORDER: '#362a40',
  ENV_GRADIENT: ['#1a0f20', '#160c1a', '#0f0812', '#0a060c'] as const,

  // Text
  TEXT_PRIMARY: '#e0d6cc',       // results text, reading text
  TEXT_INSTRUCTION: '#9688a0',   // in-exercise instructions
  TEXT_INDICATOR: '#6a5a70',     // page indicators, metadata
  TEXT_HUD: '#7a6a80',           // HUD status/timer
  TEXT_SPECIAL: '#dbb870',       // gold highlight (offset phase, guide ring)
  TEXT_WARM: '#c0b8a8',          // warm tan (special prompts)

  // Feedback
  FEEDBACK_SUCCESS: '#5cb87a',
  FEEDBACK_FAILURE: '#c47a5c',
  FEEDBACK_WARNING: '#c49a5c',   // amber for ambiguous (suppression)

  // Accent
  HIGHLIGHT_GOLD: 0xdbb870,
} as const;

// === Fonts ===
export const FONTS = {
  INSTRUCTION: 30,
  FEEDBACK: 36,
  RESULTS: 34,
  HUD_STATUS: 20,
  HUD_TIMER: 22,
  INDICATOR: 20,
} as const;

// === Panel Dimensions ===
export const PANELS = {
  INSTRUCTION_WIDTH: 1.4,
  INSTRUCTION_HEIGHT: 0.20,
  INSTRUCTION_Y_OFFSET: -0.40,   // below CONTENT_Y
  INSTRUCTION_Z: -2.0,

  FEEDBACK_WIDTH: 0.8,
  FEEDBACK_HEIGHT: 0.12,
  FEEDBACK_Y_OFFSET: 0.35,       // above CONTENT_Y

  RESULTS_WIDTH: 1.3,
  RESULTS_BORDER_RADIUS: 32,
  RESULTS_BORDER_WIDTH: 3,
  RESULTS_PADDING_X: 60,
  RESULTS_PADDING_Y: 50,
} as const;

// === Canvas Render Dimensions ===
export const CANVAS = {
  INSTRUCTION_WIDTH: 1024,
  INSTRUCTION_HEIGHT: 140,
  FEEDBACK_WIDTH: 512,
  FEEDBACK_HEIGHT: 72,
  RESULTS_WIDTH: 1024,
} as const;

// === Timing ===
export const TIMING = {
  FEEDBACK_MS: 800,
  INTER_TRIAL_MS: 800,
  FADE_IN_MS: 300,
} as const;

// === Content positioning ===
export const CONTENT_Y = 1.5;
