import type { SimulationKernel } from "../simulation/kernel";
import { SaveError } from "../saves/repository";
import type { SaveService } from "../saves/saveService";
import type { WorldSnapshot } from "../world/worldState";
import type { ShatterdomeSnapshot } from "../shatterdome/facilityState";
import type { RosterSnapshot } from "../jaegers/roster";
import type { DirectorSnapshot } from "../world/director";
import type { MissionSnapshot } from "../missions/mission";

/**
 * Everything about saving that needs the browser: thumbnails from the canvas,
 * file downloads, file reads, and play-time accounting. The save service itself
 * stays DOM-free so it can be tested headlessly.
 */
export class SaveController {
  private accumulatedMs = 0;
  private sessionStart: number;

  /**
   * `captureFrame` must resolve from inside the render loop, immediately after a
   * frame is drawn. Reading the canvas at an arbitrary moment yields a blank
   * image under WebGPU, whose back buffer is not readable once the frame ends.
   */
  constructor(
    private readonly service: SaveService,
    private readonly captureFrame: () => Promise<string | null>,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.sessionStart = this.now();
  }

  get playTimeMs(): number {
    return this.accumulatedMs + (this.now() - this.sessionStart);
  }

  /** Folds elapsed time into the total, e.g. when a save is loaded and the clock restarts. */
  resetPlayTime(baseMs: number): void {
    this.accumulatedMs = Math.max(0, baseMs);
    this.sessionStart = this.now();
  }

  /** Returns null rather than throwing: a missing thumbnail must never fail a save. */
  private async thumbnail(): Promise<string | null> {
    try {
      return await this.captureFrame();
    } catch {
      return null;
    }
  }

  async save(
    slotId: string,
    kernel: SimulationKernel,
    name: string,
    world?: WorldSnapshot,
    shatterdome?: ShatterdomeSnapshot,
    roster?: RosterSnapshot,
    director?: DirectorSnapshot,
    mission?: MissionSnapshot | null,
  ): Promise<void> {
    await this.service.save(slotId, kernel, {
      name,
      playTimeMs: this.playTimeMs,
      thumbnail: await this.thumbnail(),
      world,
      shatterdome,
      roster,
      director,
      mission,
    });
  }

  async autosave(
    kernel: SimulationKernel,
    world?: WorldSnapshot,
    shatterdome?: ShatterdomeSnapshot,
    roster?: RosterSnapshot,
    director?: DirectorSnapshot,
    mission?: MissionSnapshot | null,
  ): Promise<string> {
    return this.service.autosave(kernel, {
      playTimeMs: this.playTimeMs,
      thumbnail: await this.thumbnail(),
      world,
      shatterdome,
      roster,
      director,
      mission,
    });
  }

  /** Hands the player a file. The blob URL is revoked once the click has been dispatched. */
  async download(slotId: string): Promise<void> {
    const text = await this.service.exportSlot(slotId);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slotId.replace(/[^a-z0-9._-]/gi, "_")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async importFile(slotId: string, file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      throw new SaveError("invalid-import", "That file could not be read.", error);
    }
    await this.service.importInto(slotId, text);
  }
}

/** Turns any failure into something a player can act on. */
export function describeSaveError(error: unknown): string {
  if (error instanceof SaveError) {
    switch (error.kind) {
      case "quota-exceeded":
        return "Storage is full. Delete a save or free browser storage, then try again.";
      case "unavailable":
        return "This browser is not allowing storage, so saves cannot persist. Private windows usually block it.";
      case "not-found":
        return "That save no longer exists.";
      case "corrupt":
        return error.message;
      case "invalid-import":
      case "migration-failed":
        return error.message;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
