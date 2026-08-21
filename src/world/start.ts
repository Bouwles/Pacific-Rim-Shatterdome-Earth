import { geo, type GeoPosition } from "./coordinates";

/**
 * Where a new campaign starts, and where a save that predates world coordinates
 * is placed when it is migrated forward.
 *
 * Kept in its own module so the save layer can reference it without importing
 * the whole region data set, which would make migrations depend on content.
 */
export const DEFAULT_START_REGION_ID = "hong-kong";

/** Hong Kong Shatterdome. Matches the centre of the region with the same id. */
export const DEFAULT_START_POSITION: GeoPosition = geo(22.3193, 114.1694, 0);
