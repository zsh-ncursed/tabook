// ueberzugpp image overlay: runs `ueberzugpp layer -o <output>` once, talks
// JSON over its stdin. Images from the book's resources are extracted to a
// temp dir once (cached by resource id) and referenced by path so ueberzugpp
// can read them directly.
//
// Coordinates are terminal rows/cols (0-indexed). The reader reserves the
// top row for the book title; line i of the viewport is screen row 1 + i, and
// a centered image placeholder sits at column 1 + line.indent. Images that
// scroll out of view are removed so they don't linger over the wrong page.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KittyImageLayer } from './kittyLayer.js';
import { reconcile, type ShownGeometry } from './imageReconcile.js';

// Re-exported for backward compatibility with existing callers/tests.
export { reconcile } from './imageReconcile.js';
export type { LayerReconcile, ShownGeometry } from './imageReconcile.js';

export interface ImagePlacement {
  identifier: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
}

// Sniff the payload's magic bytes so the temp file gets a real image
// extension instead of a generic one. ueberzugpp's OpenCV backend picks the
// encoder for its scaled-image cache from the file extension: with ".img"
// cv::imwrite throws on every add, the cache is never written and each cover
// is re-decoded on every frame. Falls back to the src-derived extension and
// finally to ".img" (OpenCV still decodes by content, so display works).
export function guessExt(src: string, data: Uint8Array | undefined): string {
  if (data && data.length >= 4) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return '.png';
    }
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return '.gif';
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
      return '.webp';
    }
  }
  if (src.endsWith('.png')) return '.png';
  if (src.endsWith('.jpg') || src.endsWith('.jpeg')) return '.jpg';
  if (src.endsWith('.gif')) return '.gif';
  if (src.endsWith('.webp')) return '.webp';
  return '.img';
}

// How many terminal rows an image overlay occupies. Layout reserves this
// many blank lines under the placeholder so the overlay doesn't cover text,
// and ReaderView caps the overlay height to the same value. Kept here so
// both sides reference a single source of truth.
export const IMAGE_ROWS = 10;

export interface ZoomGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Geometry of the enlarged ("zoom") view of a book image: the on-page box
// scaled by `scale` (default 2.5x), clamped to the viewport with a 2-cell
// margin and centered. ueberzugpp re-fits the image to the new box when the
// same src is re-added, so zooming is just a bigger, centered box (sent with
// its own identifier, 'zoom'); closing the zoom re-renders the normal page
// placements.
export function zoomGeometry(opts: {
  baseWidth: number;
  baseHeight: number;
  contentWidth: number;
  pageHeight: number;
  scale?: number;
}): ZoomGeometry {
  const scale = opts.scale ?? 2.5;
  const maxW = Math.max(8, opts.contentWidth - 4);
  const maxH = Math.max(2, opts.pageHeight - 4);
  const width = Math.max(8, Math.min(Math.round(opts.baseWidth * scale), maxW));
  const height = Math.max(2, Math.min(Math.round(opts.baseHeight * scale), maxH));
  const x = 1 + Math.max(0, Math.floor((opts.contentWidth - width) / 2));
  const y = 1 + Math.max(0, Math.floor((opts.pageHeight - height) / 2));
  return { x, y, width, height };
}

class UeberzugImageLayer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private cache = new Map<string, string>(); // resource id -> temp file path
  private shown = new Map<string, ShownGeometry>(); // identifier -> geometry on screen
  private tmpDir = '';
  private pidFile = '';
  private exitHandler: (() => void) | null = null;

  requiresRestartOnResize = true;

  get alive(): boolean {
    // Also treat a pipe that can no longer accept commands as dead: sends
    // would silently no-op and whatever was last drawn would stay frozen on
    // screen, misaligned with the text that keeps scrolling.
    return this.proc !== null && this.proc.stdin.writable;
  }

  start(): boolean {
    if (this.proc) return true;
    const output = detectOutput();
    if (!output) return false;
    this.tmpDir = join(tmpdir(), `tabook-img-${process.pid}`);
    mkdirSync(this.tmpDir, { recursive: true });
    this.pidFile = join(tmpdir(), `tabook-ueberzug-${process.pid}.pid`);
    try {
      this.proc = spawn(
        'ueberzugpp',
        ['layer', '-o', output, '--silent', '--pid-file', this.pidFile],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } catch {
      this.proc = null;
      return false;
    }
    this.proc.on('exit', () => {
      this.proc = null;
      this.shown.clear();
    });
    // Ensure ueberzugpp dies with us even on abrupt process.exit (React's
    // unmount cleanup doesn't fire on process.kill/exit). Note this alone is
    // not enough: Ink's exit() only unmounts the tree (no process.exit), so
    // the process terminates when the event loop drains — and a live child
    // keeps the loop alive (child.unref() does NOT release piped stdio
    // handles). The App component therefore also stops the layer in its
    // unmount cleanup, which SIGKILLs the child so the loop drains and the
    // overlay windows disappear with us.
    this.exitHandler = () => this.stop();
    process.once('exit', this.exitHandler);
    return true;
  }

  private send(cmd: Record<string, unknown>): void {
    if (!this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(JSON.stringify(cmd) + '\n');
  }

  // Resolve a book resource to a temp file path the overlay can load.
  private resolvePath(src: string, resources: Map<string, Uint8Array>): string {
    const cached = this.cache.get(src);
    if (cached && existsSync(cached)) return cached;
    const data = resources.get(src);
    if (!data || data.length === 0) return '';
    const ext = guessExt(src, data);
    const path = join(this.tmpDir, `${sanitize(src)}${ext}`);
    writeFileSync(path, data);
    this.cache.set(src, path);
    return path;
  }

  // Reconcile the visible set: remove images that scrolled out, add or
  // reposition only the ones whose geometry changed. update() runs on every
  // reader render, so diffing keeps unchanged images from being re-sent
  // (ueberzugpp replaces in place by identifier, but only when told to).
  update(placements: ImagePlacement[], resources: Map<string, Uint8Array>): void {
    if (!this.proc) return;
    const { toRemove, toAdd } = reconcile(this.shown, placements);
    for (const id of toRemove) {
      this.send({ action: 'remove', identifier: id });
      this.shown.delete(id);
    }
    for (const p of toAdd) {
      const path = this.resolvePath(p.src, resources);
      if (!path) continue;
      this.send({
        action: 'add',
        identifier: p.identifier,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        path,
        scaler: 'fit_contain',
        draw: true,
      });
      this.shown.set(p.identifier, { x: p.x, y: p.y, width: p.width, height: p.height });
    }
  }

  clear(): void {
    if (!this.proc) return;
    for (const id of this.shown.keys()) this.send({ action: 'remove', identifier: id });
    this.shown.clear();
  }

  stop(): void {
    this.clear();
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler);
      this.exitHandler = null;
    }
    if (this.proc) {
      try {
        this.proc.stdin.end();
      } catch {
        // already closed
      }
      // ueberzugpp ignores SIGTERM when holding an X11 connection; SIGKILL
      // so the overlay window disappears immediately.
      try {
        this.proc.kill('SIGKILL');
      } catch {
        // already dead
      }
      this.proc = null;
    }
    if (this.tmpDir) {
      try {
        rmSync(this.tmpDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
      this.tmpDir = '';
    }
    this.cache.clear();
  }
}

export function detectOutput(): string | null {
  // Only run when we're actually attached to a terminal — never in tests,
  // pipes, or CI where spawning ueberzugpp would just leak a process.
  if (!process.stdout.isTTY) return null;
  if (process.env.WAYLAND_DISPLAY) return 'wayland';
  if (process.env.DISPLAY) return 'x11';
  const term = process.env.TERM_PROGRAM ?? '';
  if (term === 'WezTerm') return 'iterm2';
  if (term === 'kitty') return 'kitty';
  return null;
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// Minimal contract both backends implement, so the facade can treat them
// uniformly (and tests can inject fakes).
interface ImageBackend {
  alive: boolean;
  start(): boolean;
  update(placements: ImagePlacement[], resources: Map<string, Uint8Array>): void;
  clear(): void;
  stop(): void;
  // True when pixel positions depend on terminal metrics the backend measured
  // once at process start and caches for the session. Such a backend must be
  // restarted after the terminal is resized so it re-measures; the kitty
  // backend draws through the app's own escape stream and needs no restart.
  requiresRestartOnResize: boolean;
}

// Facade over the two image backends. Kitty-family terminals get the native
// graphics protocol (no external dependency); everything else falls back to
// ueberzugpp (X11/wayland overlay), which is an optional package dependency.
// The backend is chosen once on the first start() and kept for the process
// lifetime, so a terminal switch mid-session is not handled (it cannot be).
export class ImageLayer {
  private backend: ImageBackend | null = null;
  // Last payload sent to update(); kept so restart() can re-draw the current
  // placements into a freshly spawned overlay process.
  private lastPlacements: ImagePlacement[] | null = null;
  private lastResources: Map<string, Uint8Array> | null = null;

  constructor(
    private kittyFactory: () => ImageBackend = () => new KittyImageLayer(),
    private ueberzugFactory: () => ImageBackend = () => new UeberzugImageLayer(),
  ) {}

  start(): boolean {
    if (this.backend) {
      if (this.backend.alive) return true;
      // The overlay process died (or its command pipe broke) mid-session.
      // Without this the facade would keep returning true while update()/
      // clear() silently no-op, leaving whatever was last drawn frozen on
      // screen — covers that no longer follow the scrolling text after a
      // delete or a page turn. Tear the dead backend down and re-create it
      // so the next update() re-draws the current placements.
      this.backend.stop();
      this.backend = null;
    }
    const kitty = this.kittyFactory();
    if (kitty.start()) {
      this.backend = kitty;
      return true;
    }
    const uber = this.ueberzugFactory();
    if (uber.start()) {
      this.backend = uber;
      return true;
    }
    return false;
  }

  update(placements: ImagePlacement[], resources: Map<string, Uint8Array>): void {
    this.lastPlacements = placements;
    this.lastResources = resources;
    this.backend?.update(placements, resources);
  }

  clear(): void {
    this.lastPlacements = null;
    this.lastResources = null;
    this.backend?.clear();
  }

  stop(): void {
    this.lastPlacements = null;
    this.lastResources = null;
    this.backend?.stop();
    this.backend = null;
  }

  // ueberzugpp measures the terminal's font metrics and padding ONCE at
  // process start and caches them for the session (Terminal::get_terminal_size
  // + X11 fallback window size). If the overlay spawns while the terminal
  // window is still being (re)sized — a tiling WM placing the window right
  // after launch — the cached values come from the mid-resize window and
  // every image lands offset, typically up over the header. Kill the overlay
  // and spawn a fresh one so it re-measures at the current, settled
  // geometry, then re-draw the last placements.
  restart(): void {
    if (!this.backend?.requiresRestartOnResize) return;
    const placements = this.lastPlacements;
    const resources = this.lastResources;
    this.backend.stop();
    this.backend = null;
    if (!this.start()) return;
    // TS's control-flow analysis keeps the `null` narrowing from the
    // `this.backend = null` above across the start() call, so read it back
    // through a cast.
    const backend = this.backend as ImageBackend | null;
    if (backend && placements && resources) backend.update(placements, resources);
  }
}

export const imageLayer = new ImageLayer();
