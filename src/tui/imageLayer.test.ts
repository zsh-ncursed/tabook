import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  reconcile,
  detectOutput,
  IMAGE_ROWS,
  zoomGeometry,
  guessExt,
  ImageLayer,
} from './imageLayer.js';
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

describe('guessExt', () => {
  it('sniffs PNG magic bytes', () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(guessExt('lib-cover-1', data)).toBe('.png');
  });

  it('sniffs JPEG magic bytes', () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(guessExt('cover', data)).toBe('.jpg');
  });

  it('sniffs GIF and WebP magic bytes', () => {
    expect(guessExt('a', new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('.gif');
    expect(guessExt('a', new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe('.webp');
  });

  it('falls back to the src extension when bytes are unknown or missing', () => {
    expect(guessExt('i_015.png', undefined)).toBe('.png');
    expect(guessExt('cover.jpg', new Uint8Array([1, 2, 3]))).toBe('.jpg');
    expect(guessExt('img.gif', new Uint8Array([1, 2, 3]))).toBe('.gif');
    expect(guessExt('x.webp', new Uint8Array([1, 2, 3]))).toBe('.webp');
  });

  it('falls back to .img when nothing is known', () => {
    expect(guessExt('lib-cover-1', undefined)).toBe('.img');
    expect(guessExt('unknown', new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('.img');
  });
});

interface FakeBackend {
  alive: boolean;
  start: () => boolean;
  update: (placements: ImagePlacement[], resources: Map<string, Uint8Array>) => void;
  clear: () => void;
  stop: () => void;
  requiresRestartOnResize: boolean;
}

function fakeBackend(overrides: Partial<FakeBackend> = {}): FakeBackend {
  return {
    alive: true,
    start: vi.fn(() => true),
    update: vi.fn(),
    clear: vi.fn(),
    stop: vi.fn(),
    requiresRestartOnResize: true,
    ...overrides,
  };
}

describe('ImageLayer facade recovery', () => {
  it('keeps a live backend and does not re-create it', () => {
    const kitty = fakeBackend();
    const uber = fakeBackend();
    const layer = new ImageLayer(
      () => kitty,
      () => uber,
    );
    expect(layer.start()).toBe(true);
    expect(layer.start()).toBe(true);
    expect(kitty.start).toHaveBeenCalledTimes(1);
    expect(uber.start).not.toHaveBeenCalled();
  });

  it('re-creates the backend when the process died mid-session', () => {
    // kitty never available (detection fails); each ueberzugpp factory call
    // spawns a fresh backend
    const kittyFactory = vi.fn(() => fakeBackend({ alive: false, start: vi.fn(() => false) }));
    const uberInstances: FakeBackend[] = [];
    const uberFactory = vi.fn(() => {
      const b = fakeBackend();
      uberInstances.push(b);
      return b;
    });
    const layer = new ImageLayer(kittyFactory, uberFactory);
    expect(layer.start()).toBe(true);
    expect(uberInstances).toHaveLength(1);
    // ueberzugpp exits mid-session
    uberInstances[0]!.alive = false;
    // the next start() must tear the dead backend down and spawn a new one,
    // otherwise update()/clear() would silently no-op and covers would stay
    // frozen misaligned with the scrolling text
    expect(layer.start()).toBe(true);
    expect(uberInstances).toHaveLength(2);
    expect(uberInstances[0]!.stop).toHaveBeenCalledTimes(1);
    expect(uberInstances[1]!.start).toHaveBeenCalledTimes(1);
  });

  it('delegates update/clear to the active backend', () => {
    const kitty = fakeBackend();
    const layer = new ImageLayer(
      () => kitty,
      () => fakeBackend(),
    );
    layer.start();
    layer.update([], new Map());
    layer.clear();
    expect(kitty.update).toHaveBeenCalledTimes(1);
    expect(kitty.clear).toHaveBeenCalledTimes(1);
  });

  it('stop() tears the backend down', () => {
    const kitty = fakeBackend();
    const layer = new ImageLayer(
      () => kitty,
      () => fakeBackend(),
    );
    layer.start();
    layer.stop();
    expect(kitty.stop).toHaveBeenCalledTimes(1);
    // a subsequent start re-creates
    const fresh = fakeBackend();
    const layer2 = new ImageLayer(
      () => fresh,
      () => fakeBackend(),
    );
    expect(layer2.start()).toBe(true);
    expect(fresh.start).toHaveBeenCalledTimes(1);
  });
});

describe('ImageLayer restart', () => {
  // ueberzugpp-only environment (kitty detection fails): the facade picks the
  // ueberzug factory.
  function ueberzugOnly(): {
    layer: ImageLayer;
    instances: FakeBackend[];
  } {
    const instances: FakeBackend[] = [];
    const layer = new ImageLayer(
      () => fakeBackend({ alive: false, start: vi.fn(() => false) }),
      () => {
        const b = fakeBackend();
        instances.push(b);
        return b;
      },
    );
    return { layer, instances };
  }

  it('re-creates the ueberzugpp backend and re-sends the last placements', () => {
    const { layer, instances } = ueberzugOnly();
    expect(layer.start()).toBe(true);
    const placements = [placement('lib-cover-1'), placement('lib-cover-2', { y: 4 })];
    const resources = new Map<string, Uint8Array>([
      ['lib-cover-1', new Uint8Array([1])],
      ['lib-cover-2', new Uint8Array([2])],
    ]);
    layer.update(placements, resources);
    layer.restart();
    expect(instances).toHaveLength(2);
    expect(instances[0]!.stop).toHaveBeenCalledTimes(1);
    expect(instances[1]!.update).toHaveBeenCalledWith(placements, resources);
  });

  it('does not re-send when nothing was ever drawn', () => {
    const { layer, instances } = ueberzugOnly();
    expect(layer.start()).toBe(true);
    layer.restart();
    expect(instances).toHaveLength(2);
    expect(instances[1]!.update).not.toHaveBeenCalled();
  });

  it('does not re-send after clear() (images intentionally hidden)', () => {
    const { layer, instances } = ueberzugOnly();
    expect(layer.start()).toBe(true);
    layer.update([placement('lib-cover-1')], new Map([['lib-cover-1', new Uint8Array([1])]]));
    layer.clear();
    layer.restart();
    expect(instances).toHaveLength(2);
    expect(instances[1]!.update).not.toHaveBeenCalled();
  });

  it('is a no-op while the kitty backend is active (no stale metrics)', () => {
    const kitty = fakeBackend({ requiresRestartOnResize: false });
    const uber = fakeBackend();
    const layer = new ImageLayer(
      () => kitty,
      () => uber,
    );
    expect(layer.start()).toBe(true);
    layer.update([placement('a')], new Map());
    layer.restart();
    // the kitty backend must survive untouched
    expect(kitty.stop).not.toHaveBeenCalled();
    expect(uber.start).not.toHaveBeenCalled();
  });

  it('is a no-op when no backend is running', () => {
    const { layer } = ueberzugOnly();
    layer.restart();
    expect(layer.start()).toBe(true);
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
