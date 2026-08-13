// Pure diffing shared by the image overlay backends (ueberzugpp and the kitty
// graphics protocol). Kept in its own module so imageLayer.ts (which selects
// the backend) and kittyLayer.ts (one of the backends) do not import each
// other in a cycle.

import type { ImagePlacement } from './imageLayer.js';

// Geometry of an image currently on screen, keyed by identifier. Used to
// diff placements so unchanged images aren't re-sent on every reader render
// (lines is a fresh array each frame). Diff is geometry-only by design:
// callers keep `src` stable per identifier (block.src / coverKey), and
// resolvePath caches the extracted file by src, so the geometry-only
// comparison is safe.
export type ShownGeometry = Pick<ImagePlacement, 'x' | 'y' | 'width' | 'height'>;

export interface LayerReconcile {
  /** Identifiers that scrolled out of view and must be removed. */
  toRemove: string[];
  /** Placements to (re)send: new identifiers or changed geometry. */
  toAdd: ImagePlacement[];
}

// Pure diff used by both backends' update(): given what is currently shown
// and the new placements, decide which images to remove and which to
// add/reposition.
export function reconcile(
  shown: ReadonlyMap<string, ShownGeometry>,
  placements: ImagePlacement[],
): LayerReconcile {
  const toRemove: string[] = [];
  for (const id of shown.keys()) {
    if (!placements.some((p) => p.identifier === id)) toRemove.push(id);
  }
  const toAdd: ImagePlacement[] = [];
  for (const p of placements) {
    const prev = shown.get(p.identifier);
    if (
      !prev ||
      prev.x !== p.x ||
      prev.y !== p.y ||
      prev.width !== p.width ||
      prev.height !== p.height
    ) {
      toAdd.push(p);
    }
  }
  return { toRemove, toAdd };
}
