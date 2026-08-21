import type { SaveRepository } from "./repository";

export interface StorageHealth {
  /** What is actually storing saves right now. */
  readonly backend: string;
  readonly durable: boolean;
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  /** True when the browser promises not to evict this origin's storage. */
  readonly persisted: boolean | null;
  readonly slotCount: number;
  /** Plain-language explanation shown to the player when something is not ideal. */
  readonly warning: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reports where saves are going and whether they will survive. Reads only, so it
 * cannot itself be the reason storage fails.
 */
export async function probeStorageHealth(repository: SaveRepository): Promise<StorageHealth> {
  const durable = repository.kind !== "memory";

  let usageBytes: number | null;
  let quotaBytes: number | null = null;
  let persisted: boolean | null = null;

  try {
    usageBytes = await repository.estimateBytes();
  } catch {
    usageBytes = null;
  }

  if (typeof navigator !== "undefined" && navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate?.();
      quotaBytes = estimate?.quota ?? null;
      if (usageBytes === null) usageBytes = estimate?.usage ?? null;
    } catch {
      quotaBytes = null;
    }
    try {
      persisted = (await navigator.storage.persisted?.()) ?? null;
    } catch {
      persisted = null;
    }
  }

  let slotCount: number;
  try {
    slotCount = (await repository.listSlotIds()).length;
  } catch {
    slotCount = 0;
  }

  let warning: string | null = null;
  if (!durable) {
    warning =
      "Saves are being kept in memory only and will be lost when this tab closes. " +
      "This usually means the browser is in a private window or has storage disabled.";
  } else if (quotaBytes !== null && usageBytes !== null && quotaBytes > 0 && usageBytes / quotaBytes > 0.9) {
    warning = `Storage is ${formatBytes(usageBytes)} of ${formatBytes(quotaBytes)} used. Delete old saves before it fills.`;
  } else if (persisted === false) {
    warning = "The browser may evict saves under storage pressure. Export anything you want to keep.";
  }

  return { backend: repository.kind, durable, usageBytes, quotaBytes, persisted, slotCount, warning };
}

export function describeStorage(health: StorageHealth): string {
  const usage = health.usageBytes === null ? "unknown" : formatBytes(health.usageBytes);
  const quota = health.quotaBytes === null ? "unknown" : formatBytes(health.quotaBytes);
  return `${health.backend} · ${health.slotCount} slots · ${usage} of ${quota}`;
}
