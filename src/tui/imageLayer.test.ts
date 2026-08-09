import { describe, it, expect } from 'vitest';
import { reconcile } from './imageLayer.js';
import type { ImagePlacement, ShownGeometry } from './imageLayer.js';

function placement(identifier: string, overrides: Partial<ImagePlacement> = {}): ImagePlacement {
  return {
    identifier,
    x: 1,
    y: 2,
    width: 16,
    height: 10,
    src: `img://${identifier}`,
    ...overrides,
  };
}

function geometry(x: number, y: number, width: number, height: number): ShownGeometry {
  return { x, y, width, height };
}

describe('reconcile', () => {
  it('adds images that are not on screen yet', () => {
    const { toRemove, toAdd } = reconcile(new Map(), [placement('a')]);
    expect(toRemove).toEqual([]);
    expect(toAdd.map((p) => p.identifier)).toEqual(['a']);
  });

  it('does not re-add images whose geometry is unchanged', () => {
    const shown = new Map([['a', geometry(1, 2, 16, 10)]]);
    const { toRemove, toAdd } = reconcile(shown, [placement('a')]);
    expect(toRemove).toEqual([]);
    expect(toAdd).toEqual([]);
  });

  it('re-adds an image when any of x/y/w/h changed', () => {
    const shown = new Map([['a', geometry(1, 2, 16, 10)]]);
    for (const move of [{ x: 5 }, { y: 8 }, { width: 20 }, { height: 12 }] as const) {
      const { toAdd } = reconcile(shown, [placement('a', move)]);
      expect(toAdd).toHaveLength(1);
      expect(toAdd[0]!.identifier).toBe('a');
    }
  });

  it('removes images that scrolled out of view', () => {
    const shown = new Map([
      ['a', geometry(1, 2, 16, 10)],
      ['b', geometry(3, 4, 16, 10)],
    ]);
    const { toRemove, toAdd } = reconcile(shown, [placement('a')]);
    expect(toRemove).toEqual(['b']);
    expect(toAdd).toEqual([]);
  });

  it('handles a mixed batch: keep, move and drop in one pass', () => {
    const shown = new Map([
      ['keep', geometry(1, 2, 16, 10)],
      ['move', geometry(1, 2, 16, 10)],
      ['gone', geometry(9, 9, 16, 10)],
    ]);
    const { toRemove, toAdd } = reconcile(shown, [
      placement('keep'),
      placement('move', { x: 7, y: 7 }),
    ]);
    expect(toRemove).toEqual(['gone']);
    expect(toAdd.map((p) => p.identifier)).toEqual(['move']);
  });

  it('keeps the diff independent of the map mutation by caller', () => {
    const shown = new Map([['a', geometry(1, 2, 16, 10)]]);
    const { toAdd } = reconcile(shown, [placement('a')]);
    // mutate the caller's map afterwards — the decision must not change
    shown.set('a', geometry(99, 99, 1, 1));
    expect(toAdd).toEqual([]);
  });
});
