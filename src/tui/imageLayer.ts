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

export interface ImagePlacement {
  identifier: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
}

// Geometry of an image currently on screen, keyed by identifier. Used to
// diff placements so unchanged images aren't re-sent over stdin on every
// reader render (lines is a fresh array each frame). Diff is geometry-only
// by design: callers keep `src` stable per identifier (block.src / coverKey),
// and resolvePath caches the extracted file by src, so the geometry-only
// comparison is safe.
export type ShownGeometry = Pick<ImagePlacement, 'x' | 'y' | 'width' | 'height'>;

export interface LayerReconcile {
  /** Identifiers that scrolled out of view and must be removed. */
  toRemove: string[];
  /** Placements to (re)send: new identifiers or changed geometry. */
  toAdd: ImagePlacement[];
}

// Pure diff used by ImageLayer.update: given what is currently shown and the
// new placements, decide which images to remove and which to add/reposition.
// Extracted as a pure function so the diffing is unit-testable without a
// ueberzugpp process.
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

class ImageLayer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private cache = new Map<string, string>(); // resource id -> temp file path
  private shown = new Map<string, ShownGeometry>(); // identifier -> geometry on screen
  private tmpDir = '';
  private pidFile = '';
  private exitHandler: (() => void) | null = null;

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
    // unmount cleanup doesn't fire on process.kill/exit).
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
    const ext = guessExt(src);
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

function guessExt(src: string): string {
  if (src.endsWith('.png')) return '.png';
  if (src.endsWith('.jpg') || src.endsWith('.jpeg')) return '.jpg';
  if (src.endsWith('.gif')) return '.gif';
  if (src.endsWith('.webp')) return '.webp';
  return '.img';
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export const imageLayer = new ImageLayer();
