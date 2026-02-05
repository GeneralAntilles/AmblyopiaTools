/**
 * Dichoptic contrast balancing logic.
 *
 * Manages the interocular contrast balance used in dichoptic exercises.
 * The dominant (fellow) eye's contrast is reduced to force the amblyopic
 * eye to contribute more to binocular vision.
 */

export interface ContrastSettings {
  /** Contrast multiplier for the dominant/fellow eye (0.0 - 1.0) */
  dominantEyeContrast: number;
  /** Contrast multiplier for the amblyopic eye (0.0 - 1.0, typically 1.0) */
  amblyopicEyeContrast: number;
  /** Whether to adaptively equalize contrast over time */
  adaptiveMode: boolean;
  /** Step size for adaptive contrast changes (fraction per correct response) */
  adaptiveStepSize: number;
}

const DEFAULT_SETTINGS: ContrastSettings = {
  dominantEyeContrast: 0.2,
  amblyopicEyeContrast: 1.0,
  adaptiveMode: false,
  adaptiveStepSize: 0.02,
};

export class ContrastEngine {
  private settings: ContrastSettings;
  private correctStreak: number = 0;
  private incorrectStreak: number = 0;

  constructor(settings?: Partial<ContrastSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  getSettings(): Readonly<ContrastSettings> {
    return { ...this.settings };
  }

  getDominantContrast(): number {
    return this.settings.dominantEyeContrast;
  }

  getAmblyopicContrast(): number {
    return this.settings.amblyopicEyeContrast;
  }

  setDominantContrast(value: number): void {
    this.settings.dominantEyeContrast = clamp(value, 0, 1);
  }

  setAmblyopicContrast(value: number): void {
    this.settings.amblyopicEyeContrast = clamp(value, 0, 1);
  }

  setAdaptiveMode(enabled: boolean): void {
    this.settings.adaptiveMode = enabled;
  }

  /**
   * Record a correct response (for adaptive mode).
   * After several correct responses, increase dominant eye contrast
   * to make the task harder (moving toward equal contrast = normal binocularity).
   */
  recordCorrect(): void {
    if (!this.settings.adaptiveMode) return;

    this.incorrectStreak = 0;
    this.correctStreak++;

    // After 3 correct in a row, increase dominant eye contrast (harder)
    if (this.correctStreak >= 3) {
      this.settings.dominantEyeContrast = clamp(
        this.settings.dominantEyeContrast + this.settings.adaptiveStepSize,
        0,
        1
      );
      this.correctStreak = 0;
    }
  }

  /**
   * Record an incorrect response.
   * After an incorrect response, decrease dominant eye contrast
   * to make the task easier.
   */
  recordIncorrect(): void {
    if (!this.settings.adaptiveMode) return;

    this.correctStreak = 0;
    this.incorrectStreak++;

    // After 1 incorrect, decrease dominant eye contrast (easier)
    if (this.incorrectStreak >= 1) {
      this.settings.dominantEyeContrast = clamp(
        this.settings.dominantEyeContrast - this.settings.adaptiveStepSize,
        0,
        1
      );
      this.incorrectStreak = 0;
    }
  }

  /**
   * Get the contrast ratio (dominant / amblyopic).
   * 1.0 = equal contrast (normal binocularity target).
   * Lower = more suppression of dominant eye.
   */
  getContrastRatio(): number {
    if (this.settings.amblyopicEyeContrast === 0) return 0;
    return this.settings.dominantEyeContrast / this.settings.amblyopicEyeContrast;
  }

  /**
   * Get a GLSL-compatible contrast uniform value for the given eye role.
   */
  getContrastUniform(isDominantEye: boolean): number {
    return isDominantEye
      ? this.settings.dominantEyeContrast
      : this.settings.amblyopicEyeContrast;
  }

  reset(): void {
    this.correctStreak = 0;
    this.incorrectStreak = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
