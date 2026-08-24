import { Tools, Vector3, type Scene } from "@babylonjs/core";
import { createEngineAdapter } from "../engine/engineAdapter";
import { buildBootScene, type BootScene } from "../engine/scene";
import { DebugOverlay } from "../debug/overlay";
import { SimulationKernel } from "../simulation/kernel";
import { SimulationLoop } from "../simulation/loop";
import { resolveSeed } from "./config";
import { AppState, AppStateMachine } from "./appState";
import { renderErrorScreen, renderLoadingScreen, renderMainMenu, clearScreen } from "../ui/screens";
import { renderGalleryScreen, type GalleryScreenHandle } from "../ui/galleryScreen";
import { AssetGallery } from "../debug/gallery";
import { AssetResolver } from "../assets/resolver";
import { createGeneratorRegistry } from "../assets/generators";
import { createDefaultAssetRegistry } from "../data/assets";
import { GALLERY_OVERRIDES, buildOverrideMap } from "./galleryOverrides";
import { renderSaveScreen, type SaveScreenHandle } from "../ui/saveScreen";
import { SaveController, describeSaveError } from "./saveController";
import { SaveService } from "../saves/saveService";
import { IndexedDbSaveRepository } from "../saves/indexedDbRepository";
import { MemorySaveRepository, type SaveRepository } from "../saves/repository";
import { probeStorageHealth } from "../saves/storageHealth";
import {
  renderWorldScreen,
  type CityReadout,
  type EnvironmentReadout,
  type StreamingReadout,
  type WorldScreenHandle,
  type WorldViewMode,
} from "../ui/worldScreen";
import { GlobeView } from "../debug/globeView";
import { WorldState } from "../world/worldState";
import { Roster } from "../jaegers/roster";
import {
  componentFraction,
  componentState,
  disabledSystems,
  mobilityPenalty,
  recordScar,
  structuralIntegrity,
} from "../jaegers/damage";
import { describeStatus } from "../jaegers/roster";
import { FloatingOrigin } from "../world/floatingOrigin";
import { neighborIds } from "../world/cubeSphere";
import type { GeoPosition, LocalPosition } from "../world/coordinates";
import { createDefaultRegionRegistry, createDefaultTerrainAnchors } from "../data/regions";
import { SECTOR_STATES, SectorStreamer } from "../world/sectorStreaming";
import { SectorRenderer } from "../engine/sectorRenderer";
import { WorkerTerrainService } from "../workers/terrainWorkerClient";
import { buildRouteSamples, STRESS_ROUTE_REGION_IDS, type RouteSample } from "../debug/streamRoute";
import { createClimateRegistry } from "../data/climates";
import {
  createQualityRegistry,
  resolveQualityLevel,
  type QualityLevel,
  type QualityPreset,
} from "../data/quality";
import { SkyView } from "../engine/skyView";
import { WeatherView } from "../engine/weatherView";
import { AmbientAudio } from "../engine/ambientAudio";
import { resolveFeetHeight, sampleWaveHeight, waveFieldCoordinates } from "../world/ocean";
import type { EnvironmentSample } from "../world/environment";
import { createDistrictRegistry, HONG_KONG_DISTRICT_PLAN, type DistrictKind } from "../data/districts";
import { generateCityLayout, type CityLayout } from "../world/cityLayout";
import {
  ALERT_LEVELS,
  ALERT_PROFILES,
  sampleActivity,
  type ActivitySample,
  type AlertLevel,
} from "../world/cityActivity";
import { CityView } from "../engine/cityView";
import { geoToLocal, localToGeo } from "../world/coordinates";
import { PilotSession } from "../jaegers/pilotSession";
import { JaegerView } from "../engine/jaegerView";
import { PilotInputSource } from "../engine/pilotInput";
import { renderPilotScreen, type PilotScreenHandle } from "../ui/pilotScreen";
import type { CameraMode } from "../jaegers/camera";
import { COMBAT_TICK_SECONDS, createMoveRegistry } from "../data/moves";
import { createKaijuRegistry } from "../data/kaiju";
import {
  CombatArena,
  combatProfileFor,
  jaegerLayout,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
  type CombatEvent,
} from "../combat/arena";
import { CombatView } from "../engine/combatView";
import type { MoveListEntry, PilotCombatState, PilotDamageState } from "../ui/pilotScreen";
import { createPropRegistry, spawnProp, type PropInstance } from "../data/props";
import type { SpaceQuery } from "../combat/finisher";
import { moveLengthTicks, type MoveDefinition } from "../data/moves";
import { createWeaponRegistry } from "../data/weapons";
import { createFacilityRegistry, FACILITY_KINDS, type FacilityKind } from "../data/facilities";
import { CREW_MEMBERS, shiftAt } from "../data/personnel";
import { jaegerRegistry } from "../data/jaegers";
import { ShatterdomeState } from "../shatterdome/facilityState";
import { ShatterdomeSession } from "../shatterdome/session";
import { CONN_POD_ROOM_ID } from "../shatterdome/interiorLayout";
import { NEUTRAL_INPUT, ON_FOOT } from "../shatterdome/onFoot";
import { InteriorView } from "../engine/interiorView";
import { OnFootInputSource } from "../engine/onFootInput";
import {
  renderShatterdomeScreen,
  type FacilityRow,
  type ShatterdomePanelState,
  type BerthPanelState,
  type ShatterdomeScreenHandle,
} from "../ui/shatterdomeScreen";

export interface AppHandle {
  dispose(): void;
}

const THUMBNAIL_WIDTH = 192;

/** Stress route pacing. Fast enough to cross a sector every few seconds. */
const ROUTE_SPEED_MPS = 4_000;
const ROUTE_STEP_SECONDS = 0.25;
/** DOM writes are throttled; the streamer itself still updates every frame. */
const READOUT_INTERVAL_MS = 250;
/**
 * Height of the body the environment is sampled for. The ground view's player
 * marker is a 75 m Jaeger-scale box, so water states are resolved against that
 * rather than against a person who would drown in the shallows.
 */
const PLAYER_HEIGHT_METERS = 75;
/**
 * Ground height under the Shatterdome, metres.
 *
 * The complex stands on the apron above the waterline, so a person inside it is
 * on dry ground whatever the tide is doing. Without this the environment would
 * resolve a person standing at sea level and report them wading through the
 * command floor.
 */
const SHATTERDOME_DECK_HEIGHT_METERS = 8;

/** What a transition is called while it is happening. A table, not a chain of ternaries. */
const TRANSIT_LABELS: Readonly<Record<string, string>> = {
  door: "Door",
  lift: "Lift",
  tram: "Tram",
};

/** Babylon ArcRotateCamera defaults, restored when the ground view closes. */
const DEFAULT_CAMERA_MIN_Z = 1;
const DEFAULT_CAMERA_MAX_Z = 10_000;

/**
 * Renders a thumbnail through a render target rather than reading the canvas.
 * A WebGPU swap chain is not a drawable 2D source once its frame has ended, so
 * copying the canvas returns a blank image; rendering to a texture works on both
 * backends.
 */
async function captureThumbnail(scene: Scene): Promise<string | null> {
  const camera = scene.activeCamera;
  if (!camera) return null;
  try {
    return await Tools.CreateScreenshotUsingRenderTargetAsync(
      scene.getEngine(),
      camera,
      { width: THUMBNAIL_WIDTH, height: Math.round(THUMBNAIL_WIDTH * 0.5625) },
      "image/jpeg",
      1,
      false,
    );
  } catch {
    return null;
  }
}

/**
 * Wires engine, scene, diagnostics, state machine, and DOM screens together.
 * This is the only place allowed to know how those modules connect.
 */
export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const canvas = root.querySelector<HTMLCanvasElement>("#renderCanvas");
  const uiRoot = root.querySelector<HTMLElement>("#uiRoot");
  const contextBanner = root.querySelector<HTMLElement>("#contextBanner");
  if (!canvas || !uiRoot || !contextBanner) {
    throw new Error("bootstrap: expected #renderCanvas, #uiRoot, #contextBanner in the root element");
  }

  const stateMachine = new AppStateMachine();
  const unsubscribers: Array<() => void> = [];

  const qualityRegistry = createQualityRegistry();
  const climateRegistry = createClimateRegistry();
  // Resolved before the scene exists because the shadow map size is decided at
  // construction; changing it later rebuilds the generator rather than resizing.
  let quality: QualityPreset = qualityRegistry.getOrThrow(resolveQualityLevel(window.location.search));

  let overlay: DebugOverlay | undefined;
  let kernel: SimulationKernel | undefined;
  /**
   * The transport. Hoisted out of the boot block because the Shatterdome pause
   * menu drives it: pausing inside the complex has to stop construction and the
   * clock, not just hide the view.
   */
  let loop: SimulationLoop | undefined;
  let adapterDispose: (() => void) | undefined;
  let bootScene: BootScene;
  /**
   * Per-frame work owned by whichever screen is open. Sector streaming has to run
   * on the render loop rather than on a timer, because it is paced against frame
   * budget: one upload per frame is the whole point.
   */
  let frameHook: ((deltaMs: number) => void) | null = null;
  /**
   * Advances world time. Assigned once world state exists.
   *
   * The render loop starts before that, and there is an `await` in between, so
   * the first frame really can arrive first; referencing world state directly
   * from the loop would throw on that frame.
   */
  let advanceWorldTime: ((ticks: number) => void) | null = null;

  try {
    const adapter = await createEngineAdapter(canvas);
    adapterDispose = adapter.dispose;

    bootScene = buildBootScene(adapter.engine, canvas, quality.shadowMapSize);
    const scene = bootScene.scene;

    kernel = new SimulationKernel({ seed: resolveSeed(window.location.search) });
    const activeLoop = new SimulationLoop(kernel);
    loop = activeLoop;

    overlay = new DebugOverlay(root, {
      backend: adapter.backend,
      babylonVersion: adapter.version,
      scene,
      kernel,
      loop: activeLoop,
      // No physics backend is wired yet; null makes the overlay say so.
      activePhysicsBodies: () => null,
    });

    const simKernel = kernel;
    let lastEnvironmentTick = 0;
    adapter.engine.runRenderLoop(() => {
      const deltaMs = adapter.engine.getDeltaTime();
      activeLoop.advance(deltaMs);
      // Drain outside the tick so subscribers never mutate state mid-step.
      simKernel.events.drain();

      // World time advances with simulation ticks, never with wall clock. Pausing
      // the simulation therefore pauses the sun, and a save reproduces the sky it
      // was written under.
      const advanced = simKernel.tick - lastEnvironmentTick;
      if (advanced > 0 && advanceWorldTime) {
        lastEnvironmentTick = simKernel.tick;
        advanceWorldTime(advanced);
      }

      frameHook?.(deltaMs);
      scene.render();
    });

    adapter.onContextLost(() => {
      contextBanner.textContent = "Rendering context lost — attempting recovery…";
      contextBanner.hidden = false;
    });
    adapter.onContextRestored(() => {
      contextBanner.hidden = true;
    });

    stateMachine.transition(AppState.MainMenu);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Boot itself failed (no engine/scene exists) — go straight to Error without a MainMenu hop.
    stateMachine.transition(AppState.Error);
    // No working engine to recover into from here; a reload is the only honest recovery path.
    renderErrorScreen(uiRoot, `Boot failed: ${message}`, () => window.location.reload());
    return { dispose: () => unsubscribers.forEach((u) => u()) };
  }

  const goToMainMenu = (): void => {
    stateMachine.transition(AppState.MainMenu);
  };

  const assetRegistry = createDefaultAssetRegistry();
  const assetResolver = new AssetResolver(createGeneratorRegistry());
  let gallery: AssetGallery | undefined;
  let galleryScreen: GalleryScreenHandle | undefined;
  let galleryOverrideId = "default";
  let galleryDamage = 0;

  const closeGallery = (): void => {
    gallery?.dispose();
    gallery = undefined;
    galleryScreen?.dispose();
    galleryScreen = undefined;
    galleryDamage = 0;
    // Restore the boot scene the gallery borrowed the camera and stage from.
    bootScene.jaegerPlaceholder.setEnabled(true);
    bootScene.camera.setTarget(new Vector3(0, 25, 0));
    bootScene.camera.radius = 110;
    bootScene.camera.lowerRadiusLimit = 10;
    bootScene.camera.upperRadiusLimit = 300;
  };

  const openGallery = async (): Promise<void> => {
    // The gallery takes over the stage: the boot placeholder would otherwise sit
    // inside the asset row.
    bootScene.jaegerPlaceholder.setEnabled(false);

    gallery?.dispose();
    gallery = await AssetGallery.create(
      bootScene.scene,
      bootScene.camera,
      assetRegistry,
      assetResolver,
      buildOverrideMap(galleryOverrideId, assetRegistry.all()),
    );

    const refresh = (index: number): void => {
      const measurements = gallery?.measurements(index);
      if (measurements) galleryScreen?.update(measurements, galleryDamage, galleryOverrideId);
    };

    galleryScreen = renderGalleryScreen(
      uiRoot,
      gallery.list().map((entry) => ({
        id: entry.manifest.id,
        displayName: entry.manifest.displayName,
        assetClass: entry.manifest.assetClass,
      })),
      GALLERY_OVERRIDES.map((entry) => ({ id: entry.id, label: entry.label })),
      gallery.budgetViolations(),
      {
        onSelect: (index) => {
          gallery?.focus(index);
          refresh(index);
        },
        onDamageChange: (level) => {
          galleryDamage = level;
          const index = gallery?.list().findIndex((entry) => entry === gallery?.selected) ?? 0;
          gallery?.previewDamage(index, level);
          refresh(index);
        },
        onSpinToggle: (spinning) => gallery?.setSpinning(spinning),
        onOverrideChange: (overrideId) => {
          galleryOverrideId = overrideId;
          void openGallery();
        },
        onExit: () => stateMachine.transition(AppState.MainMenu),
      },
    );

    refresh(0);
  };

  // IndexedDB is the durable store. When it cannot be opened, which is common in
  // private windows, the game keeps running against memory and the storage panel
  // says plainly that saves will not survive the tab.
  let repository: SaveRepository;
  try {
    repository = await IndexedDbSaveRepository.open();
  } catch {
    repository = new MemorySaveRepository();
  }
  const saveService = new SaveService({ repository });
  /**
   * Where the save panel goes back to. Opening it from inside the Shatterdome
   * and being dropped at the main menu would lose the room the player was in.
   */
  let savesReturnState: AppState = AppState.MainMenu;
  const saveController = new SaveController(saveService, () => captureThumbnail(bootScene.scene));
  let saveScreen: SaveScreenHandle | undefined;

  const closeSaves = (): void => {
    saveScreen?.dispose();
    saveScreen = undefined;
  };

  const refreshSaves = async (): Promise<void> => {
    if (!saveScreen) return;
    const [slots, health] = await Promise.all([saveService.listSlots(), probeStorageHealth(repository)]);
    saveScreen.update(slots, health);
  };

  /** Runs a save action, reporting the outcome either way. */
  const runSaveAction = (action: () => Promise<string>): void => {
    void action()
      .then(async (message) => {
        await refreshSaves();
        saveScreen?.notify(message, "info");
      })
      .catch(async (error) => {
        await refreshSaves();
        saveScreen?.notify(describeSaveError(error), "error");
      });
  };

  const openSaves = async (): Promise<void> => {
    saveScreen = renderSaveScreen(
      uiRoot,
      {
        onSaveNew: (name) =>
          runSaveAction(async () => {
            const trimmed = name.trim() || `Save ${new Date().toLocaleTimeString()}`;
            const slotId = `slot.${Date.now().toString(36)}`;
            if (!kernel) throw new Error("No simulation is running.");
            await saveController.save(
              slotId,
              kernel,
              trimmed,
              worldState.serialize(),
              shatterdomeState.serialize(),
              roster.snapshot(),
            );
            return `Saved "${trimmed}".`;
          }),
        onOverwrite: (slotId) =>
          runSaveAction(async () => {
            if (!kernel) throw new Error("No simulation is running.");
            const existing = await saveService.listSlots();
            const name = existing.find((slot) => slot.slotId === slotId)?.metadata.name ?? "Save";
            await saveController.save(
              slotId,
              kernel,
              name,
              worldState.serialize(),
              shatterdomeState.serialize(),
              roster.snapshot(),
            );
            return `Overwrote "${name}".`;
          }),
        onLoad: (slotId) =>
          runSaveAction(async () => {
            const result = await saveService.load(slotId);
            if (!kernel) throw new Error("No simulation is running.");
            if (result.document.sim.seed !== kernel.seed) {
              // Restoring needs a kernel built for the save's seed, which means a
              // full reload. Say so rather than silently loading the wrong world.
              return (
                `"${result.document.metadata.name}" uses world seed ${result.document.sim.seed}, ` +
                `but this session is running seed ${kernel.seed}. Reload with ?seed=${result.document.sim.seed} to load it.`
              );
            }
            saveService.applyToKernel(result.document, kernel);
            worldState.restore(result.document.world);
            shatterdomeState.restore(result.document.shatterdome, knownRoomIds);
            // Damage and scars come back with the machines that earned them.
            roster.restore(result.document.roster);
            floatingOrigin.forceRebase(worldState.playerPosition);
            saveController.resetPlayTime(result.document.metadata.playTimeMs);
            const recovered = result.recoveredFrom ? ` (recovered from ${result.recoveredFrom})` : "";
            const migrated =
              result.migratedFrom !== null ? ` (migrated from version ${result.migratedFrom})` : "";
            return `Loaded "${result.document.metadata.name}"${recovered}${migrated}.`;
          }),
        onRename: (slotId, name) =>
          runSaveAction(async () => {
            await saveService.rename(slotId, name);
            return `Renamed to "${name.trim()}".`;
          }),
        onDelete: (slotId) =>
          runSaveAction(async () => {
            await saveService.delete(slotId);
            return "Deleted save.";
          }),
        onExport: (slotId) =>
          runSaveAction(async () => {
            await saveController.download(slotId);
            return "Exported save to a file.";
          }),
        onImport: (file) =>
          runSaveAction(async () => {
            const slotId = `slot.imported.${Date.now().toString(36)}`;
            await saveController.importFile(slotId, file);
            return `Imported "${file.name}".`;
          }),
        onExit: () => stateMachine.transition(savesReturnState),
      },
      savesReturnState === AppState.Shatterdome ? "Back to the Shatterdome" : "Back to Menu",
    );

    await refreshSaves();
  };

  // World state is authoritative and lives for the whole session; the globe view
  // is presentation and is built and torn down with the screen.
  const regionRegistry = createDefaultRegionRegistry();
  const terrainAnchors = createDefaultTerrainAnchors();
  const worldState = new WorldState({
    regions: regionRegistry,
    seed: kernel?.seed ?? 0,
    // Injected as a function so the world layer never imports the content layer.
    climateProfileFor: (climate) => climateRegistry.getOrThrow(climate),
  });
  advanceWorldTime = (ticks) => {
    worldState.advanceEnvironment(ticks);
    // Evacuation moves with world time too, so a city cleared while the player
    // was elsewhere is still cleared when they arrive.
    worldState.advanceAlerts(ticks);
  };
  // The complex is authoritative and session-lived, like the world: it is saved
  // from wherever the player happens to be, not only from inside it.
  const facilityRegistry = createFacilityRegistry();
  const shatterdomeState = new ShatterdomeState(facilityRegistry);
  /** Rooms this build can restore a saved position into. */
  const knownRoomIds = new Set<string>([...FACILITY_KINDS, CONN_POD_ROOM_ID]);

  const floatingOrigin = new FloatingOrigin({ anchor: worldState.playerPosition });
  let globeView: GlobeView | undefined;
  let worldScreen: WorldScreenHandle | undefined;
  let sectorRenderer: SectorRenderer | undefined;
  let streamer: SectorStreamer | undefined;
  let viewMode: WorldViewMode = "globe";
  let routeSamples: readonly RouteSample[] = [];
  let routeRunning = false;
  let routeSeconds = 0;
  let lastReadoutMs = 0;
  let lastVelocity: LocalPosition = { east: 0, north: 0, up: 0 };
  let skyView: SkyView | undefined;
  let weatherView: WeatherView | undefined;
  let ambientAudio: AmbientAudio | undefined;
  let cityView: CityView | undefined;
  let cityRegionId: string | null = null;
  let diving = false;
  /**
   * The piloted machine. All four are built together and torn down together:
   * the session is authoritative, the view draws it, the input source feeds it
   * and the screen reports it.
   */
  let pilotSession: PilotSession | undefined;
  let jaegerView: JaegerView | undefined;
  let pilotInput: PilotInputSource | undefined;
  let pilotScreen: PilotScreenHandle | undefined;
  let lastPilotReadoutMs = 0;
  /**
   * The fight. Built when a target is spawned and torn down with it, so a
   * machine walking around on its own costs nothing at all.
   */
  let combatArena: CombatArena | undefined;
  let combatView: CombatView | undefined;
  let combatAccumulator = 0;
  let combatDebugVolumes = false;
  const combatLog: string[] = [];
  const moveRegistry = createMoveRegistry();
  const kaijuRegistry = createKaijuRegistry();
  const propRegistry = createPropRegistry();
  const weaponRegistry = createWeaponRegistry();
  // The roster is where a machine's damage lives between fights. Nothing is ever
  // removed from it: a machine that loses comes back as work rather than a gap.
  const roster = new Roster();
  /** The ranged row: one key, one weapon, and L reloads whatever is empty. */
  const WEAPON_KEYS: Readonly<Record<string, string>> = {
    Digit7: "weapon.plasma-caster",
    Digit8: "weapon.anti-kaiju-missile",
    Digit9: "weapon.shoulder-mortar",
    Digit0: "weapon.rotary-cannon",
    KeyJ: "weapon.arc-whip",
    KeyK: "weapon.chain-sword",
    KeyO: "weapon.booster-strike",
  };
  /** Props lying around the fight, spawned with the target. */
  let propInstances: PropInstance[] = [];
  let trainingLine = "";
  let moveListOpen = false;
  /** The number row, in order. Slot 5 is the finisher, which is usually refused. */
  const ATTACK_SLOTS: readonly string[] = [
    "melee.light.jab",
    "melee.light.cross",
    "melee.heavy.overhead",
    "melee.launcher.uppercut",
    "melee.guard-break.shoulder",
    "melee.finisher.plasma-drop",
  ];
  /** The melee row: everything the number keys do not cover. */
  const MELEE_KEYS: Readonly<Record<string, string>> = {
    KeyG: "grapple.clinch",
    KeyV: "defense.dodge.step",
    KeyB: "defense.counter.parry",
    KeyN: "env.swing.prop",
  };

  const districtRegistry = createDistrictRegistry();
  const districtsById = new Map<DistrictKind, ReturnType<typeof districtRegistry.getOrThrow>>(
    districtRegistry.all().map((district) => [district.id, district]),
  );

  /**
   * City layouts, built once per region and kept.
   *
   * A layout is a pure function of the region and the seed, so it is cached
   * rather than saved: rebuilding it gives the same city, and keeping it means
   * walking back into Hong Kong does not lay it out again.
   */
  const cityLayouts = new Map<string, CityLayout>();
  const layoutFor = (regionId: string): CityLayout | null => {
    const region = regionRegistry.get(regionId);
    if (!region || region.cityPlanId === null) return null;
    const existing = cityLayouts.get(regionId);
    if (existing) return existing;
    const layout = generateCityLayout({
      regionId: region.id,
      seed: kernel?.seed ?? 0,
      radiusMeters: region.radiusMeters,
      seawardBearingDeg: region.seawardBearingDeg,
      plan: HONG_KONG_DISTRICT_PLAN,
      districts: districtsById,
      maxBlocks: 1_400,
    });
    cityLayouts.set(regionId, layout);
    return layout;
  };

  /**
   * Activity per district for the region the player is in.
   *
   * One sample per district, never per civilian. A district that houses ninety
   * thousand people costs exactly one of these.
   */
  const sampleCityActivity = (layout: CityLayout, sample: EnvironmentSample): Map<string, ActivitySample> => {
    const record = worldState.recordFor(layout.regionId);
    const alert = record?.alert;
    const activity = new Map<string, ActivitySample>();
    if (!alert) return activity;

    for (const districtId of layout.districts) {
      const district = districtsById.get(districtId);
      if (!district) continue;
      activity.set(
        districtId,
        sampleActivity({
          districtId,
          populationDensityThousands: district.populationDensityThousands,
          coastal: district.coastal,
          alert,
          tick: worldState.environment.clock.elapsedTicks,
          dayFraction: sample.dayFraction,
          precipitation: sample.weather.precipitation,
          windSpeedMps: sample.weather.windSpeedMps,
          integrity: record?.integrity ?? 1,
        }),
      );
    }
    return activity;
  };

  /**
   * The one environment sample per frame. Presentation and any future gameplay
   * read the same object, so what is drawn and what is decided cannot disagree.
   */
  const sampleEnvironment = (): EnvironmentSample => {
    const position = worldState.playerPosition;
    const groundHeightMeters = streamer?.sampleGroundHeight(position) ?? 0;
    const field = waveFieldCoordinates(position.latitudeDeg, position.longitudeDeg);
    const preview = worldState.environment.weather.sample(
      worldState.environment.clock.elapsedTicks,
      worldState.environment.clock.dayFraction,
    );
    const waterHeightMeters = sampleWaveHeight({
      east: field.east,
      north: field.north,
      timeSeconds: worldState.environment.clock.elapsedTicks,
      windSpeedMps: preview.windSpeedMps,
      windDirectionDeg: preview.windDirectionDeg,
    });
    return worldState.environment.sample({
      position,
      groundHeightMeters,
      entityHeightMeters: PLAYER_HEIGHT_METERS,
      feetHeightMeters: resolveFeetHeight({
        groundHeightMeters,
        waterHeightMeters,
        entityHeightMeters: PLAYER_HEIGHT_METERS,
        diving,
      }),
    });
  };

  /**
   * Puts a position on the streamed ground when the sector under it is loaded.
   *
   * Returns the position unchanged when nothing is resident, rather than
   * assuming sea level: dropping the player to zero over unloaded terrain would
   * be a worse lie than leaving them where they were.
   */
  const groundedPosition = (position: GeoPosition): GeoPosition => {
    const height = streamer?.sampleGroundHeight(position);
    if (height === undefined || height === null) return position;
    return { ...position, altitudeMeters: Math.max(height, 0) };
  };

  /** Moves the player and keeps the origin, renderer and streamer in step. */
  const movePlayerTo = (position: GeoPosition): void => {
    worldState.moveTo(groundedPosition(position), kernel?.tick ?? 0);
    if (floatingOrigin.update(worldState.playerPosition)) {
      sectorRenderer?.rebase();
      cityView?.rebase();
    }
    streamer?.update({ position: worldState.playerPosition, velocity: lastVelocity });
  };

  const restoreBootStage = (): void => {
    bootScene.jaegerPlaceholder.setEnabled(true);
    bootScene.ground.setEnabled(true);
    bootScene.camera.setTarget(new Vector3(0, 25, 0));
    bootScene.camera.radius = 110;
    bootScene.camera.lowerRadiusLimit = 10;
    bootScene.camera.upperRadiusLimit = 300;
    bootScene.camera.minZ = DEFAULT_CAMERA_MIN_Z;
    bootScene.camera.maxZ = DEFAULT_CAMERA_MAX_Z;
  };

  const closeGlobeView = (): void => {
    globeView?.dispose();
    globeView = undefined;
  };

  const openGlobeView = (): void => {
    globeView = new GlobeView({
      scene: bootScene.scene,
      camera: bootScene.camera,
      world: worldState,
      regions: regionRegistry,
    });
    globeView.frameGlobe();
  };

  /**
   * Tears down streaming. The streamer goes first: disposing it releases every
   * resident sector through the sink, which has to still exist to free them.
   */
  const closeGroundView = (): void => {
    stopPilot();
    routeRunning = false;
    routeSeconds = 0;
    diving = false;
    streamer?.dispose();
    streamer = undefined;
    sectorRenderer?.dispose();
    sectorRenderer = undefined;
    cityView?.dispose();
    cityView = undefined;
    weatherView?.dispose();
    weatherView = undefined;
    // Sky last: it restores the scene's clear colour, fog and sun, so anything
    // still reading them must be gone first.
    skyView?.dispose();
    skyView = undefined;
    ambientAudio?.dispose();
    ambientAudio = undefined;
  };

  const openGroundView = (): void => {
    sectorRenderer = new SectorRenderer({
      scene: bootScene.scene,
      anchor: () => floatingOrigin.anchor,
      quality,
    });
    skyView = new SkyView({
      scene: bootScene.scene,
      sun: bootScene.sun,
      setShadowMapSize: (size) => bootScene.setShadowMapSize(size),
      quality,
    });
    weatherView = new WeatherView({ scene: bootScene.scene, quality });
    rebuildCityView();
    ambientAudio = new AmbientAudio(kernel?.seed ?? 0);
    // Browsers refuse audio outside a user gesture. Entering the ground view is
    // one, so this is the earliest honest place to try.
    void ambientAudio.start();
    streamer = new SectorStreamer({
      service: WorkerTerrainService.create(),
      sink: sectorRenderer,
      // Terrain is a pure function of the world seed, so it reproduces exactly
      // from a save without being stored in one.
      seed: kernel?.seed ?? 0,
      anchors: terrainAnchors,
    });

    // A sector is 11 km across and rings reach four of them out, so the boot
    // scene's 10 km far plane would clip the world away.
    bootScene.camera.minZ = 5;
    bootScene.camera.maxZ = 400_000;
    // Close enough that weather can be seen through rather than fogging the
    // whole view flat. Visibility in a storm is about two kilometres, so a camera
    // seven kilometres back was always looking through more fog than air.
    bootScene.camera.lowerRadiusLimit = 80;
    bootScene.camera.upperRadiusLimit = 60_000;
    bootScene.camera.radius = 900;
    bootScene.camera.beta = 1.05;
    bootScene.camera.setTarget(Vector3.Zero());

    streamer.update({ position: worldState.playerPosition, velocity: lastVelocity });
  };

  /**
   * Builds the city for whichever region the player is standing in, or tears it
   * down when they leave one. Only a region with an authored plan has a city;
   * everywhere else the ground stays as the terrain generator made it.
   */
  const rebuildCityView = (): void => {
    cityView?.dispose();
    cityView = undefined;
    cityRegionId = null;
    if (viewMode !== "ground") return;

    const regionId = worldState.activeRegionId;
    const layout = regionId ? layoutFor(regionId) : null;
    const region = regionId ? regionRegistry.get(regionId) : undefined;
    if (!layout || !region) return;

    cityRegionId = regionId;
    cityView = new CityView({
      scene: bootScene.scene,
      layout,
      regionCentre: region.centre,
      anchor: () => floatingOrigin.anchor,
      // Ground height comes from the streamed collision field through the same
      // call the player uses, so the city stands on the terrain rather than on
      // an assumed plane.
      groundHeightAt: (east, north) => {
        const position = localToGeo(region.centre, { east, north, up: 0 });
        return streamer?.sampleGroundHeight(position) ?? null;
      },
      districts: districtsById,
      quality,
    });
  };

  /**
   * Ground height in the floating-origin local frame.
   *
   * The controller works in local metres and the streamer answers in geodetic,
   * so this is the one place the two meet. Returning null rather than zero where
   * nothing is loaded matters: a machine told the ground is at sea level over an
   * unloaded sector would step off a cliff that is not there.
   */
  const localGroundHeight = (east: number, north: number): number | null => {
    const position = floatingOrigin.toGeo({ east, north, up: 0 });
    return streamer?.sampleGroundHeight(position) ?? null;
  };

  /**
   * Writes the fight back onto the machine.
   *
   * This is what makes damage outlive the fight: the arena's zones are the
   * machine's components, so what the fight did to them is what the roster
   * carries away from it.
   */
  const recordDamage = (): string | null => {
    const arena = combatArena;
    const session = pilotSession;
    if (!arena || !session) return null;
    const record = roster.get(session.jaeger.id);
    if (!record) return null;
    const view = arena.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
    if (!view) return null;
    for (const zone of view.zones) {
      const component = record.damage.components.find((entry) => entry.componentId === zone.id);
      if (component) component.health = Math.max(0, Math.min(component.maxHealth, zone.health));
    }
    record.damage.lostStructure = record.damage.components.reduce(
      (total, entry) => total + (entry.maxHealth - entry.health),
      0,
    );
    return roster.recover(session.jaeger.id).message;
  };

  const clearTarget = (): void => {
    // The machine keeps what the fight did to it.
    const recovery = recordDamage();
    if (recovery) pushCombatLine(recovery);
    // Nothing survives the fight it was fired in, so the pool is emptied while
    // the arena that owns it still exists.
    combatArena?.projectilePool().clear();
    combatView?.dispose();
    combatView = undefined;
    combatArena = undefined;
    combatAccumulator = 0;
    combatLog.length = 0;
    propInstances = [];
    trainingLine = "";
    refreshPilot();
  };

  /**
   * Puts a kaiju in front of the machine and starts a fight.
   *
   * The arena is authoritative and knows nothing about the scene; the view draws
   * what it reports. Both fighters run the same resolver, which is the whole
   * point of the framework.
   */
  const spawnTarget = (): void => {
    const session = pilotSession;
    if (!session) return;
    clearTarget();

    const kaiju = kaijuRegistry.getOrThrow("kaiju.biped-alpha");
    const pose = session.pose;
    const yaw = (pose.yawDeg * Math.PI) / 180;
    // A hundred and twenty metres ahead: outside every move's reach, so the
    // player has to close the distance rather than starting inside a swing.
    const east = pose.east + Math.sin(yaw) * 120;
    const north = pose.north + Math.cos(yaw) * 120;

    combatArena = new CombatArena({
      moves: moveRegistry,
      space: spaceQuery(),
      seed: kernel?.seed ?? 0,
      // The pool is the quality preset's, so a barrage refuses rather than
      // costing frames on a machine that cannot afford it.
      projectileCapacity: quality.maxProjectiles,
      groundHeight: localGroundHeight,
      fighters: [
        {
          id: "jaeger",
          kind: "jaeger",
          displayName: session.jaeger.name,
          heightMeters: session.jaeger.locomotion.heightMeters,
          profile: combatProfileFor(session.jaeger),
          pose: { east: pose.east, north: pose.north, up: pose.up, yawDeg: pose.yawDeg },
          // The machine walks into the fight carrying what it walked out with.
          zones: jaegerZones(session.jaeger, roster.get(session.jaeger.id)?.damage),
          layout: jaegerLayout(session.jaeger),
          finisherThreshold: 0.2,
        },
        {
          id: "kaiju",
          kind: "kaiju",
          displayName: kaiju.name,
          heightMeters: kaiju.heightMeters,
          profile: kaijuCombatProfile(kaiju),
          pose: { east, north, up: pose.up, yawDeg: pose.yawDeg + 180 },
          zones: kaijuZones(kaiju),
          kaiju,
          finisherThreshold: kaiju.finisherThreshold,
        },
      ],
    });

    combatView = new CombatView({
      scene: bootScene.scene,
      quality,
      resolver: assetResolver,
      assets: assetRegistry,
      kaiju,
      groundHeightAt: localGroundHeight,
    });
    combatView.setDebugVolumes(combatDebugVolumes);

    // The machine carries everything for now; loadouts are a later milestone.
    for (const weapon of weaponRegistry.all()) combatArena.equipWeapon("jaeger", weapon);

    // Something to pick up. Placed to the side of the fight rather than under
    // it, so reaching one is a decision rather than an accident.
    propInstances = propRegistry
      .all()
      .slice(0, 3)
      .map((prop, index) => {
        const angle = (index * 120 * Math.PI) / 180;
        return spawnProp(
          `prop.${index}`,
          prop,
          pose.east + Math.sin(angle) * 90,
          pose.north + Math.cos(angle) * 90,
        );
      });

    session.lockTarget("kaiju");
    refreshPilot();
  };

  /**
   * Picks up the nearest prop, or drops the one in hand.
   *
   * Refusals come back as words, the same way every other refusal does.
   */
  const toggleProp = (): void => {
    const arena = combatArena;
    const session = pilotSession;
    if (!arena || !session) return;
    const view = arena.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
    if (view?.wieldingPropId) {
      arena.dropProp("jaeger");
      pushCombatLine("Dropped it.");
      return;
    }
    let best: { instance: PropInstance; distance: number } | null = null;
    for (const instance of propInstances) {
      if (instance.heldBy !== null) continue;
      const distance = Math.hypot(instance.east - session.pose.east, instance.north - session.pose.north);
      if (!best || distance < best.distance) best = { instance, distance };
    }
    if (!best) {
      pushCombatLine("Nothing here to pick up.");
      return;
    }
    const definition = propRegistry.getOrThrow(best.instance.propId);
    const result = arena.takeProp("jaeger", definition, best.instance, best.distance);
    pushCombatLine(result.ok ? `Picked up the ${definition.displayName.toLowerCase()}.` : result.message);
  };

  /**
   * The ranged row.
   *
   * Every refusal is a sentence in the log, because a weapon that quietly does
   * nothing is indistinguishable from a broken one.
   */
  const pressWeapon = (code: string): void => {
    const arena = combatArena;
    if (!arena) return;
    if (code === "KeyL") {
      // Reload whatever is emptiest and can still be filled.
      const view = arena.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
      const empty = (view?.weapons ?? [])
        .filter((weapon) => weapon.magazineSize > 0 && weapon.magazine < weapon.magazineSize)
        .sort((a, b) => a.magazine - b.magazine)[0];
      if (!empty) {
        pushCombatLine("Nothing needs reloading.");
        return;
      }
      const outcome = arena.reloadWeapon("jaeger", empty.id);
      pushCombatLine(outcome.ok ? `Reloading the ${empty.displayName.toLowerCase()}.` : outcome.message);
      if (!outcome.ok) trainingLine = outcome.message;
      return;
    }

    const weaponId = WEAPON_KEYS[code];
    if (!weaponId) return;
    const outcome = arena.fireWeapon("jaeger", weaponId);
    if (!outcome.ok) {
      pushCombatLine(`refused: ${outcome.message}`);
      trainingLine = outcome.message;
    }
  };

  /** The melee row: grapple, dodge, parry and a prop swing. */
  const pressMelee = (code: string): void => {
    const arena = combatArena;
    if (!arena) return;
    if (code === "KeyP") {
      toggleProp();
      return;
    }
    const moveId = MELEE_KEYS[code];
    if (!moveId) return;
    const request = arena.request("jaeger", moveId);
    if (!request.ok) {
      pushCombatLine(`refused: ${request.message}`);
      trainingLine = request.message;
      return;
    }
    arena.press("jaeger", moveId);
  };

  /**
   * Directional variants of the heavy attack.
   *
   * The same button with a different answer depending on which way the machine
   * is being pushed, which is how the moveset stays deep without the move list
   * turning into a keyboard diagram.
   */
  const HEAVY_VARIANTS: Readonly<Record<string, string>> = {
    forward: "melee.heavy.smash.forward",
    side: "melee.heavy.spin.side",
  };

  /** Presses an attack. The arena decides whether it is legal, and says why not. */
  const pressAttack = (slot: number): void => {
    let moveId = ATTACK_SLOTS[slot];
    // Slot three is the heavy, and the heavy is the one with directions on it.
    if (moveId === "melee.heavy.overhead" && pilotInput) {
      moveId = HEAVY_VARIANTS[pilotInput.moveDirection] ?? moveId;
    }
    if (!moveId || !combatArena) return;
    const request = combatArena.request("jaeger", moveId);
    if (!request.ok) {
      // Refusals are shown rather than swallowed: this is the debug view the
      // milestone asks for, and it is the only way a player learns the rules.
      pushCombatLine(`refused: ${request.message}`);
      return;
    }
    combatArena.press("jaeger", moveId);
  };

  const pushCombatLine = (line: string): void => {
    combatLog.unshift(line);
    while (combatLog.length > 6) combatLog.pop();
  };

  /** Turns arena events into the log line the panel shows and the effects the world plays. */
  const consumeCombatEvents = (events: readonly CombatEvent[]): void => {
    for (const event of events) {
      if (event.type === "hit" || event.type === "guarded") {
        pushCombatLine(
          `t${event.tick} ${event.actorId} ${event.moveId ?? ""} · ${event.volumeId ?? ""} → ` +
            `${event.zoneId ?? ""} ${event.damage} dmg${event.reaction && event.reaction !== "none" ? ` · ${event.reaction}` : ""}`,
        );
      }
      // A blow heavy enough to leave a mark leaves one, on the component it
      // landed on. The mark is four numbers; the view grows the debris from it.
      if ((event.type === "hit" || event.type === "zone-destroyed") && event.targetId === "jaeger") {
        const session = pilotSession;
        const record = session ? roster.get(session.jaeger.id) : undefined;
        const component = record?.damage.components.find((entry) => entry.componentId === event.zoneId);
        if (record && component && component.maxHealth > 0) {
          recordScar(
            record.damage,
            component.componentId,
            event.damage / component.maxHealth,
            event.damageKind ?? "impact",
            event.tick * 2_654_435_761,
          );
        }
      }
      if (event.type === "zone-destroyed") {
        pushCombatLine(`t${event.tick} ${event.actorId} lost ${event.zoneId ?? ""} (${event.reason ?? ""})`);
      } else if (event.type === "defeated") {
        pushCombatLine(`t${event.tick} ${event.actorId} is down`);
      } else if (
        event.type === "weapon-fired" ||
        event.type === "weapon-dry" ||
        event.type === "weapon-reloaded" ||
        event.type === "projectile-refused" ||
        event.type === "status-applied"
      ) {
        // Coaching is for what a player should do about it. A shot going off as
        // asked is not advice, so only the awkward ones reach that line.
        if (event.reason && event.type !== "weapon-fired") trainingLine = event.reason;
        // Weapons speak in sentences, the same as everything else in this log.
        pushCombatLine(`t${event.tick} ${event.reason ?? event.type}`);
      } else if (event.type === "whiffed") {
        // A miss is feedback too, and it is the difference between "that did not
        // work" and "nothing happened".
        pushCombatLine(`t${event.tick} missed with ${event.moveId ?? ""}`);
      } else if (event.type === "attack-rejected") {
        pushCombatLine(`t${event.tick} refused: ${event.reason ?? ""}`);
      } else if (
        event.type === "evaded" ||
        event.type === "perfect-guard" ||
        event.type === "parried" ||
        event.type === "grapple-started" ||
        event.type === "grapple-ended" ||
        event.type === "finisher-started" ||
        event.type === "finisher-ended" ||
        event.type === "prop-taken" ||
        event.type === "prop-broken" ||
        event.type === "combo"
      ) {
        // The coaching line is the one piece of the log written for the player
        // rather than for a developer, so it takes the reason and nothing else.
        if (event.reason) trainingLine = event.reason;
        pushCombatLine(`t${event.tick} ${event.type}: ${event.reason ?? ""}`);
      }

      // A reaction on the machine is felt rather than only logged: locomotion
      // already knows how to be knocked back and knocked over.
      if (event.type === "reaction" && event.actorId === "jaeger" && pilotSession) {
        if (event.reaction === "knockdown" || event.reaction === "launch") {
          pilotSession.react({ kind: "knockdown", impulseMps: 12 });
        } else if (event.reaction === "stagger" || event.reaction === "guard-break") {
          pilotSession.react({ kind: "knockback", impulseMps: 8 });
        }
      }
    }
  };

  const combatState = (): PilotCombatState | null => {
    if (!combatArena || !pilotSession) return null;
    const snapshot = combatArena.snapshot();
    const kaijuView = snapshot.fighters.find((fighter) => fighter.id === "kaiju");
    const jaegerView = snapshot.fighters.find((fighter) => fighter.id === "jaeger");
    if (!kaijuView || !jaegerView) return null;
    const pose = pilotSession.pose;
    return {
      targetName: kaijuView.displayName,
      targetDistanceMeters: Math.hypot(kaijuView.east - pose.east, kaijuView.north - pose.north),
      lockedOn: pilotSession.camera.lockedTargetId !== null,
      aimZoneId: jaegerView.aimZoneId,
      zones: kaijuView.zones.map((zone) => ({
        id: zone.id,
        health: zone.health,
        maxHealth: zone.maxHealth,
      })),
      stamina: jaegerView.stamina,
      staminaMax: combatProfileFor(pilotSession.jaeger).staminaMax,
      heat: jaegerView.heat,
      overheated: jaegerView.overheated,
      poise: jaegerView.poise,
      guarding: jaegerView.guarding,
      activeMove: jaegerView.activeMove,
      activePhase: jaegerView.activePhase,
      buffered: jaegerView.buffered,
      finisherOpen: kaijuView.finisherOpen,
      defeated: kaijuView.defeated,
      hitLog: [...combatLog],
      debugVolumes: combatDebugVolumes,
      // While the list is open the coaching line explains where the list comes
      // from, which is the one thing a move list cannot say about itself.
      training: moveListOpen ? "Every move here is read from the game's own move table." : trainingLine,
      comboHits: jaegerView.comboHits,
      bestCombo: jaegerView.bestCombo,
      chargeProgress: jaegerView.chargeProgress,
      grapplePhase: jaegerView.grapplePhase,
      grappleStruggle: jaegerView.grappleStruggle,
      finisherPhase: jaegerView.finisherPhase,
      holdingProp: jaegerView.wieldingPropId,
      propSwingsLeft: jaegerView.wieldingSwingsLeft,
      weapons: jaegerView.weapons.map((weapon) => ({
        id: weapon.id,
        displayName: weapon.displayName,
        magazine: weapon.magazine,
        magazineSize: weapon.magazineSize,
        feed: weapon.feed,
        reserve: weapon.reserve,
        ready: weapon.cooldownTicksLeft === 0 && weapon.reloadTicksLeft === 0,
        reloading: weapon.reloadTicksLeft > 0,
        channelling: weapon.channelling,
      })),
      targetStatuses: kaijuView.statuses.map((status) => status.statusId.replace("status.", "")),
      liveProjectiles: combatArena.projectilePool().live,
      projectileCapacity: combatArena.projectilePool().capacity,
    };
  };

  /**
   * Where a machine may legally stand, answered from the world that is actually
   * loaded.
   *
   * City blocks are solid, unloaded ground is off limits, and deep water is not
   * somewhere a finisher happens. The block scan is linear over the region's own
   * layout, which is fine because it is asked a handful of times a second by
   * grapples and finishers rather than every frame; if that ever changes it wants
   * a grid rather than a loop.
   */
  const spaceQuery = (): SpaceQuery => ({
    isClear: (east, north, radiusMeters) => {
      const regionId = worldState.activeRegionId;
      const layout = regionId ? cityLayouts.get(regionId) : null;
      const region = regionId ? regionRegistry.get(regionId) : undefined;
      if (!layout || !region) return true;
      const position = floatingOrigin.toGeo({ east, north, up: 0 });
      const local = geoToLocal(region.centre, position);
      for (const block of layout.blocks) {
        const reach = radiusMeters + Math.max(block.widthMeters, block.depthMeters) * 0.5;
        if (Math.abs(block.east - local.east) > reach) continue;
        if (Math.abs(block.north - local.north) > reach) continue;
        return false;
      }
      return true;
    },
    inLoadedWorld: (east, north) => {
      const position = floatingOrigin.toGeo({ east, north, up: 0 });
      return streamer?.sampleGroundHeight(position) !== null && streamer !== undefined;
    },
    waterDepthMeters: (east, north) => {
      const position = floatingOrigin.toGeo({ east, north, up: 0 });
      const ground = streamer?.sampleGroundHeight(position) ?? 0;
      const sample = sampleEnvironment();
      return Math.max(0, sample.waveHeightMeters - ground);
    },
  });

  const stopPilot = (): void => {
    clearTarget();
    pilotInput?.dispose();
    pilotInput = undefined;
    // The view goes before the screen: disposing it puts the previous camera
    // back, and the panel that reports the camera must outlive that.
    jaegerView?.dispose();
    jaegerView = undefined;
    pilotScreen?.dispose();
    pilotScreen = undefined;
    pilotSession = undefined;
    sectorRenderer?.setPlayerMarkerVisible(true);
    // Hand the orbit camera back the way the world view left it.
    if (viewMode === "ground") {
      bootScene.camera.setTarget(Vector3.Zero());
      bootScene.scene.activeCamera = bootScene.camera;
    }
    refreshWorld();
  };

  /** Why the machine on the world panel cannot go out, or null when it can. */
  let pilotNotice: string | null = null;

  const startPilot = (jaegerId: string): void => {
    if (viewMode !== "ground") return;
    const jaeger = jaegerRegistry.get(jaegerId) ?? jaegerRegistry.all()[0];
    if (!jaeger) return;
    // A machine that is being rebuilt, towed, or missing something critical does
    // not go out. The refusal is a sentence, the same as everywhere else.
    const fitness = roster.canDeploy(jaeger.id);
    if (!fitness.ok) {
      pilotNotice = fitness.message;
      refreshWorld();
      return;
    }
    stopPilot();
    pilotNotice = null;

    const local = floatingOrigin.toLocal(worldState.playerPosition);
    const ground = localGroundHeight(local.east, local.north);
    const record = roster.get(jaeger.id);
    const penalty = record
      ? mobilityPenalty(record.damage, roster.componentRegistry())
      : { speedScale: 1, turnScale: 1, meleeScale: 1, summary: "all systems answering" };
    // Damage changes how it walks by changing the numbers the shared controller
    // reads, rather than by adding a second controller for damaged machines.
    const damagedJaeger: typeof jaeger = {
      ...jaeger,
      locomotion: {
        ...jaeger.locomotion,
        walkSpeedMps: jaeger.locomotion.walkSpeedMps * penalty.speedScale,
        runSpeedMps: jaeger.locomotion.runSpeedMps * penalty.speedScale,
        strafeSpeedMps: jaeger.locomotion.strafeSpeedMps * penalty.speedScale,
        turnRateDegPerSecond: jaeger.locomotion.turnRateDegPerSecond * penalty.turnScale,
        turnInPlaceRateDegPerSecond: jaeger.locomotion.turnInPlaceRateDegPerSecond * penalty.turnScale,
      },
    };
    roster.deploy(jaeger.id);
    pilotSession = new PilotSession({
      jaeger: damagedJaeger,
      east: local.east,
      north: local.north,
      // Stand on the terrain if it is loaded, and on the last known altitude if
      // it is not, rather than dropping the machine to sea level.
      up: ground ?? worldState.playerPosition.altitudeMeters,
      headingDeg: 0,
    });

    jaegerView = new JaegerView({
      scene: bootScene.scene,
      quality,
      resolver: assetResolver,
      assets: assetRegistry,
      jaeger,
      groundHeightAt: localGroundHeight,
      audio: ambientAudio ?? null,
    });

    pilotInput = new PilotInputSource(canvas, {
      onCameraCycle: () => {
        pilotSession?.cycleCamera();
        refreshPilot();
      },
      onLockToggle: () => {
        // Nothing to lock on to yet: targets arrive with the combat milestone.
        // The control exists because the camera already carries the lock, and it
        // reports honestly that there is nothing out there.
        pilotSession?.lockTarget(pilotSession.camera.lockedTargetId === null ? "none-in-range" : null);
        refreshPilot();
      },
      onBooster: () => pilotSession?.press("booster", kernel?.tick ?? 0),
      onReducedMotionToggle: () => {
        const reduced = !(pilotSession?.comfort.reducedMotion ?? false);
        pilotSession?.setComfort({ reducedMotion: reduced });
        refreshPilot();
      },
      onExit: stopPilot,
      onAttack: pressAttack,
      onMelee: pressMelee,
      onWeapon: pressWeapon,
      onWeaponRelease: (code: string) => {
        // Sustained weapons stop when the key comes up; everything else ignores it.
        if (WEAPON_KEYS[code] === "weapon.chain-sword") combatArena?.releaseWeapon("jaeger");
      },
      onChargeStart: () => combatArena?.beginCharge("jaeger", "melee.charge.haymaker"),
      onChargeRelease: () => {
        const outcome = combatArena?.releaseCharge("jaeger");
        if (outcome && !outcome.ok) pushCombatLine(`refused: ${outcome.message}`);
      },
      onFinisherHold: (holding: boolean) => combatArena?.setFinisherHold("jaeger", holding),
      onAimModeToggle: () => {
        if (!combatArena) return;
        const current = combatArena.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
        // Aim mode cycles through the zones the creature actually has, so what
        // it offers can never disagree with what is there to hit.
        const kaiju = kaijuRegistry.getOrThrow("kaiju.biped-alpha");
        const ids: string[] = kaiju.zones.map((zone) => zone.id);
        const index = current?.aimZoneId ? ids.indexOf(current.aimZoneId) : -1;
        const next = index + 1 >= ids.length ? null : (ids[index + 1] ?? null);
        combatArena.setAim("jaeger", next);
        refreshPilot();
      },
    });

    pilotScreen = renderPilotScreen(
      uiRoot,
      jaegerRegistry
        .all()
        .map((entry) => ({ id: entry.id, label: `${entry.name} (${entry.markDesignation})` })),
      buildMoveList(),
      {
        onCameraMode: (mode: CameraMode) => {
          pilotSession?.setCameraMode(mode);
          refreshPilot();
        },
        onShakeScale: (value: number) => {
          pilotSession?.setComfort({ shakeScale: value });
          refreshPilot();
        },
        onReducedMotion: (value: boolean) => {
          pilotSession?.setComfort({ reducedMotion: value });
          refreshPilot();
        },
        onInvertPitch: (value: boolean) => {
          pilotSession?.setComfort({ invertPitch: value });
          refreshPilot();
        },
        onLockToggle: () => {
          pilotSession?.lockTarget(pilotSession.camera.lockedTargetId === null ? "none-in-range" : null);
          refreshPilot();
        },
        onSwitchJaeger: (id: string) => startPilot(id),
        onSpawnTarget: spawnTarget,
        onClearTarget: clearTarget,
        onMoveList: (open: boolean) => {
          moveListOpen = open;
        },
        onHoldToComplete: (enabled: boolean) => {
          combatArena?.setFinisherSettings("jaeger", { holdToComplete: enabled });
        },
        onSkipSequences: (enabled: boolean) => {
          combatArena?.setFinisherSettings("jaeger", { skipSequences: enabled });
        },
        onDebugVolumes: (enabled: boolean) => {
          combatDebugVolumes = enabled;
          combatView?.setDebugVolumes(enabled);
          refreshPilot();
        },
        onExit: stopPilot,
      },
    );

    // The machine is the player now; the streamer's stand-in marker would stand
    // in the same spot and hide it.
    sectorRenderer?.setPlayerMarkerVisible(false);
    refreshPilot();
  };

  /**
   * The move list, written from the move table.
   *
   * Speed is a word rather than a tick count, and the input is the key the
   * player actually presses, so nothing in the interface leaks the numbers
   * underneath it.
   */
  const buildMoveList = (): MoveListEntry[] => {
    const inputs = new Map<string, string>();
    ATTACK_SLOTS.forEach((moveId, index) => inputs.set(moveId, `press ${index + 1}`));
    for (const [code, moveId] of Object.entries(MELEE_KEYS)) {
      inputs.set(moveId, `press ${code.replace("Key", "")}`);
    }
    inputs.set("melee.charge.haymaker", "hold H, release to swing");
    inputs.set("melee.heavy.smash.forward", "hold forward, press 3");
    inputs.set("melee.heavy.spin.side", "hold sideways, press 3");

    const groupFor = (move: MoveDefinition): string => {
      if (move.defense) return "Defence";
      if (move.grapple) return "Grapples";
      if (move.finisher) return "Finishers";
      if (move.requiresPropTag) return "Environment";
      if (move.id.startsWith("kaiju.")) return "What it does to you";
      return "Attacks";
    };
    const speedFor = (move: MoveDefinition): string => {
      const total = moveLengthTicks(move);
      if (total <= 24) return "fast";
      if (total <= 48) return "steady";
      return "slow, and worth committing to";
    };

    return moveRegistry
      .all()
      .map((move) => ({
        id: move.id,
        displayName: move.displayName,
        group: groupFor(move),
        input: inputs.get(move.id) ?? "not bound",
        coaching: move.coaching,
        speed: speedFor(move),
      }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.displayName.localeCompare(b.displayName));
  };

  /**
   * What the machine is carrying, for the panel.
   *
   * Read live from the arena while a fight is running, so a leg going out shows
   * up the moment it happens rather than when the pilot walks home.
   */
  const pilotDamageState = (): PilotDamageState | null => {
    const session = pilotSession;
    const record = session ? roster.get(session.jaeger.id) : undefined;
    if (!session || !record) return null;
    const components = roster.componentRegistry();
    const live = combatArena?.snapshot().fighters.find((fighter) => fighter.id === "jaeger");
    const entries = record.damage.components.map((entry) => {
      const zone = live?.zones.find((candidate) => candidate.id === entry.componentId);
      const health = zone ? zone.health : entry.health;
      const max = zone ? zone.maxHealth : entry.maxHealth;
      return { componentId: entry.componentId, health, maxHealth: max, shock: 0 };
    });
    const integrity =
      entries.reduce((total, entry) => total + entry.maxHealth, 0) === 0
        ? 0
        : entries.reduce((total, entry) => total + entry.health, 0) /
          entries.reduce((total, entry) => total + entry.maxHealth, 0);
    const view = { ...record.damage, components: entries };
    return {
      integrityPercent: Math.round(integrity * 100),
      components: entries.map((entry) => ({
        name: components.get(entry.componentId)?.displayName ?? entry.componentId,
        state: componentState(entry),
        percent: Math.round(componentFraction(entry) * 100),
      })),
      offline: disabledSystems(view, components).map((system) => system.replace(".", " ")),
      scars: record.damage.scars.length,
      mobility: mobilityPenalty(view, components).summary,
    };
  };

  /** Pushes the machine's own numbers at the panel. Throttled like every other readout. */
  const refreshPilot = (): void => {
    if (!pilotScreen || !pilotSession) return;
    const stats = jaegerView?.stats();
    // The machine wears what it is carrying: marks come from the record, placed
    // on the component that earned them.
    const marks = pilotSession ? (roster.get(pilotSession.jaeger.id)?.damage.scars ?? []) : [];
    const componentsRegistry = roster.componentRegistry();
    jaegerView?.updateDamage(
      marks.map((scar) => {
        const component = componentsRegistry.get(scar.componentId);
        return {
          heightFraction: component?.heightFraction ?? 0.6,
          lateralFraction: component?.lateralFraction ?? 0,
          forwardFraction: component?.forwardFraction ?? 0,
          severity: scar.severity,
          seed: scar.seed,
        };
      }),
    );
    pilotScreen.update({
      readout: pilotSession.readout(),
      damage: pilotDamageState(),
      view: stats
        ? {
            decals: stats.decals,
            decalCapacity: stats.decalCapacity,
            scaleReferences: stats.scaleReferences,
            dustParticles: stats.dustParticles,
            modelResolved: stats.modelResolved,
            soundDelaySeconds: JaegerView.soundDelaySeconds(stats.pendingSoundMeters),
          }
        : null,
      groundHeightMeters: localGroundHeight(pilotSession.pose.east, pilotSession.pose.north),
      headingErrorDeg: lastPilotHeadingError,
      blocked: lastPilotBlocked,
      combat: combatState(),
    });
  };

  let lastPilotHeadingError = 0;
  let lastPilotBlocked = false;

  /**
   * One frame of piloting.
   *
   * The machine moves in the local frame, the world state follows it so streaming
   * and the environment stay centred on where the player actually is, and a rebase
   * moves the machine into the new frame rather than teleporting it.
   */
  const advancePilot = (deltaSeconds: number): void => {
    const session = pilotSession;
    if (!session || !pilotInput) return;

    const cameraInput = pilotInput.sampleCamera(deltaSeconds);
    const input = pilotInput.sample(session.camera.yawDeg, deltaSeconds, session.camera.mode !== "cockpit");
    // Guarding is one idea with two consumers: it slows the machine down and it
    // is what the arena checks when a hit lands.
    combatArena?.setGuard("jaeger", input.guard);
    // Holding guard is a block; tapping it at the right moment is a perfect one,
    // which the block move is what provides.
    combatArena?.setFinisherHold("jaeger", input.guard || pilotInput?.finisherHeld === true);
    const sample = sampleEnvironment();

    const frame = session.update({
      deltaSeconds,
      tick: kernel?.tick ?? 0,
      input,
      cameraInput,
      ground: localGroundHeight,
      waterHeightMeters: sample.waveHeightMeters,
      // Grip and pace come from the environment the rest of the world already
      // reads, never from a second set of numbers invented here.
      effects: sample.effects,
      obstruction: (distance) =>
        jaegerView?.obstructionAt(session.pose, session.camera.yawDeg, distance) ?? null,
      // What the camera frames while a lock is held. Null when nothing is out
      // there, which is why the lock reports honestly rather than swinging to
      // an imaginary target.
      targetPosition: lastTargetPosition,
    });
    lastPilotHeadingError = frame.headingErrorDeg;
    lastPilotBlocked = frame.blocked;

    jaegerView?.update(frame.pose, frame.placement, frame.events, deltaSeconds, frame.camera.mode);

    if (combatArena) advanceCombat(session, frame.pose, deltaSeconds);

    // The player is wherever the machine is: streaming, weather and the city all
    // follow the machine once it is being driven.
    const geo = floatingOrigin.toGeo({
      east: frame.pose.east,
      north: frame.pose.north,
      up: frame.pose.up,
    });
    worldState.moveTo({ ...geo, altitudeMeters: frame.pose.up }, kernel?.tick ?? 0);
    lastVelocity = { east: frame.pose.velocityEast, north: frame.pose.velocityNorth, up: 0 };
    if (floatingOrigin.update(worldState.playerPosition)) {
      sectorRenderer?.rebase();
      cityView?.rebase();
      const rebased = floatingOrigin.toLocal(worldState.playerPosition);
      session.rebase(rebased.east, rebased.north, frame.pose.up);
    }
  };

  /**
   * Runs the fight alongside the machine.
   *
   * Combat has its own fixed tick, so frames are accumulated into whole ticks
   * rather than the resolver being handed a variable delta. The machine's pose
   * is pushed in before the tick and the target's is read back after, which
   * keeps one authority over each: locomotion owns where the Jaeger is, the
   * arena owns everything about the fight.
   */
  const advanceCombat = (
    session: PilotSession,
    pose: { east: number; north: number; up: number; yawDeg: number },
    deltaSeconds: number,
  ): void => {
    const arena = combatArena;
    if (!arena) return;

    arena.moveTo("jaeger", { east: pose.east, north: pose.north, up: pose.up, yawDeg: pose.yawDeg });

    combatAccumulator += deltaSeconds;
    const events: CombatEvent[] = [];
    // Capped so a stalled frame cannot run a second of combat at once.
    let budget = 8;
    while (combatAccumulator >= COMBAT_TICK_SECONDS && budget > 0) {
      combatAccumulator -= COMBAT_TICK_SECONDS;
      budget -= 1;
      // The creature keeps turning to face the machine and throws what it can,
      // on a fixed cadence. This is a schedule rather than behaviour, and the
      // panel says so.
      arena.faceToward("kaiju", "jaeger", 1.2);
      if (arena.tick % 240 === 0) {
        arena.press("kaiju", arena.tick % 480 === 0 ? "kaiju.claw.swipe" : "kaiju.tail.sweep");
      }
      arena.step();
    }
    // Drained rather than collected from the steps: a trigger pulled between
    // two ticks is still something that happened.
    events.push(...arena.drain());
    consumeCombatEvents(events);

    const snapshot = arena.snapshot();
    const kaijuView = snapshot.fighters.find((fighter) => fighter.id === "kaiju");
    if (kaijuView && combatView) {
      combatView.update(kaijuView, events, deltaSeconds);
      // Draw exactly what is live, and nothing that is not.
      combatView.updateProjectiles(
        arena
          .projectilePool()
          .active()
          .map((round) => ({ east: round.east, north: round.north, up: round.up })),
      );
    }
    // The camera frames the creature while a lock is held.
    if (kaijuView) lastTargetPosition = { east: kaijuView.east, north: kaijuView.north, up: pose.up };
    void session;
  };

  let lastTargetPosition: { east: number; north: number; up: number } | null = null;

  const closeWorld = (): void => {
    frameHook = null;
    closeGroundView();
    closeGlobeView();
    worldScreen?.dispose();
    worldScreen = undefined;
    viewMode = "globe";
    restoreBootStage();
  };

  const refreshWorld = (): void => {
    if (!worldScreen) return;
    const environmentSample = sampleEnvironment();
    const local = floatingOrigin.toLocal(worldState.playerPosition);
    const activeRegion = worldState.activeRegionId;
    const records = worldState.records();

    worldScreen.update({
      viewMode,
      environment: environmentReadout(environmentSample),
      city: cityReadout(environmentSample),
      streaming: streamer && sectorRenderer ? streamingReadout(streamer, sectorRenderer) : null,
      position: worldState.playerPosition,
      localEast: local.east,
      localNorth: local.north,
      sectorId: worldState.activeSectorId,
      neighborIds: neighborIds(worldState.activeSectorId),
      activeRegionId: activeRegion,
      activeClimate: activeRegion ? (worldState.definitionFor(activeRegion)?.climate ?? null) : null,
      activeRegions: records.filter((record) => record.tier === "active").length,
      strategicRegions: records.filter((record) => record.tier === "strategic").length,
      rebases: floatingOrigin.rebases,
      anchor: floatingOrigin.anchor,
      pilotNotice,
    });
    globeView?.refresh();
  };

  /**
   * Flattens the city for the panel.
   *
   * Returns null outside a region with a layout, because there is genuinely no
   * city there: showing zeroes would imply one that has not been built.
   */
  const cityReadout = (sample: EnvironmentSample): CityReadout | null => {
    const regionId = worldState.activeRegionId;
    const layout = regionId ? (cityLayouts.get(regionId) ?? layoutFor(regionId)) : null;
    const record = regionId ? worldState.recordFor(regionId) : undefined;
    if (!layout || !record) return null;

    const activity = sampleCityActivity(layout, sample);
    let civilian = 0;
    let vehicle = 0;
    let shipping = 0;
    let military = 0;
    let flow = 0;
    let sirens = false;
    for (const entry of activity.values()) {
      civilian += entry.civilianDensity;
      vehicle += entry.vehicleDensity;
      shipping += entry.shippingDensity;
      military += entry.militaryDensity;
      flow += entry.evacuationFlow;
      sirens = sirens || entry.sirens;
    }
    const count = Math.max(1, activity.size);
    const view = cityView?.stats();

    return {
      regionId: layout.regionId,
      districtCount: layout.districts.length,
      blockCount: layout.stats.blockCount,
      towerCount: layout.stats.towerCount,
      landmarkCount: layout.stats.landmarkCount,
      roadCount: layout.stats.roadCount,
      harborLaneCount: layout.stats.harborLaneCount,
      defenseCount: layout.stats.defenseCount,
      destructionGroupCount: layout.stats.destructionGroupCount,
      evacuationCapacityThousands: layout.stats.evacuationCapacityThousands,
      routeCount: layout.routes.length,
      alertLevel: record.alert.level,
      evacuationProgress: record.alert.evacuationProgress,
      civilianDensity: civilian / count,
      vehicleDensity: vehicle / count,
      shippingDensity: shipping / count,
      militaryDensity: military / count,
      evacuationFlow: flow / count,
      sirens,
      drawnBlocks: view?.drawnBlocks ?? 0,
      residentGroups: view?.residentGroups ?? 0,
      totalGroups: view?.totalGroups ?? layout.stats.destructionGroupCount,
      agents: view?.agents ?? 0,
      agentCapacity: view?.agentCapacity ?? 0,
      agentsByKind: view?.agentsByKind ?? {},
      rendered: view !== undefined,
      cityMeshes: view?.meshes ?? 0,
      cityGpuBytes: view?.estimatedGpuBytes ?? 0,
    };
  };

  /** Flattens the environment sample for the panel. Every figure is read back, not requested. */
  const environmentReadout = (sample: EnvironmentSample): EnvironmentReadout => {
    const weatherStats = weatherView?.stats();
    return {
      dayNumber: sample.dayNumber,
      timeOfDay: sample.timeOfDayLabel,
      sunElevationDeg: sample.sun.elevationDeg,
      moonElevationDeg: sample.moon.elevationDeg,
      moonIllumination: sample.moon.illumination,
      lightLevel: sample.lightLevel,
      weatherKind: sample.weather.kind,
      nextWeatherKind: sample.weather.nextKind,
      transition: sample.weather.transition,
      intensity: sample.weather.intensity,
      cloudCover: sample.weather.cloudCover,
      precipitation: sample.weather.precipitation,
      frozen: sample.weather.frozenPrecipitation,
      fogDensity: sample.weather.fogDensity,
      windSpeedMps: sample.weather.windSpeedMps,
      windDirectionDeg: sample.weather.windDirectionDeg,
      temperatureC: sample.weather.temperatureC,
      wetness: sample.weather.wetness,
      lightningFlash: sample.weather.lightningFlash,
      visibilityMeters: sample.effects.visibilityMeters,
      tractionMultiplier: sample.effects.tractionMultiplier,
      movementMultiplier: sample.effects.movementMultiplier,
      rangedAccuracyPenalty: sample.effects.rangedAccuracyPenalty,
      hazardous: sample.effects.hazardous,
      waterState: sample.water.state,
      depthZone: sample.water.zone.id,
      depthMeters: sample.water.depthMeters,
      submergedFraction: sample.water.submergedFraction,
      waveHeightMeters: sample.waveHeightMeters,
      waveAmplitudeMeters: sample.waveAmplitudeMeters,
      audioState: sample.audio.state,
      audioStatus: ambientAudio?.currentStatus ?? "idle",
      diving,
      qualityId: quality.id,
      particleCapacity: weatherStats?.particleCapacity ?? 0,
      activeParticles: weatherStats?.activeParticles ?? 0,
      shadowMapSize: quality.shadowMapSize,
      reflections: quality.reflections,
      telegraphs: quality.telegraphs.length,
    };
  };

  /** Flattens live streaming instrumentation for the panel. Nothing here is estimated. */
  const streamingReadout = (active: SectorStreamer, renderer: SectorRenderer): StreamingReadout => {
    const stats = active.stats();
    const scene = renderer.stats();
    const summary = SECTOR_STATES.filter((state) => stats.counts[state] > 0)
      .map((state) => `${stats.counts[state]} ${state}`)
      .join(", ");

    const totalRouteSeconds = routeSamples.length * ROUTE_STEP_SECONDS;
    return {
      serviceKind: stats.serviceKind,
      stateSummary: summary || "idle",
      resident: stats.resident,
      peakResident: stats.peakResident,
      generated: stats.generated,
      cacheHits: stats.cacheHits,
      cacheMisses: stats.cacheMisses,
      cancelled: stats.cancelled,
      evicted: stats.evicted,
      rescued: stats.rescued,
      failed: stats.failed,
      lastGenerationMs: stats.lastGenerationMs,
      averageGenerationMs: stats.averageGenerationMs,
      lastUploadMs: stats.lastUploadMs,
      averageUploadMs: stats.averageUploadMs,
      residentBytes: stats.residentBytes,
      peakResidentBytes: stats.peakResidentBytes,
      cachedBytes: stats.cachedBytes,
      cachedEntries: stats.cachedEntries,
      meshes: scene.meshes,
      pooledMeshes: scene.pooledMeshes,
      thinInstances: scene.thinInstances,
      gpuBytes: scene.estimatedGpuBytes,
      groundHeightMeters: active.sampleGroundHeight(worldState.playerPosition),
      routeRunning,
      routeProgress:
        routeSamples.length === 0
          ? "not started"
          : `${Math.min(routeSeconds, totalRouteSeconds).toFixed(1)} of ${totalRouteSeconds.toFixed(0)} s`,
    };
  };

  /** Advances the deterministic stress route by one frame's worth of travel. */
  const advanceRoute = (seconds: number): void => {
    routeSeconds += seconds;
    const index = Math.floor(routeSeconds / ROUTE_STEP_SECONDS);
    if (index >= routeSamples.length) {
      routeRunning = false;
      return;
    }
    const sample = routeSamples[index];
    if (!sample) return;
    lastVelocity = sample.velocity;
    movePlayerTo(sample.position);
  };

  const toggleRoute = (): void => {
    if (routeRunning) {
      routeRunning = false;
      lastVelocity = { east: 0, north: 0, up: 0 };
      refreshWorld();
      return;
    }
    if (routeSamples.length === 0) {
      routeSamples = buildRouteSamples({
        waypoints: STRESS_ROUTE_REGION_IDS.map((id) => ({
          label: id,
          position: regionRegistry.getOrThrow(id).centre,
        })),
        speedMetersPerSecond: ROUTE_SPEED_MPS,
        stepSeconds: ROUTE_STEP_SECONDS,
      });
    }
    routeSeconds = 0;
    routeRunning = true;
    refreshWorld();
  };

  /**
   * Applies a quality preset.
   *
   * Particle capacity and water resolution are both fixed when their objects are
   * built, so the ground view is torn down and rebuilt rather than nudged. That
   * is a visible reload of the sectors, which is honest about what changing
   * quality actually costs.
   */
  const applyQuality = (level: QualityLevel): void => {
    const next = qualityRegistry.get(level);
    if (!next || next.id === quality.id) return;
    quality = next;
    if (viewMode === "ground") {
      // Remember the machine so changing quality does not eject the player from
      // it: the view is rebuilt at the new budgets and handed back.
      const piloted = pilotSession?.jaeger.id ?? null;
      closeGroundView();
      openGroundView();
      if (piloted) startPilot(piloted);
    }
    refreshWorld();
  };

  const switchViewMode = (mode: WorldViewMode): void => {
    if (mode === viewMode) return;
    viewMode = mode;
    if (mode === "ground") {
      closeGlobeView();
      openGroundView();
    } else {
      closeGroundView();
      restoreBootStage();
      bootScene.jaegerPlaceholder.setEnabled(false);
      bootScene.ground.setEnabled(false);
      openGlobeView();
    }
    refreshWorld();
  };

  const openWorld = (): void => {
    // The world view replaces the boot stage rather than sharing it.
    bootScene.jaegerPlaceholder.setEnabled(false);
    bootScene.ground.setEnabled(false);
    openGlobeView();

    worldScreen = renderWorldScreen(
      uiRoot,
      regionRegistry.all(),
      qualityRegistry.all().map((preset) => ({ id: preset.id, label: preset.displayName })),
      ALERT_LEVELS.map((level) => ({ id: level, label: ALERT_PROFILES[level].displayName })),
      jaegerRegistry.all().map((entry) => ({ id: entry.id, label: entry.name })),
      {
        onTeleport: (regionId: string) => {
          routeRunning = false;
          worldState.teleportTo(regionId, kernel?.tick ?? 0);
          // A teleport is an intentional jump, so the origin follows immediately
          // rather than waiting for the drift threshold.
          floatingOrigin.forceRebase(worldState.playerPosition);
          sectorRenderer?.rebase();
          // Land on the terrain rather than at the region's nominal sea level, now
          // that there is terrain to land on.
          movePlayerTo(worldState.playerPosition);
          refreshWorld();
          // A teleport is a deliberate jump, so bring the camera with it. Walking
          // deliberately does not, or it would fight the player orbiting.
          globeView?.lookAtPlayer();
        },
        onWalk: (eastMeters: number, northMeters: number) => {
          const from = floatingOrigin.toLocal(worldState.playerPosition);
          const next = floatingOrigin.toGeo({
            east: from.east + eastMeters,
            north: from.north + northMeters,
            up: from.up,
          });
          // A tangent plane is flat and the globe is not, so walking a straight
          // line in local space lifts you off the surface: measured at 239 m of
          // false altitude over a 25 km walk. Carrying the previous altitude keeps
          // movement level; `movePlayerTo` then snaps it to the streamed ground
          // wherever that ground is actually loaded.
          movePlayerTo({ ...next, altitudeMeters: worldState.playerPosition.altitudeMeters });
          refreshWorld();
        },
        onViewMode: switchViewMode,
        onRouteToggle: toggleRoute,
        onSkipToDayFraction: (fraction: number) => {
          worldState.environment.skipToDayFraction(fraction, worldState.playerPosition.latitudeDeg);
          refreshWorld();
        },
        onAdvanceHours: (hours: number) => {
          const ticks = Math.round((worldState.environment.clock.dayLengthTicks * hours) / 24);
          worldState.environment.advance(ticks, worldState.playerPosition.latitudeDeg);
          refreshWorld();
        },
        onDiveToggle: () => {
          diving = !diving;
          refreshWorld();
        },
        onQualityChange: (level: string) => applyQuality(level as QualityLevel),
        onAlertChange: (level: string) => {
          const regionId = worldState.activeRegionId;
          if (!regionId) return;
          worldState.setRegionAlert(regionId, level as AlertLevel, kernel?.tick ?? 0);
          refreshWorld();
        },
        onPilot: (jaegerId: string) => startPilot(jaegerId),
        onExit: () => stateMachine.transition(AppState.MainMenu),
      },
    );

    frameHook = (deltaMs) => {
      if (viewMode !== "ground" || !streamer || !sectorRenderer) return;
      if (routeRunning) advanceRoute(deltaMs / 1000);

      // Settle onto the ground as it arrives. Terrain streams in after the player
      // is already standing there, so a position set before the sector loaded
      // would otherwise stay at its old altitude: measured at 0 m while the
      // ground under it read 169.8 m.
      //
      // Over water the answer is not simply the ground: a 75 m body stands in
      // shallows, floats over the deep, and walks the bottom while diving.
      const ground = streamer.sampleGroundHeight(worldState.playerPosition);
      if (ground !== null) {
        const wave = sampleEnvironment().waveHeightMeters;
        const target = resolveFeetHeight({
          groundHeightMeters: ground,
          waterHeightMeters: wave,
          entityHeightMeters: PLAYER_HEIGHT_METERS,
          diving,
        });
        if (Math.abs(worldState.playerPosition.altitudeMeters - target) > 0.05) {
          worldState.moveTo({ ...worldState.playerPosition, altitudeMeters: target }, kernel?.tick ?? 0);
        }
      }

      streamer.update({ position: worldState.playerPosition, velocity: lastVelocity });

      // Driving comes before everything that reads where the player is.
      if (pilotSession) advancePilot(Math.min(0.1, deltaMs / 1000));

      const local = floatingOrigin.toLocal(worldState.playerPosition);
      sectorRenderer.setPlayerLocal(local.east, local.up, local.north);
      // The orbit camera is not in charge while a machine is being driven; the
      // pilot camera owns the view and pointing this one at the same target would
      // fight it on the frame the player leaves the machine.
      if (!pilotSession) bootScene.camera.setTarget(new Vector3(local.east, local.up, local.north));

      // One sample, three consumers. Sky, weather and water all read the same
      // object gameplay would, so none of them can drift from the others.
      const sample = sampleEnvironment();
      skyView?.update(sample);
      weatherView?.update(sample, bootScene.scene.activeCamera);
      sectorRenderer.updateWater(sample, local);
      ambientAudio?.update(sample.audio);

      // Walking into or out of a region swaps the city under the player.
      if (cityRegionId !== worldState.activeRegionId) rebuildCityView();
      if (cityView) {
        const layout = cityLayouts.get(cityRegionId ?? "");
        if (layout) cityView.update(sample.tick, sampleCityActivity(layout, sample));
      }

      // The streamer runs every frame; the panel does not. A 144 Hz DOM write is
      // both wasteful and unreadable.
      const nowMs = performance.now();
      if (nowMs - lastReadoutMs >= READOUT_INTERVAL_MS) {
        lastReadoutMs = nowMs;
        refreshWorld();
      }
      if (pilotScreen && nowMs - lastPilotReadoutMs >= READOUT_INTERVAL_MS) {
        lastPilotReadoutMs = nowMs;
        refreshPilot();
      }
    };

    refreshWorld();
  };

  // ---------------------------------------------------------------- Shatterdome
  //
  // The interior is a session, a view and an input source, all built when the
  // player walks in and disposed when they leave. Only the room they are
  // standing in exists in the scene at any moment.

  let session: ShatterdomeSession | undefined;
  let interiorView: InteriorView | undefined;
  let onFootInput: OnFootInputSource | undefined;
  let shatterdomeScreen: ShatterdomeScreenHandle | undefined;
  let interiorPanel: ShatterdomePanelState | null = null;
  let interiorPaused = false;
  let interiorRoomId: string | null = null;
  let interiorRevision = -1;
  let lastInteriorTick = 0;
  let lastInteriorReadoutMs = 0;
  const berthRoster = jaegerRegistry.all();

  /** Environment as felt from inside: real weather, on ground that is above the water. */
  const sampleInteriorEnvironment = (): EnvironmentSample =>
    worldState.environment.sample({
      position: worldState.playerPosition,
      groundHeightMeters: Math.max(worldState.playerPosition.altitudeMeters, SHATTERDOME_DECK_HEIGHT_METERS),
      entityHeightMeters: ON_FOOT.heightMeters,
    });

  const facilityRows = (active: ShatterdomeSession): FacilityRow[] => {
    const dayFraction = worldState.environment.clock.dayFraction;
    return facilityRegistry.all().map((definition) => {
      const record = active.state.recordFor(definition.id);
      const tier = record?.tier ?? 0;
      const next = active.state.nextTier(definition.id);
      const refusal = active.state.checkOrder(definition.id);
      const currentTier = tier > 0 ? definition.tiers[tier - 1] : undefined;
      const working = record?.status === "building" || record?.status === "upgrading";
      const staffOnShift = Math.max(
        0,
        Math.round((currentTier?.staffSlots ?? 0) * (shiftAt(dayFraction) === "night" ? 0.34 : 0.9)),
      );
      return {
        id: definition.id,
        displayName: definition.displayName,
        deck: definition.deck,
        statusLabel: record?.status ?? "absent",
        tier,
        maxTier: definition.tiers.length,
        powerDrawMw: currentTier?.powerDrawMw ?? 0,
        staffOnShift,
        here: active.currentRoom.facilityId === definition.id,
        nextTierName: next?.displayName ?? null,
        nextTierBenefit: next?.benefit ?? null,
        nextTierCrews: next?.crewRequired ?? 0,
        // Ticks are in-game seconds and a day is twenty four real minutes, so a
        // build measured in in-game hours is roughly that many real minutes.
        nextTierMinutes: next ? Math.round(next.constructionTicks / 3_600) : 0,
        progress: active.state.progressOf(definition.id),
        working: working ?? false,
        refusal: refusal?.message ?? null,
      };
    });
  };

  const facilityPanelFor = (active: ShatterdomeSession, facilityId: FacilityKind): ShatterdomePanelState => {
    const power = active.state.power();
    const crews = active.state.crews();
    const definition = facilityRegistry.get(facilityId);
    return {
      kind: "facility",
      title: `${definition?.displayName ?? facilityId} terminal`,
      powerDrawMw: power.drawMw,
      powerOutputMw: power.outputMw,
      crewsFree: crews.free,
      crewCapacity: crews.capacity,
      rows: facilityRows(active),
    };
  };

  /** The last thing the repair crew reported, shown on the berth panel. */
  let repairNote: string | null = null;
  /** One shift on the gantries. Long enough to be worth pressing, short enough to feel. */
  const REPAIR_SHIFT_HOURS = 8;

  const berthPanelFor = (
    active: ShatterdomeSession,
    jaegerId: string | null,
    label: string,
  ): ShatterdomePanelState => {
    const jaeger = jaegerId ? jaegerRegistry.get(jaegerId) : undefined;
    const manifest = jaeger ? assetRegistry.get(jaeger.assetId) : undefined;
    return {
      kind: "berth",
      title: label,
      jaegerName: jaeger?.name ?? null,
      manufacturer: jaeger?.manufacturer ?? "unknown",
      markDesignation: jaeger?.markDesignation ?? "unknown",
      massTons: jaeger?.massBudget.massTons ?? 0,
      powerOutputMw: jaeger?.massBudget.powerOutputMw ?? 0,
      coolingCapacity: jaeger?.massBudget.coolingCapacity ?? 0,
      assetId: jaeger?.assetId ?? "none",
      // Truthful about which half of the pipeline is live: no production model
      // ships, so every machine in the bay is the procedural fallback.
      assetOrigin: manifest?.source.url === null ? "procedural placeholder" : "model",
      heightMeters: manifest?.nominalHeightMeters ?? 0,
      selected: active.state.selectedJaegerId === jaegerId,
      notes: repairNote ?? jaeger?.description ?? "This berth is empty.",
      ...berthRepairState(jaegerId),
    };
  };

  /**
   * The repair board for one berth.
   *
   * Every number on it comes from the machine's own damage record, so a machine
   * that came home with a torn arm shows the torn arm, what it costs to put
   * right, and how long it takes.
   */
  const berthRepairState = (
    jaegerId: string | null,
  ): Pick<
    BerthPanelState,
    "jaegerId" | "status" | "integrityPercent" | "components" | "offline" | "scars" | "workOrder"
  > => {
    const record = jaegerId ? roster.get(jaegerId) : undefined;
    if (!jaegerId || !record) {
      return {
        jaegerId: null,
        status: "empty",
        integrityPercent: 0,
        components: [],
        offline: [],
        scars: 0,
        workOrder: null,
      };
    }
    const components = roster.componentRegistry();
    const order = roster.repairOrder(jaegerId);
    return {
      jaegerId,
      status: describeStatus(record.status),
      integrityPercent: Math.round(structuralIntegrity(record.damage) * 100),
      components: record.damage.components.map((entry) => ({
        name: components.get(entry.componentId)?.displayName ?? entry.componentId,
        state: componentState(entry),
        percent: Math.round(componentFraction(entry) * 100),
      })),
      offline: disabledSystems(record.damage, components).map((system) => system.replace(".", " ")),
      scars: record.damage.scars.length,
      workOrder:
        order.lines.length === 0
          ? null
          : {
              summary: order.summary,
              lines: order.lines.map(
                (line) =>
                  `${line.displayName}: ${line.missing} structure, ${line.hours} h, ${line.cost.toLocaleString("en-GB")}` +
                  (line.replace ? " (replacement)" : ""),
              ),
              hours: order.totalHours,
              cost: order.totalCost,
            },
    };
  };

  const connPodPanelFor = (active: ShatterdomeSession): ShatterdomePanelState => {
    const sample = sampleInteriorEnvironment();
    const selectedId = active.state.selectedJaegerId;
    const jaeger = selectedId ? jaegerRegistry.get(selectedId) : undefined;
    const regionId = worldState.activeRegionId;
    const record = regionId ? worldState.recordFor(regionId) : undefined;
    return {
      kind: "conn-pod",
      title: "Conn-Pod",
      jaegerName: jaeger?.name ?? null,
      massTons: jaeger?.massBudget.massTons ?? 0,
      powerOutputMw: jaeger?.massBudget.powerOutputMw ?? 0,
      coolingCapacity: jaeger?.massBudget.coolingCapacity ?? 0,
      outsideWeather: `${sample.weather.kind}, ${Math.round(sample.weather.temperatureC)} C`,
      outsideTime: `${sample.timeOfDayLabel}, day ${sample.dayNumber}`,
      windMps: sample.weather.windSpeedMps,
      visibilityMeters: sample.effects.visibilityMeters,
      regionLabel: regionId ?? "open water",
      alertLabel: record ? `alert ${record.alert.level}` : "no alert record",
      // Honest about the boundary: the instruments read real systems, and
      // deployment is not one of them yet.
      readiness:
        "Instruments read live world state. Deployment and combat arrive with a later milestone, " +
        "so there is no launch control on this panel.",
    };
  };

  const openInteriorPanel = (panel: ShatterdomePanelState | null): void => {
    interiorPanel = panel;
    // Movement stops while a panel is open, so a player cannot walk away from
    // an interface they are still reading.
    onFootInput?.setEnabled(panel === null && !interiorPaused);
    refreshShatterdome();
  };

  const handleInteraction = (): void => {
    if (!session) return;
    // Paused means paused: the pause menu is the only thing that answers keys.
    if (interiorPaused) return;
    if (interiorPanel !== null) {
      openInteriorPanel(null);
      return;
    }
    const outcome = session.interact();
    switch (outcome.kind) {
      case "terminal":
        openInteriorPanel(
          outcome.connPod ? connPodPanelFor(session) : facilityPanelFor(session, outcome.facilityId),
        );
        break;
      case "berth":
        // A fresh look at a berth starts with the machine's own notes rather
        // than whatever the crew last said about a different one.
        repairNote = null;
        openInteriorPanel(berthPanelFor(session, outcome.jaegerId, outcome.label));
        break;
      default:
        refreshShatterdome();
        break;
    }
  };

  const setInteriorPaused = (paused: boolean): void => {
    interiorPaused = paused;
    // Pausing the simulation pauses construction, the clock and the weather
    // along with it, which is what a pause is supposed to mean here.
    if (paused) loop?.pause();
    else loop?.resume();
    onFootInput?.setEnabled(!paused && interiorPanel === null);
    refreshShatterdome();
  };

  /**
   * What the interior view is actually drawing. Reported rather than assumed, the
   * same way the city reports how much of itself is on screen.
   */
  const interiorStats = (): string | null => {
    const stats = interiorView?.stats();
    if (!stats) return null;
    return `${stats.staffDrawn}/${stats.staffOnShift} staff drawn, ${stats.meshes} meshes`;
  };

  const refreshShatterdome = (): void => {
    if (!shatterdomeScreen || !session) return;
    const room = session.currentRoom;
    const focus = session.focus;
    const power = session.state.power();
    const crews = session.state.crews();
    const load = session.roomShift;
    const transition = session.transition;

    shatterdomeScreen.update({
      roomName: room.displayName,
      roomStatus: room.underConstruction
        ? `under construction, tier ${room.tier}`
        : `operational, tier ${room.tier}`,
      deck: room.deck,
      staffOnShift: load.onShift,
      staffSlots: load.slots,
      shiftLabel: load.shift,
      timeLabel: worldState.environment.clock.timeOfDayLabel,
      powerText: `${power.drawMw}/${power.outputMw} MW`,
      crewText: `${crews.free}/${crews.capacity} crews`,
      positionText: `x ${session.pose.x.toFixed(1)} z ${session.pose.z.toFixed(1)}`,
      drawnText: interiorStats(),
      prompt: focus?.prompt ?? null,
      announcement: focus?.announcement ?? null,
      transitionLabel: transition ? `${TRANSIT_LABELS[transition.kind]}...` : null,
      fade: session.fade,
      radio: session.radioLog.map((line) => ({
        id: line.id,
        speaker: line.speaker,
        role: line.role,
        text: line.text,
      })),
      panel: interiorPanel,
      paused: interiorPaused,
    });
  };

  const closeShatterdome = (): void => {
    frameHook = null;
    onFootInput?.dispose();
    onFootInput = undefined;
    interiorView?.dispose();
    interiorView = undefined;
    shatterdomeScreen?.dispose();
    shatterdomeScreen = undefined;
    session = undefined;
    interiorPanel = null;
    interiorRoomId = null;
    interiorRevision = -1;
    if (interiorPaused) {
      interiorPaused = false;
      loop?.resume();
    }
    restoreBootStage();
  };

  const openShatterdome = (): void => {
    bootScene.jaegerPlaceholder.setEnabled(false);
    bootScene.ground.setEnabled(false);

    const active = new ShatterdomeSession({
      state: shatterdomeState,
      definitions: facilityRegistry,
      crew: CREW_MEMBERS,
      berths: berthRoster.map((jaeger) => ({ jaegerId: jaeger.id, displayName: jaeger.name })),
      seed: kernel?.seed ?? 0,
    });
    session = active;

    interiorView = new InteriorView({
      scene: bootScene.scene,
      quality,
      resolver: assetResolver,
      assets: assetRegistry,
      berthAssets: berthRoster.map((jaeger) => jaeger.assetId),
    });
    interiorRoomId = active.currentRoom.id;
    interiorRevision = active.revision;
    void interiorView.setRoom(active.currentRoom);

    onFootInput = new OnFootInputSource(canvas, {
      onInteract: handleInteraction,
      onCycleFocus: (direction) => {
        active.cycleFocus(direction);
        refreshShatterdome();
      },
      onUnstuck: () => {
        active.unstuck();
        refreshShatterdome();
      },
      onPauseToggle: () => {
        if (interiorPanel !== null) {
          openInteriorPanel(null);
          return;
        }
        setInteriorPaused(!interiorPaused);
      },
    });

    shatterdomeScreen = renderShatterdomeScreen(uiRoot, {
      onOrder: (facilityId) => {
        active.orderUpgrade(facilityId as FacilityKind);
        // The order changes the room and the panel in the same breath.
        openInteriorPanel(facilityPanelFor(active, active.currentRoom.facilityId));
      },
      onRepair: (jaegerId) => {
        // One shift of work. The crew takes the worst component first, which is
        // why a machine gets its legs back before its paint.
        const outcome = roster.work(jaegerId, REPAIR_SHIFT_HOURS);
        const record = roster.get(jaegerId);
        repairNote =
          outcome.messages[outcome.messages.length - 1] ??
          (record
            ? `${roster.definition(jaegerId).name} is ${describeStatus(record.status)}, ${Math.ceil(record.hoursRemaining)} hours from ready.`
            : "Nothing to do.");
        openInteriorPanel(berthPanelFor(active, jaegerId, roster.definition(jaegerId).name));
      },
      onClosePanel: () => openInteriorPanel(null),
      onResume: () => setInteriorPaused(false),
      onOpenSaves: () => stateMachine.transition(AppState.Saves),
      onExitToMenu: () => stateMachine.transition(AppState.MainMenu),
    });

    lastInteriorTick = kernel?.tick ?? 0;

    frameHook = (deltaMs) => {
      if (!session || !interiorView) return;
      const tick = kernel?.tick ?? 0;
      const ticks = Math.max(0, tick - lastInteriorTick);
      lastInteriorTick = tick;

      const input = onFootInput?.sample(deltaMs / 1000) ?? NEUTRAL_INPUT;
      const sample = sampleInteriorEnvironment();
      session.update({
        deltaSeconds: deltaMs / 1000,
        ticks,
        tick,
        dayFraction: sample.dayFraction,
        timeLabel: sample.timeOfDayLabel,
        input,
        outsideEffects: sample.effects,
      });

      // The room is rebuilt when the player walks into another one, and when a
      // build finishes and the room itself changes shape.
      if (session.currentRoom.id !== interiorRoomId || session.revision !== interiorRevision) {
        interiorRoomId = session.currentRoom.id;
        interiorRevision = session.revision;
        void interiorView.setRoom(session.currentRoom);
      }
      interiorView.update(session.pose, tick, sample.dayFraction);

      const nowMs = performance.now();
      if (nowMs - lastInteriorReadoutMs >= READOUT_INTERVAL_MS) {
        lastInteriorReadoutMs = nowMs;
        // A live panel keeps its numbers current: construction progress moves
        // while the player is standing at the terminal watching it.
        if (interiorPanel?.kind === "facility") {
          interiorPanel = facilityPanelFor(session, session.currentRoom.facilityId);
        }
        refreshShatterdome();
      }
    };

    refreshShatterdome();
  };

  const renderForState = (state: AppState): void => {
    if (state !== AppState.AssetGallery && gallery) closeGallery();
    if (state !== AppState.Saves && saveScreen) closeSaves();
    if (state !== AppState.WorldMap && worldScreen) closeWorld();
    if (state !== AppState.Shatterdome && shatterdomeScreen) closeShatterdome();

    switch (state) {
      case AppState.MainMenu:
        renderMainMenu(
          uiRoot,
          () => stateMachine.transition(AppState.Loading),
          () => stateMachine.transition(AppState.AssetGallery),
          () => stateMachine.transition(AppState.Saves),
          () => stateMachine.transition(AppState.WorldMap),
        );
        break;
      case AppState.WorldMap:
        openWorld();
        break;
      case AppState.Saves:
        void openSaves().catch((error) => {
          renderErrorScreen(uiRoot, `Saves unavailable: ${describeSaveError(error)}`, goToMainMenu);
        });
        break;
      case AppState.AssetGallery:
        renderLoadingScreen(uiRoot, "Loading assets…");
        void openGallery().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          renderErrorScreen(uiRoot, `Asset gallery failed: ${message}`, goToMainMenu);
        });
        break;
      case AppState.Loading:
        renderLoadingScreen(uiRoot);
        // Nothing to actually load yet — Shatterdome is a stub. Advance next frame
        // rather than instantly, so the state is honestly visible for at least one paint.
        requestAnimationFrame(() => stateMachine.transition(AppState.Shatterdome));
        break;
      case AppState.Shatterdome:
        openShatterdome();
        break;
      case AppState.Error:
        // handled at boot-failure site above for the fatal case; runtime errors reuse this.
        break;
      default:
        clearScreen(uiRoot);
    }
  };

  unsubscribers.push(
    stateMachine.onChange((to, from) => {
      // Remember where the save panel was opened from before the screen changes.
      if (to === AppState.Saves && from !== AppState.Saves) {
        savesReturnState = from === AppState.Shatterdome ? AppState.Shatterdome : AppState.MainMenu;
      }
      renderForState(to);
    }),
  );
  renderForState(stateMachine.state);

  return {
    dispose(): void {
      unsubscribers.forEach((u) => u());
      pilotInput?.dispose();
      combatView?.dispose();
      jaegerView?.dispose();
      pilotScreen?.dispose();
      gallery?.dispose();
      galleryScreen?.dispose();
      saveScreen?.dispose();
      onFootInput?.dispose();
      interiorView?.dispose();
      shatterdomeScreen?.dispose();
      streamer?.dispose();
      sectorRenderer?.dispose();
      cityView?.dispose();
      weatherView?.dispose();
      skyView?.dispose();
      ambientAudio?.dispose();
      globeView?.dispose();
      worldScreen?.dispose();
      repository.close();
      overlay?.dispose();
      kernel?.dispose();
      adapterDispose?.();
    },
  };
}
