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

class ImageLayer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private cache = new Map<string, string>(); // resource id -> temp file path
  private shown = new Set<string>(); // identifiers currently on screen
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
      this.proc = spawn('ueberzugpp', ['layer', '-o', output, '--silent', '--pid-file', this.pidFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
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

  // Reconcile the visible set: remove images that scrolled out, add new ones.
  update(placements: ImagePlacement[], resources: Map<string, Uint8Array>): void {
    if (!this.proc) return;
    const next = new Set<string>();
    for (const p of placements) next.add(p.identifier);
    for (const id of this.shown) {
      if (!next.has(id)) this.send({ action: 'remove', identifier: id });
    }
    // Always re-send add: an image already on screen may have moved or
    // resized as the viewport scrolled (ueberzugpp replaces in place by
    // identifier). Skipping it would freeze it at the size it first appeared.
    for (const p of placements) {
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
    }
    this.shown = next;
  }

  clear(): void {
    if (!this.proc) return;
    for (const id of this.shown) this.send({ action: 'remove', identifier: id });
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

function detectOutput(): string | null {
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