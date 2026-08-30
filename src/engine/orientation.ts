import { Matrix, Quaternion, Vector3, type Node, type TransformNode } from "@babylonjs/core";

/**
 * The orientation contract, enforced.
 *
 * See docs/ORIENTATION.md. Every body in the game is upright on +Y, faces
 * local +Z, has its pivot on the sole plane and is never mirrored. This
 * module checks a rig against that and says exactly what is wrong; nothing
 * here corrects anything, because a correction applied here would be a
 * correction hidden from the model that needs it.
 */

export const WORLD_UP = new Vector3(0, 1, 0);
export const LOCAL_FORWARD = new Vector3(0, 0, 1);
export const LOCAL_RIGHT = new Vector3(1, 0, 0);

/** Up must agree with world up at least this well when no tilt is tagged. */
export const UPRIGHT_DOT_MINIMUM = 0.9;
/** A front marker has to be ahead of the root by at least this fraction of the height. */
export const FRONT_OFFSET_MINIMUM_FRACTION = 0.02;

export interface OrientationSubject {
  readonly label: string;
  /** The rig root: identity under the gameplay root. */
  readonly root: TransformNode;
  /** Something on the front of the body: the reactor, the jaw, the visor. */
  readonly frontMarker: TransformNode;
  readonly heightMeters: number;
  /** World height of the ground under the pivot. Defaults to the root's own y. */
  readonly groundY?: number;
  /** Degrees of tagged tilt (a knockdown, a topple). Allows the up check to relax. */
  readonly taggedTiltDeg?: number;
  readonly skeletonRoot?: TransformNode;
  /**
   * How far below the ground plane the bounds may dip, as a fraction of the
   * height. Two percent by default; a pose that slams the ground (a blade
   * driven down, a fist into the road) is checked with more.
   */
  readonly groundContactFraction?: number;
}

export interface OrientationReport {
  readonly subject: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** Dot of the root's up with world up. One is upright. */
  readonly upDot: number;
  /** Signed distance of the front marker ahead of the root along local +Z, in heights. */
  readonly frontOffset: number;
  readonly determinant: number;
  readonly boundsMinY: number;
  readonly boundsMaxY: number;
  readonly pivotY: number;
}

function finite(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function worldRotation(node: TransformNode): Quaternion {
  const matrix = node.computeWorldMatrix(true);
  const rotation = new Quaternion();
  const scale = new Vector3();
  const translation = new Vector3();
  matrix.decompose(scale, rotation, translation);
  return rotation;
}

function worldPosition(node: TransformNode): Vector3 {
  return node.computeWorldMatrix(true).getTranslation();
}

function determinantOf(matrix: Matrix): number {
  return matrix.determinant();
}

export function validateOrientation(subject: OrientationSubject): OrientationReport {
  const problems: string[] = [];
  const root = subject.root;
  const height = subject.heightMeters;

  // Every node in the hierarchy has to be finite before anything else is
  // worth measuring; one NaN poisons every world matrix under it.
  const descendants: Node[] = [root, ...root.getDescendants(false)];
  for (const node of descendants) {
    const transform = node as TransformNode;
    if (!transform.position) continue;
    if (!finite(transform.position)) problems.push(`${node.name}: non-finite position`);
    if (transform.rotation && !finite(transform.rotation)) problems.push(`${node.name}: non-finite rotation`);
    if (transform.scaling && !finite(transform.scaling)) problems.push(`${node.name}: non-finite scale`);
    if (
      transform.scaling &&
      (transform.scaling.x <= 0 || transform.scaling.y <= 0 || transform.scaling.z <= 0)
    ) {
      problems.push(
        `${node.name}: negative or zero scale (${transform.scaling.x}, ${transform.scaling.y}, ${transform.scaling.z})`,
      );
    }
  }

  const matrix = root.computeWorldMatrix(true);
  const determinant = determinantOf(matrix);
  if (determinant <= 0)
    problems.push(`root world matrix is mirrored (determinant ${determinant.toFixed(3)})`);

  const rotation = worldRotation(root);
  const up = Vector3.Zero();
  WORLD_UP.rotateByQuaternionToRef(rotation, up);
  const upDot = Vector3.Dot(up, WORLD_UP);
  const tilt = subject.taggedTiltDeg ?? 0;
  const allowedDot =
    tilt > 0 ? Math.min(UPRIGHT_DOT_MINIMUM, Math.cos((tilt * Math.PI) / 180) - 0.05) : UPRIGHT_DOT_MINIMUM;
  if (upDot < allowedDot) {
    problems.push(`root is not upright (up dot ${upDot.toFixed(3)}, tagged tilt ${tilt} deg)`);
  }

  const forward = Vector3.Zero();
  LOCAL_FORWARD.rotateByQuaternionToRef(rotation, forward);
  const rootPosition = worldPosition(root);
  const markerPosition = worldPosition(subject.frontMarker);
  const frontOffset = Vector3.Dot(markerPosition.subtract(rootPosition), forward) / Math.max(1e-6, height);
  if (frontOffset < FRONT_OFFSET_MINIMUM_FRACTION) {
    problems.push(
      `front marker "${subject.frontMarker.name}" is not ahead of the root along +Z (offset ${frontOffset.toFixed(3)} heights)`,
    );
  }

  const groundY = subject.groundY ?? rootPosition.y;
  const pivotY = rootPosition.y;
  if (Math.abs(pivotY - groundY) > height * 0.02) {
    problems.push(`pivot is ${(pivotY - groundY).toFixed(2)} m off the ground plane`);
  }

  const bounds = root.getHierarchyBoundingVectors(true);
  const boundsMinY = bounds.min.y;
  const boundsMaxY = bounds.max.y;
  const contact = subject.groundContactFraction ?? 0.02;
  if (boundsMinY < groundY - height * contact) {
    problems.push(`bounds dip ${(groundY - boundsMinY).toFixed(2)} m below the ground plane`);
  }
  if (boundsMaxY - groundY < height * 0.5) {
    problems.push(`body stands ${(boundsMaxY - groundY).toFixed(1)} m, under half its ${height} m height`);
  }

  if (subject.skeletonRoot) {
    const skeletonRotation = worldRotation(subject.skeletonRoot);
    const skeletonUp = Vector3.Zero();
    WORLD_UP.rotateByQuaternionToRef(skeletonRotation, skeletonUp);
    const skeletonForward = Vector3.Zero();
    LOCAL_FORWARD.rotateByQuaternionToRef(skeletonRotation, skeletonForward);
    if (Vector3.Dot(skeletonUp, up) < UPRIGHT_DOT_MINIMUM)
      problems.push("skeleton root up disagrees with the visual root");
    if (Vector3.Dot(skeletonForward, forward) < UPRIGHT_DOT_MINIMUM) {
      problems.push("skeleton root forward disagrees with the visual root");
    }
  }

  return {
    subject: subject.label,
    ok: problems.length === 0,
    problems,
    upDot,
    frontOffset,
    determinant,
    boundsMinY,
    boundsMaxY,
    pivotY,
  };
}

/**
 * The pure form of the up check, for the locomotion and camera tests that
 * have no scene: a yaw-only pose is upright by construction, and a camera yaw
 * never touches it.
 */
export function uprightDotOf(rotationXRad: number, rotationZRad: number): number {
  const rotation = Quaternion.RotationYawPitchRoll(0, rotationXRad, rotationZRad);
  const up = Vector3.Zero();
  WORLD_UP.rotateByQuaternionToRef(rotation, up);
  return Vector3.Dot(up, WORLD_UP);
}

/** Forward in the world frame for a compass yaw, the same formula the locomotion uses. */
export function forwardForYaw(yawDeg: number): { readonly east: number; readonly north: number } {
  const radians = (yawDeg * Math.PI) / 180;
  return { east: Math.sin(radians), north: Math.cos(radians) };
}
