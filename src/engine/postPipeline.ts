import {
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  type Camera,
  type Scene,
} from "@babylonjs/core";
import type { QualityLevel } from "../data/quality";

/**
 * The grade: what turns a lit scene into a picture.
 *
 * One pipeline for the whole game, following whichever camera is active,
 * because the boot stage, the interior, the ground view and the fight all
 * draw into the same scene. Tone mapping and a touch of contrast on every
 * preset that can afford a post pass; anti-aliasing from Medium; bloom held
 * to a high threshold so only the reactor, the visor and plasma bleed light;
 * a vignette so faint it reads as a lens rather than a frame. Low runs bare.
 *
 * Every knob here is a lookup by preset, not a switch, and the whole thing is
 * one object to dispose.
 */

interface Grade {
  readonly enabled: boolean;
  readonly fxaa: boolean;
  readonly bloomWeight: number;
  readonly vignetteWeight: number;
}

const GRADES: Readonly<Record<QualityLevel, Grade>> = {
  low: { enabled: false, fxaa: false, bloomWeight: 0, vignetteWeight: 0 },
  medium: { enabled: true, fxaa: true, bloomWeight: 0, vignetteWeight: 0.6 },
  high: { enabled: true, fxaa: true, bloomWeight: 0.22, vignetteWeight: 0.9 },
  cinematic: { enabled: true, fxaa: true, bloomWeight: 0.3, vignetteWeight: 1.1 },
};

export function gradeFor(level: QualityLevel): Grade {
  return GRADES[level];
}

export class PostPipeline {
  private readonly scene: Scene;
  private pipeline: DefaultRenderingPipeline | null = null;
  private camera: Camera | null = null;
  private level: QualityLevel;
  private disposed = false;

  constructor(scene: Scene, level: QualityLevel) {
    this.scene = scene;
    this.level = level;
    this.rebuild();
  }

  /**
   * The active camera changed hands: the grade goes with it.
   *
   * Rebuilt from scratch rather than re-attached. Moving a live pipeline
   * between cameras left the bloom's highlight target destroyed but still
   * bound on WebGPU, and every frame after that was a validation error.
   * A camera swap is rare (boot stage, interior, ground, cockpit) and a
   * rebuild costs one frame.
   */
  follow(camera: Camera | null): void {
    if (this.disposed || camera === this.camera) return;
    this.camera = camera;
    this.rebuild();
  }

  setLevel(level: QualityLevel): void {
    if (this.disposed || level === this.level) return;
    this.level = level;
    this.rebuild();
  }

  /** What is actually on, for the debug overlay and tests. */
  status(): { level: QualityLevel; active: boolean; fxaa: boolean; bloom: boolean } {
    return {
      level: this.level,
      active: this.pipeline !== null,
      fxaa: this.pipeline?.fxaaEnabled ?? false,
      bloom: this.pipeline?.bloomEnabled ?? false,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pipeline?.dispose();
    this.pipeline = null;
    this.camera = null;
  }

  private rebuild(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    const grade = gradeFor(this.level);
    if (!grade.enabled || !this.camera) return;
    const pipeline = new DefaultRenderingPipeline("grade", false, this.scene, [this.camera]);
    pipeline.fxaaEnabled = grade.fxaa;
    pipeline.bloomEnabled = grade.bloomWeight > 0;
    if (pipeline.bloomEnabled) {
      pipeline.bloomThreshold = 0.82;
      pipeline.bloomWeight = grade.bloomWeight;
      pipeline.bloomKernel = 48;
      pipeline.bloomScale = 0.5;
    }
    pipeline.imageProcessingEnabled = true;
    const processing = pipeline.imageProcessing;
    processing.toneMappingEnabled = true;
    processing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    processing.exposure = 1.1;
    processing.contrast = 1.1;
    processing.vignetteEnabled = grade.vignetteWeight > 0;
    processing.vignetteWeight = grade.vignetteWeight;
    processing.vignetteStretch = 0.4;
    processing.vignetteColor.set(0.02, 0.03, 0.05, 1);
    this.pipeline = pipeline;
  }
}
