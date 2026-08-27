export enum AppState {
  Boot = "Boot",
  MainMenu = "MainMenu",
  Loading = "Loading",
  Shatterdome = "Shatterdome",
  Deployment = "Deployment",
  Combat = "Combat",
  Results = "Results",
  /** Developer asset browser. Reachable from the menu; never part of a campaign run. */
  AssetGallery = "AssetGallery",
  /** Save and load management. Reachable from the menu and, later, from in-game. */
  Saves = "Saves",
  /** Globe map: coordinates, sectors, and deployment between regions. */
  WorldMap = "WorldMap",
  /**
   * The simulator. A separate mode with no costs, no rewards and no campaign.
   *
   * Reachable only from the menu, and it leaves the same way: there is
   * deliberately no transition between the sandbox and a career, because a
   * player must never be able to wander from one into the other with anything
   * in their hands.
   */
  Sandbox = "Sandbox",
  Error = "Error",
}

const ALLOWED_TRANSITIONS: Record<AppState, readonly AppState[]> = {
  [AppState.Boot]: [AppState.MainMenu, AppState.Error],
  [AppState.MainMenu]: [
    AppState.Loading,
    AppState.AssetGallery,
    AppState.Saves,
    AppState.WorldMap,
    AppState.Sandbox,
    AppState.Error,
  ],
  [AppState.Loading]: [AppState.Shatterdome, AppState.Deployment, AppState.Error],
  // Saving from inside the complex rather than only from the menu: a player
  // who has just ordered a build should not have to leave the game to keep it.
  [AppState.Shatterdome]: [AppState.MainMenu, AppState.Deployment, AppState.Saves, AppState.Error],
  [AppState.Deployment]: [AppState.Combat, AppState.Shatterdome, AppState.Error],
  [AppState.Combat]: [AppState.Results, AppState.Error],
  [AppState.Results]: [AppState.Shatterdome, AppState.MainMenu, AppState.Error],
  [AppState.AssetGallery]: [AppState.MainMenu, AppState.Error],
  [AppState.Saves]: [AppState.MainMenu, AppState.Loading, AppState.Shatterdome, AppState.Error],
  [AppState.WorldMap]: [AppState.MainMenu, AppState.Deployment, AppState.Error],
  // Out to the menu or into a sandbox fight, and never into a campaign.
  [AppState.Sandbox]: [AppState.MainMenu, AppState.WorldMap, AppState.Error],
  [AppState.Error]: [AppState.MainMenu],
};

export type AppStateListener = (to: AppState, from: AppState) => void;

/** Central application state machine. Every screen/module reacts to this rather than owning its own mode flags. */
export class AppStateMachine {
  private current: AppState = AppState.Boot;
  private readonly listeners = new Set<AppStateListener>();

  get state(): AppState {
    return this.current;
  }

  canTransition(to: AppState): boolean {
    return ALLOWED_TRANSITIONS[this.current].includes(to);
  }

  transition(to: AppState): void {
    if (!this.canTransition(to)) {
      throw new Error(`Illegal app state transition: ${this.current} -> ${to}`);
    }
    const from = this.current;
    this.current = to;
    for (const listener of this.listeners) listener(to, from);
  }

  onChange(listener: AppStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
