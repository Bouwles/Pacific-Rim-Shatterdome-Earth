/**
 * When a new version is allowed to take over.
 *
 * A waiting service worker is a loaded gun: activating it reloads the page,
 * and reloading the page mid-combat throws a fight away. This state machine is
 * the safety. An update is *noticed* whenever it arrives, *offered* only from
 * a safe place, and *applied* only after the player says yes and the saves
 * have been flushed. Postponing is always allowed and costs nothing: the old
 * version keeps running and the offer returns at the next safe moment.
 *
 * Pure. The browser binding feeds it events and reads its state; nothing here
 * touches the registration, the DOM or a clock.
 */

/** Places an update may be offered and applied. Nowhere else, ever. */
export const SAFE_PLACES = ["MainMenu", "Saves", "Sandbox"] as const;

export type UpdatePhase =
  "idle" | "downloading" | "waiting-unsafe" | "offered" | "postponed" | "flushing" | "applying";

export interface UpdateFlowView {
  readonly phase: UpdatePhase;
  /** True exactly when the interface should show the offer. */
  readonly showOffer: boolean;
  /** One sentence for the banner. Empty when there is nothing to say. */
  readonly message: string;
}

export class UpdateFlow {
  private phase: UpdatePhase = "idle";
  private place = "Boot";
  private postponedInPlace = false;

  /** A new worker has started installing. Nothing to offer yet. */
  updateDownloading(): void {
    if (this.phase === "idle") this.phase = "downloading";
  }

  /** A new worker is installed and waiting. Offer it only somewhere safe. */
  updateReady(): void {
    if (this.phase === "flushing" || this.phase === "applying") return;
    this.phase = this.isSafe() ? "offered" : "waiting-unsafe";
  }

  /** The app moved. A pending offer follows the player to the next safe place. */
  placeChanged(place: string): void {
    this.place = place;
    // A postponement lasts until the player leaves and returns: asking again in
    // the same menu visit would be nagging.
    if (this.postponedInPlace && this.phase === "postponed") {
      this.postponedInPlace = false;
      return;
    }
    if ((this.phase === "waiting-unsafe" || this.phase === "postponed") && this.isSafe()) {
      this.phase = "offered";
    } else if (this.phase === "offered" && !this.isSafe()) {
      this.phase = "waiting-unsafe";
    }
  }

  /** The player said later. Always allowed, never punished. */
  postpone(): void {
    if (this.phase !== "offered") return;
    this.phase = "postponed";
    this.postponedInPlace = true;
  }

  /**
   * The player said yes. The binding must now flush saves, and only call
   * `flushed()` when that has genuinely finished.
   */
  accept(): boolean {
    if (this.phase !== "offered" || !this.isSafe()) return false;
    this.phase = "flushing";
    return true;
  }

  /** Saves are on disk. The binding may now tell the worker to take over. */
  flushed(): boolean {
    if (this.phase !== "flushing") return false;
    this.phase = "applying";
    return true;
  }

  view(): UpdateFlowView {
    const messages: Readonly<Record<UpdatePhase, string>> = {
      idle: "",
      downloading: "An update is downloading in the background.",
      "waiting-unsafe": "An update is ready. It will be offered from the menu.",
      offered: "An update is ready. Applying it saves everything and reloads.",
      postponed: "Update postponed. It will be offered again later.",
      flushing: "Saving before the update.",
      applying: "Updating.",
    };
    return {
      phase: this.phase,
      showOffer: this.phase === "offered",
      message: messages[this.phase],
    };
  }

  private isSafe(): boolean {
    return (SAFE_PLACES as readonly string[]).includes(this.place);
  }
}
