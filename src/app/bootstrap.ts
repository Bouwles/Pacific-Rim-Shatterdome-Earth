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
import { RegionDestruction } from "../world/destruction";
import { AttackDirector, type Resolution } from "../world/director";
import { Market, ROTATION_DAYS } from "../world/market";
import { Crew, LINK_EXPERIENCE_PER_LEVEL } from "../pilots/crew";
import { Squad, MAX_SQUAD_SIZE } from "../allies/squad";
import { AllyController, resolveSquadIntents, type AllyIntent } from "../allies/allyController";
import type { SquadOrderId } from "../data/squadOrders";
import { LEVEL_CAP, levelFromExperience, nextUnlock } from "../jaegers/progression";
import { createPassiveRegistry } from "../data/passives";
import { createMasteryRegistry, masteryProgress } from "../data/masteries";
import { createManufacturerRegistry } from "../data/manufacturers";
import { createObjectiveRegistry } from "../missions/objectives";
import {
  createPilotRegistry,
  perkEffects,
  type PerkEffect,
  type DriftContext,
  assessDrift,
  currentPerkRank,
} from "../data/pilots";
import {
  Mission,
  assessPlan,
  type DeploymentPlan,
  type MissionResults,
  type ReadinessReport,
} from "../missions/mission";
import type { WarReadout } from "../ui/worldScreen";
import { Creature, type CreatureDebug } from "../kaiju/creature";
import type { BodyZoneId } from "../data/kaiju";
import type { NavigationQuery } from "../kaiju/navigation";
import { DEFAULT_DAY_LENGTH_TICKS } from "../world/worldClock";
import { DebrisPool, debrisStream, MAX_CHUNKS_PER_COLLAPSE } from "../world/debris";
import { EARTH_SCALE, geoToLocal, localToGeo, surfaceDistanceMeters } from "../world/coordinates";
import { PilotSession } from "../jaegers/pilotSession";
import { JaegerView } from "../engine/jaegerView";
import { PilotInputSource } from "../engine/pilotInput";
import { renderPilotScreen, type PilotScreenHandle, type SquadPanelState } from "../ui/pilotScreen";
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
  type MarketOfferRow,
  type ProgressionPanelState,
  type CrewPanelState,
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
              attackDirector.snapshot(),
              mission?.snapshot() ?? null,
              market.snapshot(),
              crew.snapshot(),
              squad.snapshot(),
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
              attackDirector.snapshot(),
              mission?.snapshot() ?? null,
              market.snapshot(),
              crew.snapshot(),
              squad.snapshot(),
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
            // And so does the war: escalation, threat and everything inbound.
            attackDirector.restore(result.document.director);
            // Money, standing, orders in transit and the board itself.
            market.restore(result.document.market);
            // Links, stress, injuries, and which sorties have already paid out.
            crew.restore(result.document.crew);
            // What the allied crews became, and what they fly.
            squad.restore(result.document.squad);
            marketDay = worldState.environment.clock.dayNumber;
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
  /**
   * The war.
   *
   * Authoritative and session-lived like the world itself: it keeps running
   * whether the player is on the globe, in the Shatterdome or in a fight, and
   * it is saved from wherever they happen to be.
   */
  /**
   * How fast a carrier moves a machine, metres a second at real-world scale.
   *
   * The globe is a fiftieth of Earth, so a distance measured on it has to be
   * scaled back up before it means anything as a flight time. Without that, a
   * crossing of the Pacific reads as a couple of minutes.
   */
  const CARRIER_SPEED_MPS = 240;
  /** Simulation ticks in one second of world time. */
  const TICKS_PER_SECOND = 1;
  const attackDirector = new AttackDirector({
    regions: regionRegistry,
    seed: kernel?.seed ?? 0,
  });
  /** Resolutions the player has not read yet, newest first. Bounded. */
  const resolutionLog: Resolution[] = [];
  /**
   * The war's own clock.
   *
   * Simulation ticks plus any time the player skipped on the panel. Both paths
   * go through one counter, because six hours passing is six hours of war
   * whichever way the six hours happened.
   */
  let warClock = 0;
  /** The last thing the director did, for the alert board. */
  let directorNotice: string | null = null;

  // ------------------------------------------------------------------ missions
  //
  // A sortie is one object covering planning, the carrier run, the fight and the
  // results. The active phase is the world the player was already standing in
  // with a mission attached, rather than a second game state.
  const objectiveRegistry = createObjectiveRegistry();
  const pilotRegistry = createPilotRegistry();
  /**
   * The people, between sorties.
   *
   * Seeded from the world seed like everything else authoritative, so who gets
   * hurt on a given sortie is the same in every session of the same campaign.
   */
  const crew = new Crew({ pilots: pilotRegistry, seed: kernel?.seed ?? 0 });
  /** The pair currently assigned. Changing it is what makes a machine feel different. */
  let assignedPilots: readonly string[] = pilotRegistry
    .all()
    .slice(0, 2)
    .map((pilot) => pilot.id);
  /** The last thing the crew said about a link, an injury or a conversation. */
  let crewNote: string | null = null;

  // ------------------------------------------------------------------- allies
  //
  // The other machines that go out with you. An ally is an arena fighter driven
  // by its own utility scoring, exactly as a creature is: nothing here scripts a
  // position or an animation, and an order changes what they want rather than
  // what they do.
  const squad = new Squad();
  /** Crews taken on the current sortie, in the order they were listed. */
  let deployedAllies: readonly string[] = [];
  /** One controller per ally that is actually in the fight. */
  const allyControllers = new Map<string, AllyController>();
  /** Fighter id in the arena for each crew that is out. */
  const allyFighters = new Map<string, string>();
  /** What each ally last decided, for the squad readout. */
  let allyIntents: readonly AllyIntent[] = [];
  /** Radio traffic from the squad, newest first. Bounded. */
  const squadLog: string[] = [];
  /** True while the quick command dial is open. The fight does not pause for it. */
  let orderDialOpen = false;

  /**
   * Gives every allied crew something to fly.
   *
   * The Shatterdome does not keep machines in storage while crews stand around:
   * anything owned that the player is not taking out themselves is assigned to
   * a crew, in roster order. Called at startup and whenever the roster changes,
   * so a machine bought on Tuesday has somebody in it on Wednesday.
   */
  const syncSquadMachines = (): void => {
    const taken = new Set<string>();
    for (const record of squad.all()) {
      // A crew keeps the machine they already have, if it is still owned.
      if (record.machineId && roster.get(record.machineId)) taken.add(record.machineId);
      else if (record.machineId) squad.assignMachine(record.crewId, null);
    }
    const spare = roster
      .all()
      .map((record) => record.jaegerId)
      .filter((id) => !taken.has(id) && id !== playerMachineId());
    for (const record of squad.all()) {
      if (record.machineId) continue;
      const next = spare.shift();
      if (!next) break;
      squad.assignMachine(record.crewId, next);
    }
  };

  /** The machine the player flies themselves, which no ally may be given. */
  const playerMachineId = (): string => roster.all()[0]?.jaegerId ?? "";

  const sayFromSquad = (line: string): void => {
    squadLog.unshift(line);
    while (squadLog.length > 5) squadLog.pop();
  };

  /**
   * Everything outside the two pilots that changes how they drift.
   *
   * Read from live state rather than passed around, so a drawback that depends
   * on the machine or the weather sees the machine and the weather.
   */
  const driftContextFor = (
    jaegerId: string | null,
    pilotIds: readonly string[],
    travelSeconds?: number,
  ): DriftContext => {
    const [firstId, secondId] = pilotIds;
    const record = jaegerId ? roster.get(jaegerId) : undefined;
    const sample = sampleEnvironment();
    return {
      machineRole: record ? jaegerRegistry.get(record.chassisId)?.role : undefined,
      machineIntegrity: record ? structuralIntegrity(record.damage) : undefined,
      night: sample.dayFraction < 0.25 || sample.dayFraction > 0.78,
      weatherPenalty: sample.effects.rangedAccuracyPenalty,
      travelSeconds,
      linkLevel: firstId && secondId ? crew.linkLevel(firstId, secondId) : 0,
      firstStress: firstId ? crew.get(firstId)?.stress : undefined,
      secondStress: secondId ? crew.get(secondId)?.stress : undefined,
      firstInjuryPenalty: firstId ? crew.injuryPenaltyOf(firstId) : undefined,
      secondInjuryPenalty: secondId ? crew.injuryPenaltyOf(secondId) : undefined,
      firstInjured: firstId ? (crew.get(firstId)?.injuries.length ?? 0) > 0 : false,
      secondInjured: secondId ? (crew.get(secondId)?.injuries.length ?? 0) > 0 : false,
    };
  };

  /**
   * What the assigned pair are worth to the machine they are flying.
   *
   * Perk effects arrive as the same multipliers a passive or a module produces,
   * so the fight reads one growth object and does not know a person was
   * involved. The three that are not machine axes are handed to the sortie's
   * ledger instead, where salvage, samples and repair hours already live.
   */
  const crewGrowthBonus = (): Partial<Record<PerkEffect, number>> => {
    const [firstId, secondId] = assignedPilots;
    if (!firstId || !secondId) return {};
    return perkEffects(
      pilotRegistry.get(firstId),
      pilotRegistry.get(secondId),
      crew.linkLevel(firstId, secondId),
    );
  };

  /** The machine axes of the crew's perks, for the growth object. */
  const crewMachineBonus = (): {
    structure?: number;
    damage?: number;
    heat?: number;
    mobility?: number;
    poise?: number;
  } => {
    const effects = crewGrowthBonus();
    return {
      structure: effects.structure,
      damage: effects.damage,
      heat: effects.heat,
      mobility: effects.mobility,
      poise: effects.poise,
    };
  };

  /** The sortie in progress, or undefined when nobody is out. */
  let mission: Mission | undefined;
  /** Results waiting to be read, cleared when the player closes them. */
  let missionResults: MissionResults | null = null;
  /** Sorties flown this session, for mission ids. */
  let missionSeq = 0;

  /** Tons the carrier can lift, which is what logistics tiers actually buy. */
  const carrierLiftTons = (): number => {
    const logistics = shatterdomeState.recordFor("logistics");
    return 260 + (logistics?.tier ?? 0) * 140;
  };

  /**
   * What the planner would say about deploying to this incident right now.
   *
   * Reads live state throughout: the machine's real damage, the pair's real
   * drift, the region's real weather, and the warning's own words rather than
   * what is actually out there.
   */
  const planFor = (incidentId: string): DeploymentPlan | null => {
    const incident = attackDirector.incident(incidentId);
    if (!incident) return null;
    const machine = roster.all().find((record) => roster.canDeploy(record.jaegerId).ok);
    if (!machine) return null;
    // Whoever is assigned, provided they are cleared. A grounded pilot is
    // replaced by the best available substitute rather than silently flown.
    const pair = assignedPilots.map((id, index) => {
      if (crew.canDeploy(id).ok) return id;
      const partner = assignedPilots[index === 0 ? 1 : 0] ?? "";
      return crew.substitutesFor(id, partner)[0]?.pilotId ?? id;
    });
    if (pair.length < 2 || pair[0] === pair[1]) return null;
    return {
      jaegerId: machine.jaegerId,
      pilotIds: [pair[0]!, pair[1]!],
      weaponIds: weaponRegistry.all().map((weapon) => weapon.id),
      consumables: { "consumable.reload": 2 },
      allyIds: availableAllies(),
      arrivalBearingDeg: incident.originBearingDeg,
      priorities: ["objective.defend"],
    };
  };

  /**
   * The crews who can actually come, up to the ceiling.
   *
   * Assessed through the squad rather than guessed: a crew with no machine, or
   * one whose machine is in pieces, is not offered.
   */
  const availableAllies = (): readonly string[] => {
    syncSquadMachines();
    const machines: Record<string, { integrity: number; ammunition: number; role: string }> = {};
    for (const record of roster.all()) {
      const chassis = jaegerRegistry.get(record.chassisId);
      machines[record.jaegerId] = {
        integrity: structuralIntegrity(record.damage),
        ammunition: 1,
        role: chassis?.role ?? "unknown",
      };
    }
    return squad
      .candidates({ crewIds: [], playerRole: "brawler", machines })
      .filter((candidate) => candidate.refusal === null)
      .slice(0, MAX_SQUAD_SIZE)
      .map((candidate) => candidate.crewId);
  };

  const readinessFor = (incidentId: string): ReadinessReport | null => {
    const incident = attackDirector.incident(incidentId);
    const plan = planFor(incidentId);
    if (!incident || !plan) return null;
    const region = regionRegistry.get(incident.regionId);
    const record = roster.get(plan.jaegerId);
    const sample = sampleEnvironment();
    const distance = region
      ? surfaceDistanceMeters(worldState.playerPosition, region.centre) / EARTH_SCALE
      : 0;
    const forecast = attackDirector.forecast(incident, warClock, 0);
    return assessPlan({
      plan,
      jaeger: jaegerRegistry.get(plan.jaegerId),
      pilots: plan.pilotIds.map((id) => pilotRegistry.get(id)),
      machineIntegrity: record ? structuralIntegrity(record.damage) : 0,
      machineReady: roster.canDeploy(plan.jaegerId).ok,
      machineStatus: describeStatus(record?.status ?? "ready"),
      weapons: weaponRegistry.all(),
      distanceMeters: distance,
      carrierSpeedMps: CARRIER_SPEED_MPS,
      liftCapacityTons: carrierLiftTons(),
      weatherSummary: sample.weather.kind,
      weatherPenalty: sample.effects.rangedAccuracyPenalty,
      underwater: sample.water.submergedFraction > 0.5,
      forecastComposition: forecast.composition,
      forecastConfidence: forecast.warningConfidence,
      driftContext: driftContextFor(plan.jaegerId, plan.pilotIds, distance / CARRIER_SPEED_MPS),
    });
  };

  /**
   * Sends the machine.
   *
   * Teleports to the region the way the world map already does, starts the
   * carrier run, and puts the player in the machine when it lands. Every
   * refusal comes from the planner and is shown rather than swallowed.
   */
  const deployTo = (incidentId: string): void => {
    const incident = attackDirector.incident(incidentId);
    const plan = planFor(incidentId);
    const readiness = readinessFor(incidentId);
    if (!incident || !plan || !readiness) {
      directorNotice = "Nothing to deploy to.";
      refreshWorld();
      return;
    }
    if (readiness.refusals.length > 0) {
      directorNotice = readiness.refusals.join(" ");
      refreshWorld();
      return;
    }

    missionSeq += 1;
    missionResults = null;
    mission = new Mission({
      id: `mission.${missionSeq}`,
      incidentId: incident.id,
      regionId: incident.regionId,
      plan,
      objectives: objectiveRegistry,
      seed: (kernel?.seed ?? 0) + missionSeq,
      // World seconds, of which roughly sixty pass per real second, so this is
      // ten to thirty seconds of flight: long enough to be a transition, short
      // enough not to be a tax, and skippable either way.
      carrierSeconds: Math.max(600, Math.min(1_800, readiness.travelSeconds / 40)),
      assignments: [
        { id: "objective.defend", stage: 0 },
        { id: "objective.rescue", stage: 0 },
        { id: "objective.salvage", stage: 1 },
      ],
    });
    mission.launch();
    directorNotice = `Carrier away for ${regionRegistry.get(incident.regionId)?.displayName ?? incident.regionId}.`;
    refreshWorld();
  };

  /** Puts the player where the sortie is, in the world they were already in. */
  const beginSortieOnTheGround = (): void => {
    const active = mission;
    if (!active) return;
    worldState.teleportTo(active.regionId, kernel?.tick ?? 0);
    floatingOrigin.forceRebase(worldState.playerPosition);
    sectorRenderer?.rebase();
    movePlayerTo(worldState.playerPosition);
    switchViewMode("ground");
    startPilot(active.plan.jaegerId);
    spawnTarget();
    directorNotice = "On station.";
    refreshWorld();
  };

  /**
   * Feeds the simulation's own numbers to the mission.
   *
   * The only path into the objectives, which is what makes the results
   * reconcile: nothing is awarded that did not happen here.
   */
  const reportMissionProgress = (): void => {
    const active = mission;
    if (!active || active.phase !== "active") return;
    const arena = combatArena;
    const destruction = cityRegionId ? destructionByRegion.get(cityRegionId) : undefined;
    const record = pilotSession ? roster.get(pilotSession.jaeger.id) : undefined;
    const kaijuView = arena?.snapshot().fighters.find((fighter) => fighter.id === "kaiju");
    const report = destruction?.report();

    active.report({
      kaijuTotal: kaijuView ? 1 : 0,
      kaijuDown: kaijuView?.defeated === true ? 1 : 0,
      kaijuEscaped: false,
      machineIntegrity: record ? structuralIntegrity(record.damage) : 1,
      cityIntegrity: report?.integrity ?? 1,
      trappedThousands: report?.trappedThousands ?? 0,
      rescuedThousands: Math.max(0, (report?.trappedThousands ?? 0) * 0.1),
      samples: kaijuView?.defeated === true ? 3 : 0,
      salvageTons: kaijuView?.defeated === true ? 420 : 0,
      escortAlive: true,
      escortMetresLeft: 0,
      elapsedSeconds: 0,
      limitSeconds: Number.POSITIVE_INFINITY,
      contamination: report?.contaminatedGroups ? Math.min(1, report.contaminatedGroups / 10) : 0,
    });

    if (active.settled) endMission("success");
  };

  /**
   * Ends the sortie and applies everything it produced.
   *
   * Results are applied once, here, from the mission's own ledger: the city
   * takes its damage, the machine takes its repair order, and the incident is
   * closed with the director. Nothing is awarded in two places.
   */
  const endMission = (kind: "success" | "aborted" | "lost-contact"): void => {
    const active = mission;
    if (!active) return;
    const results = kind === "success" ? active.complete() : active.abort(kind);
    missionResults = results;

    const incident = attackDirector.incident(active.incidentId);
    if (incident && incident.status !== "resolved") {
      // One resolution, told what the sortie actually achieved.
      const resolution = attackDirector.resolve(incident, "player-defended", {
        playerStrength: results.objectiveScore * 600,
      });
      resolutionLog.unshift(resolution);
      while (resolutionLog.length > 5) resolutionLog.pop();
    }
    // The machine comes home to whatever it earned, through the same recovery
    // path a fight outside a mission uses.
    if (pilotSession) {
      clearTarget();
      stopPilot();
    }
    // The sortie pays into the same treasury the market spends from, once,
    // from the mission's own ledger.
    market.credit(results.funding, results.salvageTons, results.samples);

    // And the allied crews, guarded by the same mission id everything else uses.
    for (const line of squad.completeSortie({
      missionId: active.id,
      crewIds: deployedAllies,
      won: results.outcome === "success" || results.outcome === "partial",
      score: results.objectiveScore,
      day: worldState.environment.clock.dayNumber,
    }).messages) {
      sayFromSquad(line);
    }
    deployedAllies = [];

    // And the people who flew it. Guarded by the mission's own id inside the
    // crew, so asking twice does nothing the second time.
    const crewEffect = crew.completeSortie({
      missionId: active.id,
      pilotIds: active.plan.pilotIds,
      score: results.objectiveScore,
      machineDamage: results.machineDamage,
      won: results.outcome === "success" || results.outcome === "partial",
      day: worldState.environment.clock.dayNumber,
    });
    for (const line of crewEffect.messages) crewNote = line;
    for (const line of crewEffect.messages) progressionLog.unshift(line);

    // And it pays the machine that flew it. Experience and mastery counters both
    // come off the same ledger, in one place, so nothing is credited twice.
    const flownBy = active.plan.jaegerId;
    const day = worldState.environment.clock.dayNumber;
    const record = roster.get(flownBy);
    const componentLost = record
      ? record.damage.components.some((component) => component.health <= 0)
      : false;
    const levelled = roster.award(flownBy, results.experience, day);
    const mastered = roster.completeSortie(
      flownBy,
      {
        won: results.outcome === "success" || results.outcome === "partial",
        structureLost: results.machineDamage,
        componentLost,
        rescuedThousands: results.rescuedThousands,
        salvageTons: results.salvageTons,
      },
      day,
    );
    for (const line of [...levelled.messages, ...mastered.messages]) {
      progressionLog.unshift(`${record?.name ?? flownBy}: ${line}`);
    }
    while (progressionLog.length > 6) progressionLog.pop();
    directorNotice = results.summary;
    mission = undefined;
    refreshWorld();
  };

  advanceWorldTime = (ticks) => {
    worldState.advanceEnvironment(ticks);
    // Evacuation moves with world time too, so a city cleared while the player
    // was elsewhere is still cleared when they arrive.
    worldState.advanceAlerts(ticks);

    updateFleetStrength();
    advanceWar(ticks);
    // Upkeep and deliveries run on the same clock as the war.
    settleMarket();

    // The sortie runs on the same clock as everything else.
    if (mission) {
      const seconds = (ticks / worldState.environment.clock.dayLengthTicks) * 86_400;
      const before = mission.phase;
      mission.advance(seconds);
      if (before === "carrier" && mission.phase === "active") beginSortieOnTheGround();
      reportMissionProgress();
    }
  };

  /**
   * Moves the war forward by a number of ticks.
   *
   * New alerts raise the region's own alert level, which is what the city has
   * always reacted to, so sirens and evacuation follow an inbound contact
   * without the director knowing anything about either.
   */
  const advanceWar = (ticks: number): void => {
    if (ticks <= 0) return;
    warClock += ticks;
    const created = attackDirector.advance(warClock, ticks);
    for (const incident of created) {
      worldState.setRegionAlert(incident.regionId, "watch", kernel?.tick ?? 0);
      directorNotice = `${regionRegistry.get(incident.regionId)?.displayName ?? incident.regionId}: contact inbound.`;
    }
    for (const incident of attackDirector.incidents()) {
      if (incident.status === "inbound") {
        worldState.setRegionAlert(incident.regionId, "warning", kernel?.tick ?? 0);
      }
      if (incident.status === "landed") {
        worldState.setRegionAlert(incident.regionId, "attack", kernel?.tick ?? 0);
      }
    }
    // An attack nobody answered closes on its own: the city was overrun. Without
    // this, skipped time leaves every landed attack live forever.
    for (const resolution of attackDirector.settleAbandoned(warClock)) {
      resolutionLog.unshift(resolution);
    }
    while (resolutionLog.length > 5) resolutionLog.pop();
    attackDirector.prune(warClock);
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
  // ------------------------------------------------------------------- economy
  //
  // Money, standing with the yards, and the board of contracts. The market is
  // seeded from the world seed, so the offers a campaign sees are that
  // campaign's offers and reloading the page does not change them.
  const manufacturerRegistry = createManufacturerRegistry();
  // Read by the berth so a panel can name a passive or a goal. The roster owns
  // its own copies for the rules; these are only for words on a screen.
  const passiveRegistry = createPassiveRegistry();
  const masteryRegistry = createMasteryRegistry();
  const market = new Market({ seed: kernel?.seed ?? 0, manufacturers: manufacturerRegistry });
  /**
   * The last day the market was settled to.
   *
   * Settling is driven by the clock's absolute day number rather than by
   * elapsed ticks, so every path that moves time forward, including the skip
   * button, charges upkeep and delivers orders exactly once.
   */
  let marketDay = 0;
  /** The last thing the contracts office said. Shown on its terminal. */
  let contractsNote: string | null = null;
  /** What levelling has said recently, newest first. Bounded, and shown at the berth. */
  const progressionLog: string[] = [];
  /** The last thing the bay said about a passive, a module or a prestige. */
  let progressionNote: string | null = null;

  /** Money as a person would say it. Millions to one decimal, thousands whole. */
  const formatMoney = (amount: number): string => {
    const value = Math.round(amount);
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(value);
  };

  /**
   * Keeps the war's idea of the fleet up to date.
   *
   * Read from the machine that would actually go rather than from an average,
   * because that is the one the fight is against.
   */
  const updateFleetStrength = (): void => {
    let best = 1;
    for (const record of roster.all()) {
      const growth = roster.growthOf(record.jaegerId);
      best = Math.max(best, (growth.structure + growth.damage) / 2);
    }
    attackDirector.setFleetStrength(best);
  };

  const settleMarket = (): void => {
    const day = worldState.environment.clock.dayNumber;
    if (day <= marketDay) return;
    const elapsed = day - marketDay;
    marketDay = day;
    market.chargeUpkeep(
      roster.all().map((record) => record.chassisId),
      elapsed,
    );
    // Injuries heal and stress falls on the same clock the yards build on.
    for (const line of crew.advanceDays(elapsed, day)) crewNote = line;
    for (const arrival of market.advanceDays(elapsed)) {
      const record = roster.acquire({
        chassisId: arrival.chassisId,
        acquiredBy: "purchase",
        day,
        wear: arrival.wear,
      });
      if (!record) continue;
      roster.record(record.jaegerId, day, "Delivered to the complex.");
      // A new machine is a machine somebody can be put in.
      syncSquadMachines();
      contractsNote =
        `${record.name} (${record.serial}) has arrived` +
        `${arrival.wear > 0 ? ` and needs work before it can go out` : ""}.`;
    }
  };
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
  /**
   * Destruction per region, built on demand from the layout and seeded with
   * whatever that region's strategic record is carrying. This is the detailed
   * model; the record is the summary that survives leaving.
   */
  const destructionByRegion = new Map<string, RegionDestruction>();
  /** Rubble in the world, capped by the quality preset and shared by every fight. */
  const debrisPool = new DebrisPool(quality.maxDebrisBodies);
  /** How wide a blow reaches into the streets around it. */
  const CITY_IMPACT_RADIUS_METERS = 70;
  /** Combat damage is machine-scale; buildings take a multiple of it. */
  const CITY_IMPACT_SCALE = 260;
  /** Blocks whose rubble is still being thrown, so the view redraws them. */
  let debrisDirty = false;
  /**
   * The detailed destruction model for a region.
   *
   * Rebuilt from the region's saved summary the first time it is asked for, so
   * walking back into a city you levelled shows the city you levelled.
   */
  const destructionFor = (regionId: string): RegionDestruction | null => {
    const existing = destructionByRegion.get(regionId);
    if (existing) return existing;
    const layout = layoutFor(regionId);
    if (!layout) return null;
    const destruction = new RegionDestruction({ layout, seed: kernel?.seed ?? 0 });
    const saved = worldState.damageFor(regionId);
    if (saved) destruction.restore(saved);

    // Time passed while nobody was here. Fires burn out, people are pulled out,
    // and any crews already on site keep working: coming back days later shows
    // a city part way through recovering rather than one frozen where you left
    // it, and never one that has quietly reset.
    const record = worldState.recordFor(regionId);
    const elapsedTicks = Math.max(0, (kernel?.tick ?? 0) - (record?.lastVisitedTick ?? 0));
    const hoursAway = (elapsedTicks / DEFAULT_DAY_LENGTH_TICKS) * 24;
    if (hoursAway > 0) {
      destruction.advanceHours(hoursAway);
      const messages = destruction.progressProjects(hoursAway, {
        // A working Shatterdome puts crews and cranes behind the job, and a
        // region nobody has secured is one crews will not stay in.
        facilityBonus: shatterdomeRebuildBonus(),
        security: record?.safetyRating ?? 1,
        funding: Number.POSITIVE_INFINITY,
      });
      for (const message of messages) worldMessages.push(message);
    }

    destructionByRegion.set(regionId, destruction);
    return destruction;
  };

  /**
   * How much faster the rebuild crews work.
   *
   * Read from the complex the player actually built: logistics and fabrication
   * are what put cranes and materials on a site, so tiering them up shows up in
   * a city coming back faster. Nothing is invented; a facility that does not
   * exist contributes nothing.
   */
  const shatterdomeRebuildBonus = (): number => {
    const tiers = shatterdomeState
      .all()
      .filter((facility) => facility.facilityId === "logistics" || facility.facilityId === "manufacture")
      .reduce((total, facility) => total + facility.tier, 0);
    return 1 + tiers * 0.25;
  };

  /** Lines the world panel shows about rebuilding. Newest first, bounded. */
  const worldMessages: string[] = [];

  /**
   * Hours of recovery for the region the player is in.
   *
   * The one path for time passing over a damaged city, used both by the clock
   * skip on the panel and by the catch-up applied when walking back into a
   * region after being away. Fires burn down, people come out, and any crews on
   * site keep working: what a player sees is a city part way through recovering,
   * never one that has quietly reset.
   */
  const advanceRegionHours = (regionId: string, hours: number): void => {
    if (hours <= 0) return;
    const destruction = destructionFor(regionId);
    if (!destruction) return;
    const record = worldState.recordFor(regionId);
    destruction.advanceHours(hours);
    const messages = destruction.progressProjects(hours, {
      facilityBonus: shatterdomeRebuildBonus(),
      security: record?.safetyRating ?? 1,
      funding: Number.POSITIVE_INFINITY,
    });
    for (const message of messages) worldMessages.unshift(message);
    while (worldMessages.length > 4) worldMessages.pop();
    commitDestruction(regionId);
    if (cityView && cityRegionId === regionId) {
      cityView.updateDamage((groupId) => destruction.stateOf(groupId));
    }
  };

  /** Writes the detailed model back onto the strategic record. */
  const commitDestruction = (regionId: string): void => {
    const destruction = destructionByRegion.get(regionId);
    if (!destruction) return;
    worldState.setRegionDamage(regionId, destruction.snapshot(), destruction.report(), kernel?.tick ?? 0);
  };

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
    // Leaving takes the damage with you: the detailed model writes its summary
    // onto the strategic record before the view goes.
    if (cityRegionId) commitDestruction(cityRegionId);
    cityView?.dispose();
    cityView = undefined;
    cityRegionId = null;
    debrisPool.clear();
    debrisDirty = false;
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
    // Building the city also brings its damage back, which is what makes the
    // streets you levelled still levelled when you walk back in.
    const destruction = destructionFor(region.id);
    if (destruction) cityView.updateDamage((groupId) => destruction.stateOf(groupId));
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
    creature = undefined;
    creatureDebug = undefined;
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

    // One growth object for the whole fight, read from the roster rather than
    // recomputed per hit.
    const growth = roster.growthOf(session.jaeger.id, crewMachineBonus());
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
          profile: combatProfileFor(session.jaeger, growth),
          pose: { east: pose.east, north: pose.north, up: pose.up, yawDeg: pose.yawDeg },
          // The machine walks into the fight carrying what it walked out with,
          // and everything its levels and rank are worth.
          zones: jaegerZones(session.jaeger, roster.get(session.jaeger.id)?.damage, undefined, growth),
          layout: jaegerLayout(session.jaeger),
          finisherThreshold: 0.2,
          damageScale: growth.damage,
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

    // The allies. Each is an ordinary fighter with its own zones, its own
    // profile and its own damage: nothing here is invulnerable, and nothing
    // here is a turret. They stand off to the side of the player rather than
    // on top of them.
    allyControllers.clear();
    allyFighters.clear();
    allyIntents = [];
    deployedAllies.forEach((crewId, index) => {
      const record = squad.get(crewId);
      const chassisId = record?.machineId ? roster.get(record.machineId)?.chassisId : undefined;
      const chassis = chassisId ? jaegerRegistry.get(chassisId) : undefined;
      if (!record || !chassis) return;
      const scales = squad.machineScalesOf(crewId);
      const allyGrowth = { ...growth, structure: scales.structure, damage: scales.damage };
      const offset = (index + 1) * 120;
      const fighterId = `ally.${index}`;
      combatArena?.add({
        id: fighterId,
        kind: "jaeger",
        displayName: squad.definition(crewId)?.callsign ?? crewId,
        heightMeters: chassis.locomotion.heightMeters,
        profile: combatProfileFor(chassis, allyGrowth),
        pose: {
          east: pose.east - offset,
          north: pose.north + offset * 0.4,
          up: pose.up,
          yawDeg: pose.yawDeg,
        },
        zones: jaegerZones(chassis, roster.get(record.machineId ?? "")?.damage, undefined, allyGrowth),
        layout: jaegerLayout(chassis),
        finisherThreshold: 0.2,
        damageScale: scales.damage,
      });
      allyFighters.set(crewId, fighterId);
      allyControllers.set(crewId, new AllyController({ crewId, profile: squad.profileOf(crewId) }));
      // They carry what the machine carries. A squad with nothing mounted is a
      // squad that can only punch.
      for (const weapon of weaponRegistry.all()) combatArena?.equipWeapon(fighterId, weapon);
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

    // The creature that is going to fight. Everything about how it behaves
    // comes from its own definition.
    creature = new Creature({
      definition: kaiju,
      east,
      north,
      headingDeg: pose.yawDeg + 180,
      seed: kernel?.seed ?? 0,
    });
    creatureDebug = creature.debug();
    creatureAttackCooldown = 0;

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

  /**
   * One tick of the squad.
   *
   * Every ally is resolved in the same pass so that spacing and body zones are
   * decided against what the others are doing now. What comes out is an intent
   * per ally, and an intent is applied with the same arena calls the player's
   * own input makes: there is no ally-only combat path anywhere.
   */
  const advanceSquad = (
    deltaSeconds: number,
    arena: CombatArena,
    jaegerView: { east: number; north: number },
    kaijuView: { east: number; north: number },
  ): void => {
    if (allyControllers.size === 0) return;
    const snapshot = arena.snapshot();
    const kaijuFighter = snapshot.fighters.find((fighter) => fighter.id === "kaiju");
    const playerFighter = snapshot.fighters.find((fighter) => fighter.id === "jaeger");
    if (!kaijuFighter) return;

    const zoneIds = kaijuFighter.zones.map((zone) => zone.id);
    const positions = new Map(
      snapshot.fighters.map((fighter) => [fighter.id, { east: fighter.east, north: fighter.north }]),
    );
    const playerHealth = fractionOf(playerFighter?.zones ?? []);
    // Only the player is allowed to say what "committed" means: it is their
    // wind-up that opens the window an ally joins.
    const playerCommitted = arena.chargeProgress("jaeger") > 0.35;

    const members: {
      controller: AllyController;
      inputs: Parameters<AllyController["advance"]>[1];
      order: ReturnType<typeof squad.orderOf>;
    }[] = [];

    for (const [crewId, fighterId] of allyFighters) {
      const controller = allyControllers.get(crewId);
      const fighter = snapshot.fighters.find((entry) => entry.id === fighterId);
      if (!controller || !fighter || fighter.defeated) continue;
      const here = { east: fighter.east, north: fighter.north };
      const target = positions.get("kaiju") ?? here;
      const record = squad.get(crewId);
      const anchor = record?.anchor ?? null;

      // Nearest other ally, for spacing.
      let nearestAlly = Number.POSITIVE_INFINITY;
      for (const [otherCrew, otherId] of allyFighters) {
        if (otherCrew === crewId) continue;
        const other = positions.get(otherId);
        if (!other) continue;
        nearestAlly = Math.min(nearestAlly, Math.hypot(other.east - here.east, other.north - here.north));
      }

      // A friendly in the line of fire is a geometry question, answered here
      // rather than guessed: anybody within a narrow corridor between this ally
      // and what it is shooting at counts.
      const friendlyInLine = [...positions.entries()].some(([id, point]) => {
        if (id === fighterId || id === "kaiju") return false;
        return isBetween(here, target, point, 45);
      });

      members.push({
        controller,
        order: squad.orderOf(crewId),
        inputs: {
          situation: {
            targetDistanceMeters: Math.hypot(target.east - here.east, target.north - here.north),
            markedDistanceMeters: Math.hypot(target.east - here.east, target.north - here.north),
            onMarkedTarget: record?.markedTargetId === null || record?.markedTargetId === "kaiju",
            healthFraction: fractionOf(fighter.zones),
            playerHealthFraction: playerHealth,
            playerDistanceMeters: Math.hypot(jaegerView.east - here.east, jaegerView.north - here.north),
            anchorDistanceMeters: anchor
              ? Math.hypot(anchor.east - here.east, anchor.north - here.north)
              : Number.POSITIVE_INFINITY,
            civilianDistanceMeters: Number.POSITIVE_INFINITY,
            ammunitionFraction: ammunitionOf(arena, fighterId),
            friendlyInLine,
            nearestAllyMeters: nearestAlly,
            zoneContested: false,
            routeBlocked: false,
            frustration: 0,
            playerCommitted,
          },
          position: here,
          playerPosition: { east: jaegerView.east, north: jaegerView.north },
          targetPosition: { east: kaijuView.east, north: kaijuView.north },
          markedPosition: { east: kaijuView.east, north: kaijuView.north },
          anchor,
          civilianPosition: null,
          targetZoneIds: zoneIds,
          claimedZones: [],
          signatureWindow: playerCommitted,
        },
      });
    }

    allyIntents = resolveSquadIntents(members, deltaSeconds);
    for (const intent of allyIntents) {
      const fighterId = allyFighters.get(intent.crewId);
      if (!fighterId) continue;
      if (intent.movePoint) {
        arena.moveTo(fighterId, {
          east: intent.movePoint.east,
          north: intent.movePoint.north,
          up: localGroundHeight(intent.movePoint.east, intent.movePoint.north) ?? 0,
          yawDeg: bearingDeg(intent.movePoint, { east: kaijuView.east, north: kaijuView.north }),
        });
      }
      arena.setGuard(fighterId, intent.guard);
      if (intent.targetZoneId) arena.setAim(fighterId, intent.targetZoneId);
      if (intent.fire) {
        const weapon = weaponRegistry.all()[0];
        if (weapon) arena.fireWeapon(fighterId, weapon.id);
      }
      // Which move is a question for the arena, exactly as it is for the
      // player: an order chose the goal, the goal chose the intent, and the
      // move is whatever that intent can actually throw from here.
      const reach = Math.hypot(
        kaijuView.east - (positions.get(fighterId)?.east ?? 0),
        kaijuView.north - (positions.get(fighterId)?.north ?? 0),
      );
      if (reach < 90 && (intent.goal === "engage" || intent.goal === "focus" || intent.goal === "assist")) {
        const move = intent.useSignature ? "melee.heavy.overhead" : "melee.light.jab";
        arena.request(fighterId, move);
      }
    }
  };

  /**
   * The squad, for the heads-up layer.
   *
   * Read live from what each ally last decided and from the arena, so the
   * readout cannot claim an ally is doing something it is not. Null when nobody
   * came out with you, which is what hides the panel entirely.
   */
  const squadPanelState = (): SquadPanelState | null => {
    if (deployedAllies.length === 0) return null;
    const snapshot = combatArena?.snapshot();
    return {
      members: deployedAllies.map((crewId) => {
        const fighterId = allyFighters.get(crewId);
        const fighter = snapshot?.fighters.find((entry) => entry.id === fighterId);
        const intent = allyIntents.find((entry) => entry.crewId === crewId);
        const order = squad.orderOf(crewId);
        const zones = fighter?.zones ?? [];
        return {
          crewId,
          callsign: squad.definition(crewId)?.callsign ?? crewId,
          doing: intent ? `${intent.goal}, ${intent.reason}` : "standing by",
          order: order?.displayName ?? "none",
          integrityPercent: Math.round(fractionOf(zones) * 100),
          down: fighter?.defeated === true,
        };
      }),
      orders: squad
        .orderRegistry()
        .all()
        .map((entry) => ({ id: entry.id, label: entry.displayName, hotkey: entry.hotkey })),
      dialOpen: orderDialOpen,
      log: [...squadLog],
    };
  };

  /** 0 to 1 of a fighter's structure left, across every zone it has. */
  const fractionOf = (zones: readonly { health: number; maxHealth: number }[]): number => {
    if (zones.length === 0) return 1;
    let health = 0;
    let max = 0;
    for (const zone of zones) {
      health += zone.health;
      max += zone.maxHealth;
    }
    return max > 0 ? health / max : 1;
  };

  /** 0 to 1 of the rounds a fighter is carrying, across everything mounted. */
  const ammunitionOf = (arena: CombatArena, fighterId: string): number => {
    let loaded = 0;
    let capacity = 0;
    for (const weapon of weaponRegistry.all()) {
      const state = arena.weaponState(fighterId, weapon.id);
      if (!state) continue;
      loaded += state.magazine + state.reserve;
      capacity += weapon.magazine + weapon.reserve;
    }
    return capacity > 0 ? Math.max(0, Math.min(1, loaded / capacity)) : 0;
  };

  /** Whether a point sits inside a corridor between two others. */
  const isBetween = (
    from: { east: number; north: number },
    to: { east: number; north: number },
    point: { east: number; north: number },
    corridorMeters: number,
  ): boolean => {
    const dx = to.east - from.east;
    const dy = to.north - from.north;
    const length = Math.hypot(dx, dy);
    if (length < 1) return false;
    const t = ((point.east - from.east) * dx + (point.north - from.north) * dy) / (length * length);
    if (t <= 0 || t >= 1) return false;
    const closestEast = from.east + dx * t;
    const closestNorth = from.north + dy * t;
    return Math.hypot(point.east - closestEast, point.north - closestNorth) < corridorMeters;
  };

  const bearingDeg = (from: { east: number; north: number }, to: { east: number; north: number }): number => {
    const degrees = (Math.atan2(to.east - from.east, to.north - from.north) * 180) / Math.PI;
    return (degrees + 360) % 360;
  };

  /**
   * Gives the whole squad an order, from the quick command.
   *
   * Nothing pauses. The order is banked, every ally answers, and the next tick
   * is scored against the new weights.
   */
  const issueSquadOrder = (orderId: SquadOrderId): void => {
    if (deployedAllies.length === 0) {
      sayFromSquad("Nobody is out there with you.");
      return;
    }
    const here = pilotSession
      ? { east: pilotSession.pose.east, north: pilotSession.pose.north }
      : { east: 0, north: 0 };
    for (const line of squad.issueAll(orderId, {
      crewIds: deployedAllies,
      targetId: "kaiju",
      anchor: here,
    })) {
      sayFromSquad(line);
    }
    // A new order means the moment for a signature has passed with the old one.
    for (const controller of allyControllers.values()) controller.clearSignature();
    refreshPilot();
  };

  /** The creature currently in the fight, if there is one. */
  let creature: Creature | undefined;
  /** The last thing it decided, for the panel. */
  let creatureDebug: CreatureDebug | undefined;
  /** How long since it last threw something, in combat ticks. */
  let creatureAttackCooldown = 0;

  /**
   * One tick of a creature being alive inside a fight.
   *
   * The senses are fed from where the machine actually is, the goal comes out
   * of the behaviour engine, navigation moves the body, and an attack is thrown
   * only when the thing it wants is close enough to hit. The arena stays
   * authoritative: this decides what to press, never what happens.
   */
  const driveCreature = (arena: CombatArena, deltaSeconds: number): void => {
    if (!creature) return;
    const snapshot = arena.snapshot();
    const kaijuView = snapshot.fighters.find((fighter) => fighter.id === "kaiju");
    const jaegerView = snapshot.fighters.find((fighter) => fighter.id === "jaeger");
    if (!kaijuView || !jaegerView) return;

    creature.east = kaijuView.east;
    creature.north = kaijuView.north;
    creature.headingDeg = kaijuView.yawDeg;
    const lethal = kaijuView.zones.find((zone) => zone.id === "core") ?? kaijuView.zones[0];
    creature.healthFraction = lethal ? lethal.health / Math.max(1, lethal.maxHealth) : 1;

    const destruction = cityRegionId ? destructionByRegion.get(cityRegionId) : undefined;
    const region = cityRegionId ? regionRegistry.get(cityRegionId) : undefined;
    const world: NavigationQuery = {
      groundHeight: (east, north) => localGroundHeight(east, north),
      waterDepth: (east, north) => {
        const ground = localGroundHeight(east, north);
        return ground === null ? 0 : Math.max(0, -ground);
      },
      isPassable: (east, north) => {
        if (!destruction || !region) return true;
        const geo = localToGeo(floatingOrigin.anchor, { east, north, up: 0 });
        const inCity = geoToLocal(region.centre, geo);
        return destruction.isPassable(inCity.east, inCity.north);
      },
      // Towers are what there is to climb, and a levelled block is not one.
      climbableHeight: (east, north) => {
        if (!destruction || !region) return 0;
        const geo = localToGeo(floatingOrigin.anchor, { east, north, up: 0 });
        const inCity = geoToLocal(region.centre, geo);
        return destruction.isPassable(inCity.east, inCity.north) ? 0 : 60;
      },
    };

    const inWater = (localGroundHeight(kaijuView.east, kaijuView.north) ?? 0) < 0;
    creatureDebug = creature.advance(deltaSeconds, {
      stimuli: [
        { sourceId: "jaeger", east: jaegerView.east, north: jaegerView.north, strength: 1, kind: "sight" },
        { sourceId: "jaeger", east: jaegerView.east, north: jaegerView.north, strength: 0.9, kind: "sound" },
        {
          sourceId: "jaeger",
          east: jaegerView.east,
          north: jaegerView.north,
          strength: 1.1,
          kind: "vibration",
          inWater,
        },
      ],
      world,
      // The Shatterdome is what it came for, which is why it is walking through
      // the city rather than standing in a field.
      objective: shatterdomeObjective(),
      food: null,
      waterNearby: (localGroundHeight(kaijuView.east, kaijuView.north + 200) ?? 0) < 0,
      climbableNearby: world.climbableHeight(kaijuView.east + 120, kaijuView.north) > 0,
      hideSpot: null,
    });

    advanceSquad(deltaSeconds, arena, jaegerView, kaijuView);

    // Where the body wants to be is where the arena is told to put it.
    arena.moveTo("kaiju", {
      east: creature.east,
      north: creature.north,
      // Height comes from the ground it is standing on, which is the one thing
      // about where it is that the creature does not decide.
      up: localGroundHeight(creature.east, creature.north) ?? 0,
      yawDeg: creature.headingDeg,
    });

    if (creatureAttackCooldown > 0) {
      creatureAttackCooldown -= 1;
      return;
    }
    const reach = Math.hypot(jaegerView.east - creature.east, jaegerView.north - creature.north);
    const wantsToFight = creatureDebug.goal !== "retreat" && creatureDebug.goal !== "destroy-objective";
    if (reach > 90 || !wantsToFight) return;
    // Which attack is a matter of what this creature can still do: an ability
    // lost with an organ or a limb is not on the menu.
    const move = creature.can("ability.tail-sweep") && reach > 45 ? "kaiju.tail.sweep" : "kaiju.claw.swipe";
    const request = arena.request("kaiju", move);
    if (request.ok) {
      arena.press("kaiju", move);
      creatureAttackCooldown = 180;
    }
  };

  /** Where the complex is, in the local frame, or null when it is not loaded. */
  const shatterdomeObjective = (): { east: number; north: number } | null => {
    const regionId = cityRegionId;
    const layout = regionId ? cityLayouts.get(regionId) : undefined;
    const region = regionId ? regionRegistry.get(regionId) : undefined;
    if (!layout || !region) return null;
    const pad = layout.defensePositions.find((entry) => entry.kind === "jaeger-pad");
    if (!pad) return null;
    const geo = localToGeo(region.centre, { east: pad.east, north: pad.north, up: 0 });
    return floatingOrigin.toLocal(geo);
  };

  /**
   * Answers an incident without flying to it.
   *
   * The strategic model decides what happened and hands back every contribution
   * that went into it; the region takes the damage and the alert drops back to
   * recovery. Nothing about the result is written in advance.
   */
  const resolveIncident = (incidentId: string, kind: "ai-defended" | "ignored"): void => {
    const incident = attackDirector.incident(incidentId);
    if (!incident) return;
    const resolution = attackDirector.resolve(incident, kind);
    resolutionLog.unshift(resolution);
    while (resolutionLog.length > 5) resolutionLog.pop();

    // The city takes the damage the model says it took, through the same
    // regional record everything else writes to.
    if (resolution.integrityLost > 0) {
      worldState.applyRegionDamage(resolution.regionId, resolution.integrityLost, kernel?.tick ?? 0);
    }
    worldState.setRegionAlert(resolution.regionId, "recovery", kernel?.tick ?? 0);
    directorNotice = resolution.summary;
    refreshWorld();
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
      // Armour plates and organs are the creature's own layers, sitting inside
      // the zone the arena already resolved. The arena stays authoritative for
      // zone health; this erodes what is bolted to it and says what was lost.
      if (event.type === "hit" && event.targetId === "kaiju" && creature && event.zoneId) {
        const outcome = creature.absorb(
          event.zoneId as BodyZoneId,
          event.damage,
          event.damageKind ?? "impact",
        );
        for (const note of outcome.notes) pushCombatLine(note);
      }
      if (event.type === "zone-destroyed" && event.actorId === "kaiju" && creature && event.zoneId) {
        const severed = creature.sever(event.zoneId as BodyZoneId);
        if (severed) pushCombatLine(severed);
      }
      // A fight in a city is a fight in a city. Anything landing hard enough,
      // wherever it lands, goes into the streets around it: this is the only
      // place combat reaches the world, and it reaches it through the same
      // impact call a scripted event would use.
      if ((event.type === "hit" || event.type === "zone-destroyed") && event.contact) {
        const regionId = cityRegionId;
        const destruction = regionId ? destructionFor(regionId) : null;
        const region = regionId ? regionRegistry.get(regionId) : undefined;
        if (destruction && region && event.damage > 0) {
          // Combat and the city use different frames: combat is local to the
          // floating origin, the city is local to the region centre.
          const geo = localToGeo(floatingOrigin.anchor, {
            east: event.contact.east,
            north: event.contact.north,
            up: 0,
          });
          const inCity = geoToLocal(region.centre, geo);
          const impact = destruction.applyImpact(
            inCity.east,
            inCity.north,
            CITY_IMPACT_RADIUS_METERS,
            event.damage * CITY_IMPACT_SCALE,
          );
          if (impact.structuresDowned > 0) {
            pushCombatLine(impact.message);
            const wanted = Math.min(impact.debrisSpawned, MAX_CHUNKS_PER_COLLAPSE);
            const groupId = impact.groupsHit[0] ?? "unknown";
            debrisPool.spawn({
              east: event.contact.east,
              north: event.contact.north,
              up: Math.max(event.contact.up, localGroundHeight(event.contact.east, event.contact.north) ?? 0),
              groupId,
              count: wanted,
              spreadMeters: CITY_IMPACT_RADIUS_METERS,
              sizeMeters: 5,
              rng: debrisStream((kernel?.seed ?? 0) + event.tick, groupId),
            });
            debrisDirty = true;
          }
        }
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
      // The AI debug view: the same numbers the creature acted on, never a
      // second copy kept for display.
      creature: creatureDebug
        ? {
            goal: creatureDebug.goal,
            goalReason: creatureDebug.goalReason,
            considered: creatureDebug.considered.map((entry) => ({
              goal: entry.goal,
              score: entry.score,
              reason: entry.reason,
            })),
            contacts: creatureDebug.contacts.map((contact) => ({
              sourceId: contact.sourceId,
              kind: contact.kind,
              confidence: contact.confidence,
              distanceMeters: contact.distanceMeters,
            })),
            medium: creatureDebug.medium,
            navOutcome: creatureDebug.navOutcome,
            navReason: creatureDebug.navReason,
            speedMps: creatureDebug.speedMps,
            phase: creatureDebug.phase,
            abilities: creatureDebug.abilities,
            severed: creatureDebug.severed,
            organs: creatureDebug.organsLeft.map((organ) => ({
              id: organ.id,
              fraction: organ.fraction,
            })),
          }
        : null,
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
    crew.deploy(assignedPilots);
    deployedAllies = mission?.plan.allyIds ?? availableAllies();
    pilotSession = new PilotSession({
      jaeger: damagedJaeger,
      east: local.east,
      north: local.north,
      // Stand on the terrain if it is loaded, and on the last known altitude if
      // it is not, rather than dropping the machine to sea level.
      up: ground ?? worldState.playerPosition.altitudeMeters,
      headingDeg: 0,
      // Mobility growth reaches the controller the same way damage penalties do.
      growth: roster.growthOf(jaeger.id, crewMachineBonus()),
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
      onOrderDial: () => {
        orderDialOpen = !orderDialOpen;
        refreshPilot();
      },
      // A digit is an order while the dial is open and a weapon otherwise, so
      // the number row keeps doing what it always did when nobody is commanding.
      onNumberKey: (code: string) => {
        if (orderDialOpen) {
          const hotkey = code.slice(5);
          const order = squad
            .orderRegistry()
            .all()
            .find((entry) => entry.hotkey === hotkey);
          if (order) {
            issueSquadOrder(order.id);
            return;
          }
        }
        pressWeapon(code);
      },
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
        onSquadOrder: (orderId: string) => issueSquadOrder(orderId as SquadOrderId),
        onToggleOrderDial: () => {
          orderDialOpen = !orderDialOpen;
          refreshPilot();
        },
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
      squad: squadPanelState(),
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
      // The creature decides for itself: it senses the machine, picks a goal,
      // works out how to get where that goal wants it, and attacks when it is
      // close enough. Nothing here knows which creature it is.
      driveCreature(arena, COMBAT_TICK_SECONDS);
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
      war: warReadout(),
    });
    globeView?.refresh();
  };

  /**
   * Flattens the war for the panel.
   *
   * Every number here comes from the director, including the forecast of doing
   * nothing, which is the same model that will resolve it. The panel cannot
   * show a war the simulation does not agree with.
   */
  const warReadout = (): WarReadout => {
    const tick = kernel?.tick ?? 0;
    const dayTicks = worldState.environment.clock.dayLengthTicks;
    const toHours = (ticks: number): number => (ticks / dayTicks) * 24;
    const alerts = attackDirector
      .active()
      .concat(attackDirector.incidents().filter((incident) => incident.status === "landed"))
      .map((incident) => {
        // Travel time is the real distance from where the player is standing.
        const region = regionRegistry.get(incident.regionId);
        const distance = region ? surfaceDistanceMeters(worldState.playerPosition, region.centre) : 0;
        const travelTicks = Math.round((distance / EARTH_SCALE / CARRIER_SPEED_MPS) * TICKS_PER_SECOND);
        const forecast = attackDirector.forecast(incident, tick, travelTicks);
        return {
          incidentId: incident.id,
          regionName: forecast.regionName,
          status: incident.status,
          hoursToArrival: toHours(forecast.ticksToArrival),
          travelHours: toHours(travelTicks),
          reachable: forecast.reachable,
          confidencePercent: Math.round(forecast.warningConfidence * 100),
          composition: forecast.composition,
          tells: forecast.tells,
          objective: forecast.objective,
          secondaryObjectives: forecast.secondaryObjectives,
          ifIgnored: forecast.ignoredForecast.summary,
          ifIgnoredLedger: forecast.ignoredForecast.ledger.map(
            (line) => `${line.label}: ${Math.round(line.value * 100) / 100} (${line.reason})`,
          ),
          readiness: (() => {
            const report = readinessFor(incident.id);
            if (!report) return null;
            return {
              percent: Math.round(report.readiness * 100),
              driftPercent: Math.round(report.driftStrength * 100),
              machinePercent: Math.round(report.machineIntegrity * 100),
              travelHours: report.travelSeconds / 3_600,
              loadPercent: Math.round(report.logisticsLoad * 100),
              weather: report.weather,
              predictedThreat: report.predictedThreat,
              refusals: report.refusals,
              warnings: report.warnings,
              crew: (planFor(incident.id)?.pilotIds ?? []).map((id) => {
                const pilot = pilotRegistry.get(id);
                const record = crew.get(id);
                const carrying = record && record.injuries.length > 0 ? ", hurt" : "";
                return `${pilot?.callsign ?? id}${carrying}`;
              }),
              // Shown whether or not it is biting, because a drawback the player
              // only learns about from the result is a trap, not a decision.
              drawbacks: report.drawbacks.map((entry) => ({
                text: entry.firing
                  ? `${entry.pilotName}: ${entry.drawback.displayName}. ${entry.drawback.description}`
                  : `${entry.pilotName}: ${entry.drawback.displayName} does not apply here.`,
                firing: entry.firing,
              })),
            };
          })(),
        };
      });

    return {
      escalationPercent: Math.round(attackDirector.escalation * 100),
      breachPressurePercent: Math.round(attackDirector.breachPressure * 100),
      crisisFrequency: attackDirector.crisisFrequency,
      alerts,
      resolutions: resolutionLog.map((resolution) => ({
        summary: resolution.summary,
        ledger: resolution.ledger.map(
          (line) => `${line.label}: ${Math.round(line.value * 100) / 100} (${line.reason})`,
        ),
      })),
      notice: directorNotice,
      sortie: mission
        ? {
            phase: mission.phase,
            regionName: regionRegistry.get(mission.regionId)?.displayName ?? mission.regionId,
            carrierPercent: Math.round(mission.carrierProgress * 100),
            objectives: mission.objectives.map((objective) => ({
              name: objectiveRegistry.get(objective.id)?.displayName ?? objective.id,
              state: objective.state,
              detail: `${Math.round(objective.progress * 100)}%`,
            })),
          }
        : null,
      results: missionResults
        ? {
            outcome: missionResults.outcome,
            summary: missionResults.summary,
            ledger: missionResults.ledger.map(
              (line) => `${line.label}: ${Math.round(line.value * 100) / 100} (${line.reason})`,
            ),
          }
        : null,
    };
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

    // Destruction, from the detailed model while the player is standing in the
    // city and from the region's own saved summary while they are not.
    const destruction = regionId ? destructionByRegion.get(regionId) : undefined;
    const report = destruction?.report() ?? null;
    const projects = destruction?.activeProjects() ?? [];
    const worst = destruction
      ? [...destruction.groups()]
          .filter((group) => group.structuresDown > 0)
          .sort((a, b) => a.integrity - b.integrity)[0]
      : undefined;
    const quote = worst && destruction ? destruction.quoteProject(worst.groupId) : null;

    return {
      damageSummary: report?.summary ?? "No detailed record here yet.",
      safetyRating: report?.safety ?? record.safetyRating,
      blocksDamaged: report?.groupsDamaged ?? 0,
      blocksRuined: report?.groupsRuined ?? 0,
      firesBurning: report?.firesBurning ?? 0,
      contaminatedBlocks: report?.contaminatedGroups ?? 0,
      routesBlockedFraction: report?.routesBlocked ?? 0,
      trappedThousands: report?.trappedThousands ?? 0,
      rescuePressure: report?.rescuePressure ?? 0,
      debrisLive: debrisPool.live,
      debrisCapacity: debrisPool.capacity,
      debrisFrozen: debrisPool.frozen,
      rebuildSummary:
        projects.length === 0
          ? (worldMessages[0] ?? "Nothing under way.")
          : projects
              .map(
                (project) =>
                  `${project.phase} ${destruction?.describeGroup(project.groupId) ?? project.groupId}, ` +
                  `${Math.round(project.hoursRemaining)} h left`,
              )
              .join(" · "),
      worstBlockId: worst?.groupId ?? null,
      worstBlockLabel: worst && destruction ? destruction.describeGroup(worst.groupId) : null,
      rebuildQuote: quote
        ? `${quote.hours} hours, ${quote.funding.toLocaleString("en-GB")} in funding`
        : null,
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
          // Time passing over a damaged city is time the city spends recovering,
          // and time the war spends happening.
          const regionId = worldState.activeRegionId;
          if (regionId) advanceRegionHours(regionId, hours);
          updateFleetStrength();
          advanceWar(ticks);
          // Skipped time is still time the yards were building and the pad was
          // costing money.
          settleMarket();
          refreshWorld();
        },
        onDiveToggle: () => {
          diving = !diving;
          refreshWorld();
        },
        onQualityChange: (level: string) => applyQuality(level as QualityLevel),
        onResolveIncident: (incidentId: string, kind: "ai-defended" | "ignored") => {
          resolveIncident(incidentId, kind);
        },
        onDeploy: (incidentId: string) => {
          deployTo(incidentId);
        },
        onSkipCarrier: () => {
          mission?.skipCarrier();
          if (mission?.phase === "active") beginSortieOnTheGround();
          refreshWorld();
        },
        onAbortMission: () => {
          // An abort keeps whatever the sortie already achieved.
          endMission("aborted");
        },
        onCloseResults: () => {
          missionResults = null;
          refreshWorld();
        },
        onCrisisFrequency: (value: number) => {
          // The player's own dial. Bounded by the director, not by the panel.
          attackDirector.setCrisisFrequency(value);
          refreshWorld();
        },
        onRebuild: (groupId: string) => {
          const regionId = worldState.activeRegionId;
          const destruction = regionId ? destructionFor(regionId) : null;
          if (!destruction) return;
          const outcome = destruction.startProject(groupId);
          // Refusals are shown rather than swallowed: still burning, already
          // under way, or nothing to clear.
          worldMessages.unshift(outcome.message);
          while (worldMessages.length > 4) worldMessages.pop();
          if (regionId) commitDestruction(regionId);
          refreshWorld();
        },
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
        const destruction = cityRegionId ? destructionByRegion.get(cityRegionId) : undefined;
        if (destruction) {
          // Collapses finish on the fight clock, and the rubble keeps falling.
          const frameSeconds = Math.min(0.1, deltaMs / 1000);
          destruction.advanceSeconds(frameSeconds);
          debrisPool.advance(frameSeconds, (east, north) => localGroundHeight(east, north));
          cityView.updateDamage((groupId) => destruction.stateOf(groupId));
          if (debrisPool.live > 0 || debrisDirty) {
            cityView.updateDebris(
              debrisPool.active().map((chunk) => ({
                east: chunk.east,
                north: chunk.north,
                up: chunk.up,
                yawRadians: chunk.yawRadians,
                sizeMeters: chunk.sizeMeters,
              })),
            );
            debrisDirty = debrisPool.live > 0;
          }
        }
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
      progression: progressionPanelFor(jaegerId),
      crew: crewPanelFor(jaegerId),
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

  /**
   * What a machine has earned, for its berth.
   *
   * Every figure is read from the roster and the progression maths rather than
   * cached here, so the panel cannot drift from what the fight will actually
   * use. Returns null for an empty berth.
   */
  const progressionPanelFor = (jaegerId: string | null): ProgressionPanelState | null => {
    if (!jaegerId) return null;
    const record = roster.get(jaegerId);
    if (!record) return null;

    const growth = roster.growthOf(jaegerId);
    const state = levelFromExperience(record.experience, record.prestige);
    const forecast = roster.prestigeForecast(jaegerId);
    const choice = roster.passiveChoices(jaegerId);
    const upcoming = nextUnlock(record.level);
    const goals = masteryProgress(masteryRegistry, record.mastery);

    return {
      level: record.level,
      levelCap: LEVEL_CAP,
      prestige: record.prestige,
      experienceInto: state.into,
      experienceNeeded: state.needed,
      growthLines: [
        `Structure ${growth.structure.toFixed(2)}x`,
        `Damage ${growth.damage.toFixed(2)}x`,
        `Heat ${growth.heat.toFixed(2)}x`,
        `Mobility ${growth.mobility.toFixed(2)}x`,
      ],
      nextUnlock: upcoming
        ? `level ${upcoming.level}` +
          (upcoming.moves.length > 0 ? `, ${upcoming.moves.join(" and ")}` : "") +
          (upcoming.opensPassiveChoice ? ", a passive to choose" : "") +
          (upcoming.opensModuleSlot ? ", a module slot" : "")
        : null,
      moves: roster.movesFor(jaegerId),
      passives: record.passives.map((id) => passiveRegistry.get(id)?.displayName ?? id),
      passiveChoice:
        choice.tier === null
          ? null
          : {
              tier: choice.tier,
              options: choice.options.map((option) => ({
                id: option.id,
                name: option.displayName,
                effect: option.description,
                tradeoff: option.tradeoff,
              })),
            },
      canRespec: record.passives.length > 0 && record.status === "ready",
      moduleSummary: `Modules: ${record.modules.length} of ${growth.moduleSlots} slots filled.`,
      modules: roster.moduleOptions(jaegerId).map((entry) => ({
        id: entry.module.id,
        name: entry.module.displayName,
        effect: entry.module.description,
        tradeoff: entry.module.tradeoff,
        fitted: entry.fitted,
        stored: entry.stored,
        refusal: entry.refusal,
      })),
      masteries: goals.map((goal) => ({
        name: goal.displayName,
        detail:
          goal.nextThreshold === null
            ? `${goal.value} and finished.`
            : `${goal.value} of ${goal.nextThreshold}. ${goal.description}`,
        rank: goal.rank,
        maxRank: goal.maxRank,
        progress: goal.progress,
      })),
      prestigeSummary: forecast.summary,
      prestigeRefusal: forecast.eligible
        ? record.status === "ready"
          ? null
          : `It is ${describeStatus(record.status)}, and this is bay work.`
        : forecast.refusal,
      note: progressionNote,
      log: [...progressionLog],
    };
  };

  /**
   * Who flies this machine, for its berth.
   *
   * Everything is read live from the crew and from the drift calculation the
   * planner uses, so what is shown here and what the sortie gets cannot drift
   * apart. Returns null for an empty berth.
   */
  const crewPanelFor = (jaegerId: string | null): CrewPanelState | null => {
    if (!jaegerId) return null;
    const record = roster.get(jaegerId);
    if (!record) return null;

    const [firstId, secondId] = assignedPilots;
    const context = driftContextFor(jaegerId, assignedPilots);
    const assessment = assessDrift(
      pilotRegistry.get(firstId ?? ""),
      pilotRegistry.get(secondId ?? ""),
      context,
    );
    const linkLevel = firstId && secondId ? crew.linkLevel(firstId, secondId) : 0;

    return {
      summary:
        `${assessment.summary} Effectiveness ${Math.round(assessment.effectiveness * 100)} percent` +
        ` in a ${jaegerRegistry.get(record.chassisId)?.role ?? "machine"}.`,
      factors: assessment.factors.map(
        (factor) => `${factor.label} ${factor.delta >= 0 ? "+" : ""}${Math.round(factor.delta * 100)}`,
      ),
      rows: pilotRegistry.all().map((pilot) => {
        const crewRecord = crew.get(pilot.id);
        const assigned = assignedPilots.includes(pilot.id);
        const clearance = crew.canDeploy(pilot.id);
        const restrictions = crew.restrictionsOf(pilot.id);
        const rank = currentPerkRank(pilot, assigned ? linkLevel : crew.linkLevel(pilot.id, firstId ?? ""));
        const report = assessment.drawbacks.find((entry) => entry.pilotId === pilot.id);
        return {
          pilotId: pilot.id,
          name: pilot.name,
          callsign: pilot.callsign,
          assigned,
          linkLevel: assigned ? linkLevel : crew.linkLevel(pilot.id, firstId ?? ""),
          linkProgress: (() => {
            const partner = assigned ? (pilot.id === firstId ? secondId : firstId) : firstId;
            const track = partner ? crew.linkTrack(pilot.id, partner) : undefined;
            const banked = (track?.experience ?? 0) % LINK_EXPERIENCE_PER_LEVEL;
            return `${banked} of ${LINK_EXPERIENCE_PER_LEVEL} to the next`;
          })(),
          condition:
            `${crewRecord?.status ?? "ready"} · stress ${Math.round((crewRecord?.stress ?? 0) * 100)}%` +
            (restrictions.length > 0 ? ` · ${restrictions.join(", ")}` : "") +
            ` · ${crewRecord?.sorties ?? 0} sorties`,
          perk: rank
            ? `${pilot.perk.displayName}: ${rank.note}`
            : `${pilot.perk.displayName} arrives at link ${pilot.perk.ranks[0]?.linkLevel ?? 1}.`,
          drawback: report
            ? report.firing
              ? `${pilot.drawback.displayName}: applies here. ${pilot.drawback.description}`
              : `${pilot.drawback.displayName}: does not apply here.`
            : `${pilot.drawback.displayName}. ${pilot.drawback.description}`,
          drawbackFiring: report?.firing === true,
          refusal: assigned ? "Already in the Conn-Pod." : clearance.ok ? null : clearance.message,
          treatable: (crewRecord?.injuries ?? [])
            .filter((injury) => !injury.treated && injury.injuryId !== "rest")
            .map((injury) => injury.injuryId),
        };
      }),
      note: crewNote,
    };
  };

  /** Reopens a berth on the machine standing in it, after something changed. */
  const reopenBerth = (jaegerId: string): void => {
    if (!session) return;
    openInteriorPanel(berthPanelFor(session, jaegerId, roster.definition(jaegerId).name));
  };

  /**
   * The contracts board.
   *
   * Every figure is read from the market: what is on offer, what it costs to
   * buy and to keep, how long the yard says it will take, and the terms of the
   * contract. Bands rather than a power score, because a machine that is good
   * at one thing and poor at another cannot be honestly reduced to one number.
   */
  const marketPanelFor = (): ShatterdomePanelState => {
    const owned = roster.all();
    const upkeep = owned.reduce(
      (total, record) => total + (jaegerRegistry.get(record.chassisId)?.upkeepPerDay ?? 0),
      0,
    );
    const rows: MarketOfferRow[] = [];
    for (const offer of market.offers()) {
      const preview = market.preview(offer.id);
      if (!preview) continue;
      rows.push({
        id: offer.id,
        name: preview.chassisName,
        maker: preview.manufacturerName,
        summary:
          `${preview.mark} ${preview.role} · ${preview.condition}` +
          `${preview.wearPercent > 0 ? ` (${preview.wearPercent}% worn)` : ""} · ${preview.homeRegion}`,
        priceText: formatMoney(preview.price),
        termsText:
          `${preview.leadTimeDays} days to deliver · ${formatMoney(preview.upkeepPerDay)} a day to keep · ` +
          `${preview.signatureEquipment.length} weapon${preview.signatureEquipment.length === 1 ? "" : "s"} fitted · ` +
          `${preview.upgradeTracks.length} upgrade tracks`,
        bands: preview.bands.map((band) => ({ label: band.label, low: band.low, high: band.high })),
        tradeoff: preview.tradeoff,
        conditions: preview.conditions,
        equipment: preview.signatureEquipment.join(", "),
        upgrades: preview.upgradeTracks.join(", "),
        refusal: preview.affordable
          ? null
          : `Short by ${formatMoney(preview.price - market.treasury.funding)}.`,
      });
    }
    return {
      kind: "market",
      title: "Contracts terminal",
      summary:
        `${formatMoney(market.treasury.funding)} on hand · ` +
        `${formatMoney(upkeep)} a day upkeep on ${owned.length} machine${owned.length === 1 ? "" : "s"} · ` +
        `${Math.round(market.treasury.salvageTons)} t salvage · ` +
        `board turns in ${market.daysUntilRotation} of ${ROTATION_DAYS} days`,
      rows,
      pending: market.pending().map((order) => {
        const chassis = jaegerRegistry.get(order.chassisId);
        return (
          `${chassis?.name ?? order.chassisId} from ` +
          `${manufacturerRegistry.get(order.manufacturerId)?.displayName ?? order.manufacturerId}, ` +
          `${order.daysRemaining} day${order.daysRemaining === 1 ? "" : "s"} out`
        );
      }),
      fleet: owned.map((record) => `${record.name} (${record.serial})`),
      note: contractsNote,
    };
  };

  /** Signs for a machine. The refusal is the message, never a silent no-op. */
  const purchaseOffer = (offerId: string): void => {
    const result = market.purchase(offerId);
    if (result.ok && result.delivery) {
      const chassis = jaegerRegistry.get(result.delivery.chassisId);
      contractsNote =
        `Signed for ${chassis?.name ?? result.delivery.chassisId}. ` +
        `It arrives in ${result.delivery.daysRemaining} days.`;
    } else {
      contractsNote = result.message;
    }
    openInteriorPanel(marketPanelFor());
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
        // The contracts office is where machines are bought. Every other
        // terminal is still the construction board.
        if (!outcome.connPod && outcome.facilityId === "contract") {
          openInteriorPanel(marketPanelFor());
          break;
        }
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
      onPurchase: (offerId) => purchaseOffer(offerId),
      onChoosePassive: (jaegerId, passiveId) => {
        progressionNote = roster.choosePassive(
          jaegerId,
          passiveId,
          worldState.environment.clock.dayNumber,
        ).message;
        reopenBerth(jaegerId);
      },
      onRespec: (jaegerId) => {
        progressionNote = roster.respecPassives(jaegerId, worldState.environment.clock.dayNumber).message;
        reopenBerth(jaegerId);
      },
      onFitModule: (jaegerId, moduleId) => {
        const day = worldState.environment.clock.dayNumber;
        const module = roster.moduleOptions(jaegerId).find((entry) => entry.module.id === moduleId);
        // Money first, so a machine is never taken apart for something that
        // then turns out to be unaffordable.
        const paid = market.spend(module?.module.cost ?? 0, module?.module.displayName ?? moduleId);
        if (!paid.ok) {
          progressionNote = paid.message;
          reopenBerth(jaegerId);
          return;
        }
        const result = roster.fitModule(jaegerId, moduleId, day);
        // The bay refusing after the money left would be theft, so it goes back.
        if (!result.ok) market.credit(module?.module.cost ?? 0);
        progressionNote = result.message;
        reopenBerth(jaegerId);
      },
      onRemoveModule: (jaegerId, moduleId) => {
        progressionNote = roster.removeModule(
          jaegerId,
          moduleId,
          worldState.environment.clock.dayNumber,
        ).message;
        reopenBerth(jaegerId);
      },
      onAssignPilot: (pilotId) => {
        const clearance = crew.canDeploy(pilotId);
        if (!clearance.ok) {
          crewNote = clearance.message;
        } else if (assignedPilots.includes(pilotId)) {
          crewNote = "Already in the Conn-Pod.";
        } else {
          // The newest assignment takes the first seat and pushes the other
          // along, so two clicks swap the whole pair rather than fighting over
          // one seat.
          const kept = assignedPilots.filter((id) => id !== pilotId)[0];
          assignedPilots = kept ? [pilotId, kept] : [pilotId];
          const partner = pilotRegistry.get(kept ?? "");
          crewNote = `${pilotRegistry.get(pilotId)?.name ?? pilotId} takes the Conn-Pod${partner ? ` with ${partner.name}` : ""}.`;
        }
        refreshShatterdome();
        if (interiorPanel?.kind === "berth" && interiorPanel.jaegerId) reopenBerth(interiorPanel.jaegerId);
      },
      onTalkToPilot: (pilotId) => {
        const partner = assignedPilots.find((id) => id !== pilotId) ?? assignedPilots[0];
        if (!partner || partner === pilotId) {
          crewNote = "Nobody to talk to about.";
        } else {
          const day = worldState.environment.clock.dayNumber;
          const result = crew.converse(pilotId, partner, day);
          crewNote = result.ok ? `"${result.line}" ${result.message}` : `"${result.line}" ${result.message}`;
        }
        if (interiorPanel?.kind === "berth" && interiorPanel.jaegerId) reopenBerth(interiorPanel.jaegerId);
      },
      onTreatPilot: (pilotId, injuryId) => {
        crewNote = crew.treat(pilotId, injuryId, worldState.environment.clock.dayNumber).message;
        if (interiorPanel?.kind === "berth" && interiorPanel.jaegerId) reopenBerth(interiorPanel.jaegerId);
      },
      onStandDownPilot: (pilotId) => {
        crewNote = crew.assignRecovery(pilotId, 3, worldState.environment.clock.dayNumber).message;
        if (interiorPanel?.kind === "berth" && interiorPanel.jaegerId) reopenBerth(interiorPanel.jaegerId);
      },
      onPrestige: (jaegerId) => {
        progressionNote = roster.prestige(jaegerId, worldState.environment.clock.dayNumber).message;
        reopenBerth(jaegerId);
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
