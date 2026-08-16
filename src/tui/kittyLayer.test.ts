import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  KittyImageLayer,
  buildClear,
  buildPlace,
  buildRemove,
  buildTransmit,
  detectNativeGraphics,
  fitBox,
} from './kittyLayer.js';
import { reconcile, type ImagePlacement } from './imageLayer.js';

const REAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, REAL_ENV);
  vi.restoreAllMocks();
});

describe('detectNativeGraphics', () => {
  it('detects kitty via KITTY_WINDOW_ID', () => {
    expect(detectNativeGraphics({ KITTY_WINDOW_ID: '1' }, true)).toBe(true);
  });

  it('detects kitty via TERM_PROGRAM', () => {
    expect(detectNativeGraphics({ TERM_PROGRAM: 'kitty' }, true)).toBe(true);
  });

  it('detects wezterm, ghostty and konsole', () => {
    expect(detectNativeGraphics({ WEZTERM_PANE: '1' }, true)).toBe(true);
    expect(detectNativeGraphics({ GHOSTTY_RESOURCES_DIR: '/x' }, true)).toBe(true);
    expect(detectNativeGraphics({ KONSOLE_VERSION: '230600' }, true)).toBe(true);
  });

  it('refuses inside multiplexers (escapes are swallowed)', () => {
    expect(detectNativeGraphics({ KITTY_WINDOW_ID: '1', TMUX: '/tmp/tmux-0/default' }, true)).toBe(
      false,
    );
    expect(detectNativeGraphics({ KITTY_WINDOW_ID: '1', ZELLIJ: '1' }, true)).toBe(false);
    expect(detectNativeGraphics({ KITTY_WINDOW_ID: '1', STY: 'pts/7' }, true)).toBe(false);
  });

  it('refuses on non-TTY stdout', () => {
    expect(detectNativeGraphics({ KITTY_WINDOW_ID: '1' }, false)).toBe(false);
  });

  it('refuses for terminals without the protocol (alacritty, xterm)', () => {
    expect(detectNativeGraphics({ TERM: 'xterm-256color' }, true)).toBe(false);
    expect(detectNativeGraphics({ TERM_PROGRAM: 'alacritty' }, true)).toBe(false);
  });
});

describe('escape builders', () => {
  it('builds a file transmission with base64 path payload', () => {
    const esc = buildTransmit('/tmp/x/y.png', 7);
    const payload = Buffer.from('/tmp/x/y.png', 'utf8').toString('base64');
    expect(esc).toBe(`\x1b_Ga=t,t=f,f=100,i=7,q=2;${payload}\x1b\\`);
  });

  it('builds a placement anchored at the target cell, preserving the cursor', () => {
    const esc = buildPlace(7, 3, 4, { cols: 20, rows: 10 });
    // cursor saved (DECSC), moved to 1-based (5, 4), placed with C=1 (no
    // post-placement cursor movement), cursor restored (DECRC) — so Ink's
    // diff frames, which track the cursor position, stay aligned.
    expect(esc).toBe(`\x1b7\x1b[5;4H\x1b_Ga=p,i=7,p=1,c=20,r=10,C=1,q=2\x1b\\\x1b8`);
  });

  it('omits the dimension the terminal must compute from the aspect ratio', () => {
    // only cols: kitty derives rows from the image aspect (no distortion)
    expect(buildPlace(7, 3, 4, { cols: 20 })).toBe(
      `\x1b7\x1b[5;4H\x1b_Ga=p,i=7,p=1,c=20,C=1,q=2\x1b\\\x1b8`,
    );
    // only rows
    expect(buildPlace(7, 3, 4, { rows: 10 })).toBe(
      `\x1b7\x1b[5;4H\x1b_Ga=p,i=7,p=1,r=10,C=1,q=2\x1b\\\x1b8`,
    );
  });

  it('builds removal and clear', () => {
    expect(buildRemove(7)).toBe(`\x1b_Ga=d,d=I,i=7,q=2\x1b\\`);
    expect(buildClear()).toBe(`\x1b_Ga=d,d=A,q=2\x1b\\`);
  });
});

describe('fitBox (aspect-preserving placement box)', () => {
  it('keeps a portrait cover in a wide short card undistorted (the stretch bug)', () => {
    // 2:3 cover in a 12x3 library card: fixing rows at 3 makes kitty compute
    // the columns from the aspect ratio -> a narrow portrait, not a stretched
    // wide flat rectangle (both c and r would stretch it instead).
    expect(fitBox(12, 3, 300, 450)).toEqual({ rows: 3 });
  });

  it('fixes the width for wide images so the height fits the reserved box', () => {
    // 4:1 image in a 20x10 box -> 5 rows at 20 cols, fits
    expect(fitBox(20, 10, 400, 100)).toEqual({ cols: 20 });
  });

  it('fixes the height for tall images', () => {
    // 1:2 image in a 20x10 box -> would need 40 rows at 20 cols, so fix rows
    expect(fitBox(20, 10, 100, 200)).toEqual({ rows: 10 });
  });

  it('fits a square image inside a wide short box', () => {
    expect(fitBox(12, 3, 100, 100)).toEqual({ rows: 3 });
  });

  it('falls back to the full box when dimensions are unknown', () => {
    expect(fitBox(20, 10, 0, 0)).toEqual({ cols: 20, rows: 10 });
  });
});

describe('KittyImageLayer', () => {
  it('transmits once per identifier and re-places on geometry change', () => {
    const layer = new KittyImageLayer(() => true);
    expect(layer.start()).toBe(true);

    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      written.push(String(s));
      return true;
    });

    // canonical 1x1 transparent PNG
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const resources = new Map<string, Uint8Array>([['img1', new Uint8Array(png1x1)]]);
    const p1: ImagePlacement = {
      identifier: 'img5',
      x: 1,
      y: 2,
      width: 20,
      height: 10,
      src: 'img1',
    };
    const p2: ImagePlacement = {
      identifier: 'img5',
      x: 1,
      y: 5,
      width: 20,
      height: 10,
      src: 'img1',
    };

    layer.update([p1], resources);
    const first = written.join('');
    expect(first).toContain('a=t,t=f,f=100,i=1');
    // 1x1 px image in a 20x10 box: width-limited, kitty derives the rows
    expect(first).toContain('a=p,i=1,p=1,c=20,C=1,q=2');
    expect(first).not.toContain('r=10');

    // same identifier, moved down: only a placement, no re-transmit
    layer.update([p2], resources);
    const all = written.join('');
    expect((all.match(/a=t/g) ?? []).length).toBe(1);
    expect(all).toContain('\x1b[6;2H'); // moved to y=5 x=1

    // scroll away: image removed
    layer.update([], resources);
    expect(written.join('')).toContain('a=d,d=I,i=1');

    // back on screen: re-transmitted under a fresh id
    layer.update([p1], resources);
    expect(written.join('')).toContain('a=t,t=f,f=100,i=2');

    layer.stop();
  });

  it('clears the screen on stop() (clear must be emitted while active)', () => {
    const layer = new KittyImageLayer(() => true);
    layer.start();
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      written.push(String(s));
      return true;
    });
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    layer.update(
      [{ identifier: 'a', x: 0, y: 0, width: 10, height: 10, src: 's' }],
      new Map([['s', new Uint8Array(png1x1)]]),
    );
    expect(written.join('')).toContain('a=t,');
    layer.stop();
    expect(written.join('')).toContain('a=d,d=A');
  });

  it('skips non-PNG resources when native conversion is unavailable', () => {
    const layer = new KittyImageLayer(() => true);
    layer.start();
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      written.push(String(s));
      return true;
    });
    const resources = new Map<string, Uint8Array>([
      ['img2', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], // JPEG magic
    ]);
    layer.update(
      [{ identifier: 'img9', x: 0, y: 0, width: 10, height: 10, src: 'img2' }],
      resources,
    );
    expect(written.join('')).toBe('');
    layer.stop();
  });

  it('does not start when the terminal is unsupported', () => {
    const layer = new KittyImageLayer(() => false);
    expect(layer.start()).toBe(false);
  });
});

describe('reconcile (shared with ueberzugpp backend)', () => {
  it('reports removals and additions', () => {
    const shown = new Map([['a', { x: 0, y: 0, width: 10, height: 10 }]]);
    const r = reconcile(shown, [
      { identifier: 'a', x: 0, y: 1, width: 10, height: 10, src: 's' },
      { identifier: 'b', x: 1, y: 1, width: 10, height: 10, src: 't' },
    ]);
    expect(r.toRemove).toEqual([]);
    expect(r.toAdd.map((p) => p.identifier)).toEqual(['a', 'b']);
  });
});
