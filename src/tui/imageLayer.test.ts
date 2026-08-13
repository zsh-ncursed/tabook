import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reconcile, detectOutput, IMAGE_ROWS, zoomGeometry } from './imageLayer.js';
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

describe('detectOutput', () => {
  let origIsTTY: boolean | undefined;
  let origWayland: string | undefined;
  let origDisplay: string | undefined;
  let origTermProgram: string | undefined;

  beforeEach(() => {
    origIsTTY = process.stdout.isTTY;
    origWayland = process.env.WAYLAND_DISPLAY;
    origDisplay = process.env.DISPLAY;
    origTermProgram = process.env.TERM_PROGRAM;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
    if (origWayland !== undefined) process.env.WAYLAND_DISPLAY = origWayland;
    else delete process.env.WAYLAND_DISPLAY;
    if (origDisplay !== undefined) process.env.DISPLAY = origDisplay;
    else delete process.env.DISPLAY;
    if (origTermProgram !== undefined) process.env.TERM_PROGRAM = origTermProgram;
    else delete process.env.TERM_PROGRAM;
  });

  function setTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  }

  it('returns null when not a TTY', () => {
    setTTY(false);
    expect(detectOutput()).toBeNull();
  });

  it('detects Wayland via WAYLAND_DISPLAY', () => {
    setTTY(true);
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    delete process.env.DISPLAY;
    delete process.env.TERM_PROGRAM;
    expect(detectOutput()).toBe('wayland');
  });

  it('detects X11 via DISPLAY', () => {
    setTTY(true);
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ':0';
    delete process.env.TERM_PROGRAM;
    expect(detectOutput()).toBe('x11');
  });

  it('prefers Wayland over X11 when both are set', () => {
    setTTY(true);
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    process.env.DISPLAY = ':0';
    delete process.env.TERM_PROGRAM;
    expect(detectOutput()).toBe('wayland');
  });

  it('detects WezTerm via TERM_PROGRAM', () => {
    setTTY(true);
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    process.env.TERM_PROGRAM = 'WezTerm';
    expect(detectOutput()).toBe('iterm2');
  });

  it('detects kitty via TERM_PROGRAM', () => {
    setTTY(true);
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    process.env.TERM_PROGRAM = 'kitty';
    expect(detectOutput()).toBe('kitty');
  });

  it('returns null for unknown TERM_PROGRAM', () => {
    setTTY(true);
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    process.env.TERM_PROGRAM = 'unknown';
    expect(detectOutput()).toBeNull();
  });

  it('returns null in CI/piped environment (no TTY)', () => {
    setTTY(false);
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    process.env.DISPLAY = ':0';
    expect(detectOutput()).toBeNull();
  });
});

describe('IMAGE_ROWS', () => {
  it('is a positive integer', () => {
    expect(IMAGE_ROWS).toBeGreaterThan(0);
    expect(Number.isInteger(IMAGE_ROWS)).toBe(true);
  });
});

describe('zoomGeometry', () => {
  it('scales the on-page box by the default 2.5x factor', () => {
    const g = zoomGeometry({ baseWidth: 70, baseHeight: 10, contentWidth: 118, pageHeight: 38 });
    expect(g.width).toBe(Math.min(Math.round(70 * 2.5), 118 - 4));
    expect(g.height).toBe(Math.min(Math.round(10 * 2.5), 38 - 4));
  });

  it('clamps to the viewport with a margin and centers', () => {
    const g = zoomGeometry({ baseWidth: 500, baseHeight: 500, contentWidth: 118, pageHeight: 38 });
    expect(g.width).toBe(118 - 4);
    expect(g.height).toBe(38 - 4);
    expect(g.x).toBe(1 + Math.floor((118 - (118 - 4)) / 2));
    expect(g.y).toBe(1 + Math.floor((38 - (38 - 4)) / 2));
  });

  it('respects a custom scale', () => {
    const g = zoomGeometry({
      baseWidth: 20,
      baseHeight: 4,
      contentWidth: 100,
      pageHeight: 30,
      scale: 3,
    });
    expect(g.width).toBe(60);
    expect(g.height).toBe(12);
  });

  it('never shrinks below the minimum box size', () => {
    const g = zoomGeometry({ baseWidth: 1, baseHeight: 1, contentWidth: 20, pageHeight: 10 });
    expect(g.width).toBeGreaterThanOrEqual(8);
    expect(g.height).toBeGreaterThanOrEqual(2);
    expect(g.x).toBeGreaterThanOrEqual(1);
    expect(g.y).toBeGreaterThanOrEqual(1);
  });
});
