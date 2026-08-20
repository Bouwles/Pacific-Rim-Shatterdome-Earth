const FNV_PRIME = 0x01000193;
const LANE_A_OFFSET = 0x811c9dc5;
const LANE_B_OFFSET = 0x9dc5811c;

const floatView = new Float64Array(1);
const byteView = new Uint8Array(floatView.buffer);

/**
 * Two-lane FNV-1a. A single 32-bit lane collides too easily to trust as a
 * regression signal, so two independently-seeded lanes are combined into one
 * 64-bit hex digest.
 */
class StateHasher {
  private laneA = LANE_A_OFFSET;
  private laneB = LANE_B_OFFSET;

  byte(value: number): void {
    const b = value & 0xff;
    this.laneA = Math.imul(this.laneA ^ b, FNV_PRIME);
    this.laneB = Math.imul(this.laneB ^ (b + 1), FNV_PRIME);
  }

  text(value: string): void {
    this.byte(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      this.byte(code & 0xff);
      this.byte(code >>> 8);
    }
  }

  float(value: number): void {
    // -0 and 0 are the same simulation value but differ bit-for-bit; normalize
    // so an incidental sign flip never reads as a state divergence.
    floatView[0] = value === 0 ? 0 : value;
    for (let i = 0; i < 8; i += 1) this.byte(byteView[i] as number);
  }

  digest(): string {
    const a = (this.laneA >>> 0).toString(16).padStart(8, "0");
    const b = (this.laneB >>> 0).toString(16).padStart(8, "0");
    return `${a}${b}`;
  }
}

function encode(hasher: StateHasher, value: unknown, path: string): void {
  if (value === null) {
    hasher.byte(0x6e); // 'n'
    return;
  }
  switch (typeof value) {
    case "boolean":
      hasher.byte(0x62); // 'b'
      hasher.byte(value ? 1 : 0);
      return;
    case "number":
      hasher.byte(0x64); // 'd'
      hasher.float(value);
      return;
    case "string":
      hasher.byte(0x73); // 's'
      hasher.text(value);
      return;
    case "object":
      break;
    default:
      throw new Error(
        `hashState: value at "${path}" is ${typeof value}, which is not serializable simulation state`,
      );
  }

  if (Array.isArray(value)) {
    hasher.byte(0x61); // 'a'
    hasher.float(value.length);
    value.forEach((item, index) => encode(hasher, item, `${path}[${index}]`));
    return;
  }

  hasher.byte(0x6f); // 'o'
  // Key order must not depend on insertion order, or an unrelated refactor
  // would change the digest without changing the state.
  const keys = Object.keys(value as Record<string, unknown>).sort();
  hasher.float(keys.length);
  for (const key of keys) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) {
      throw new Error(
        `hashState: "${path}.${key}" is undefined; simulation state must be fully serializable`,
      );
    }
    hasher.text(key);
    encode(hasher, child, `${path}.${key}`);
  }
}

/**
 * Deterministic 64-bit digest of plain serializable state. Same structure and
 * values always produce the same digest, independent of key insertion order.
 */
export function hashState(value: unknown): string {
  const hasher = new StateHasher();
  encode(hasher, value, "$");
  return hasher.digest();
}
