import { Tools, Vector3, type Scene } from "@babylonjs/core";
import { createEngineAdapter } from "../engine/engineAdapter";
import { buildBootScene, type BootScene } from "../engine/scene";
import { DebugOverlay } from "../debug/overlay";
import { SimulationKernel } from "../simulation/kernel";
import { SimulationLoop } from "../simulation/loop";
import { resolveSeed } from "./config";
import { AppState, AppStateMachine } from "./appState";
import {
  renderErrorScreen,
  renderLoadingScreen,
  renderMainMenu,
  renderShatterdomePlaceholder,
  clearScreen,
} from "../ui/screens";
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
import { renderWorldScreen, type WorldScreenHandle } from "../ui/worldScreen";
import { GlobeView } from "../debug/globeView";
import { WorldState } from "../world/worldState";
import { FloatingOrigin } from "../world/floatingOrigin";
import { neighborIds } from "../world/cubeSphere";
import { createDefaultRegionRegistry } from "../data/regions";

export interface AppHandle {
  dispose(): void;
}

const THUMBNAIL_WIDTH = 192;

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

  let overlay: DebugOverlay | undefined;
  let kernel: SimulationKernel | undefined;
  let adapterDispose: (() => void) | undefined;
  let bootScene: BootScene;

  try {
    const adapter = await createEngineAdapter(canvas);
    adapterDispose = adapter.dispose;

    bootScene = buildBootScene(adapter.engine, canvas);
    const scene = bootScene.scene;

    kernel = new SimulationKernel({ seed: resolveSeed(window.location.search) });
    const loop = new SimulationLoop(kernel);

    overlay = new DebugOverlay(root, {
      backend: adapter.backend,
      babylonVersion: adapter.version,
      scene,
      kernel,
      loop,
      // No physics backend is wired yet; null makes the overlay say so.
      activePhysicsBodies: () => null,
    });

    const simKernel = kernel;
    adapter.engine.runRenderLoop(() => {
      loop.advance(adapter.engine.getDeltaTime());
      // Drain outside the tick so subscribers never mutate state mid-step.
      simKernel.events.drain();
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
    saveScreen = renderSaveScreen(uiRoot, {
      onSaveNew: (name) =>
        runSaveAction(async () => {
          const trimmed = name.trim() || `Save ${new Date().toLocaleTimeString()}`;
          const slotId = `slot.${Date.now().toString(36)}`;
          if (!kernel) throw new Error("No simulation is running.");
          await saveController.save(slotId, kernel, trimmed, worldState.serialize());
          return `Saved "${trimmed}".`;
        }),
      onOverwrite: (slotId) =>
        runSaveAction(async () => {
          if (!kernel) throw new Error("No simulation is running.");
          const existing = await saveService.listSlots();
          const name = existing.find((slot) => slot.slotId === slotId)?.metadata.name ?? "Save";
          await saveController.save(slotId, kernel, name, worldState.serialize());
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
      onExit: () => stateMachine.transition(AppState.MainMenu),
    });

    await refreshSaves();
  };

  // World state is authoritative and lives for the whole session; the globe view
  // is presentation and is built and torn down with the screen.
  const regionRegistry = createDefaultRegionRegistry();
  const worldState = new WorldState({ regions: regionRegistry });
  const floatingOrigin = new FloatingOrigin({ anchor: worldState.playerPosition });
  let globeView: GlobeView | undefined;
  let worldScreen: WorldScreenHandle | undefined;

  const closeWorld = (): void => {
    globeView?.dispose();
    globeView = undefined;
    worldScreen?.dispose();
    worldScreen = undefined;
    bootScene.jaegerPlaceholder.setEnabled(true);
    bootScene.ground.setEnabled(true);
    bootScene.camera.setTarget(new Vector3(0, 25, 0));
    bootScene.camera.radius = 110;
    bootScene.camera.lowerRadiusLimit = 10;
    bootScene.camera.upperRadiusLimit = 300;
  };

  const refreshWorld = (): void => {
    if (!worldScreen) return;
    const local = floatingOrigin.toLocal(worldState.playerPosition);
    const activeRegion = worldState.activeRegionId;
    const records = worldState.records();

    worldScreen.update({
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
    });
    globeView?.refresh();
  };

  const openWorld = (): void => {
    // The globe replaces the boot stage rather than sharing it.
    bootScene.jaegerPlaceholder.setEnabled(false);
    bootScene.ground.setEnabled(false);

    globeView = new GlobeView({
      scene: bootScene.scene,
      camera: bootScene.camera,
      world: worldState,
      regions: regionRegistry,
    });
    globeView.frameGlobe();

    worldScreen = renderWorldScreen(uiRoot, regionRegistry.all(), {
      onTeleport: (regionId) => {
        worldState.teleportTo(regionId, kernel?.tick ?? 0);
        // A teleport is an intentional jump, so the origin follows immediately
        // rather than waiting for the drift threshold.
        floatingOrigin.forceRebase(worldState.playerPosition);
        refreshWorld();
        // A teleport is a deliberate jump, so bring the camera with it. Walking
        // deliberately does not, or it would fight the player orbiting.
        globeView?.lookAtPlayer();
      },
      onWalk: (eastMeters, northMeters) => {
        const from = floatingOrigin.toLocal(worldState.playerPosition);
        const next = floatingOrigin.toGeo({
          east: from.east + eastMeters,
          north: from.north + northMeters,
          up: from.up,
        });
        // A tangent plane is flat and the globe is not, so walking a straight
        // line in local space lifts you off the surface: measured at 239 m of
        // false altitude over a 25 km walk. Carrying the altitude across keeps
        // movement on the ground until real terrain heights exist.
        worldState.moveTo(
          { ...next, altitudeMeters: worldState.playerPosition.altitudeMeters },
          kernel?.tick ?? 0,
        );
        floatingOrigin.update(worldState.playerPosition);
        refreshWorld();
      },
      onExit: () => stateMachine.transition(AppState.MainMenu),
    });

    refreshWorld();
  };

  const renderForState = (state: AppState): void => {
    if (state !== AppState.AssetGallery && gallery) closeGallery();
    if (state !== AppState.Saves && saveScreen) closeSaves();
    if (state !== AppState.WorldMap && worldScreen) closeWorld();

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
        renderShatterdomePlaceholder(uiRoot, goToMainMenu);
        break;
      case AppState.Error:
        // handled at boot-failure site above for the fatal case; runtime errors reuse this.
        break;
      default:
        clearScreen(uiRoot);
    }
  };

  unsubscribers.push(stateMachine.onChange((to) => renderForState(to)));
  renderForState(stateMachine.state);

  return {
    dispose(): void {
      unsubscribers.forEach((u) => u());
      gallery?.dispose();
      galleryScreen?.dispose();
      saveScreen?.dispose();
      globeView?.dispose();
      worldScreen?.dispose();
      repository.close();
      overlay?.dispose();
      kernel?.dispose();
      adapterDispose?.();
    },
  };
}
