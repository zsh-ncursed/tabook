// Native image overlay for terminals implementing the kitty graphics protocol
// (kitty, WezTerm, Ghostty, Konsole, Warp, ...). Speaks the protocol directly
// over stdout — no ueberzugpp process needed.
//
// The protocol guarantees PNG (f=100), RGB (f=24) and RGBA (f=32) payloads;
// JPEG is rejected (verified empirically), so non-PNG book resources are
// converted to PNG through the native `imageToPng` module and cached on disk.
//
// Transmission uses `t=f` (file): the payload is the base64-encoded path of a
// temp file, so kitty reads the file itself and no large escape chunking is
// required. Images are placed with `a=p` anchored at the cursor position, so
// each placement moves the cursor to its target cell first.
//
// Coordinates are terminal rows/cols (0-indexed); the reader's reserved
// IMAGE_ROWS blank lines keep the overlay clear of the following text.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getNative, isNativeAvailable, isNativeErrorResult } from '../native.js';
import { reconcile, type ShownGeometry } from './imageReconcile.js';
import type { ImagePlacement } from './imageLayer.js';

const ESC = '\x1b';
const ST = `${ESC}\\`;

// Pure detection: does this environment speak the kitty graphics protocol?
// Returns false inside tmux (APC escapes are swallowed there — the
// X11/wayland ueberzugpp overlay is used instead) and on non-TTY stdout.
// Extracted as a pure function so it is unit-testable without touching the
// (non-configurable) process.stdout.isTTY property.
export function detectNativeGraphics(
  env: Record<string, string | undefined>,
  isTty: boolean,
): boolean {
  if (!isTty) return false;
  // Multiplexers swallow APC escapes; the X11/wayland ueberzugpp overlay is
  // used instead (tmux, zellij, screen).
  if (env.TMUX || env.ZELLIJ || env.STY) return false;
  const tp = env.TERM_PROGRAM ?? '';
  return Boolean(
    env.KITTY_WINDOW_ID ||
    env.WEZTERM_PANE ||
    env.GHOSTTY_RESOURCES_DIR ||
    env.KONSOLE_VERSION ||
    tp === 'kitty' ||
    tp === 'WezTerm' ||
    tp === 'ghostty' ||
    tp === 'Warp' ||
    (env.TERM ?? '').startsWith('xterm-kitty'),
  );
}

export function supportsNativeGraphics(): boolean {
  return detectNativeGraphics(process.env, process.stdout.isTTY === true);
}

// --- Pure escape-sequence builders (unit-tested without a terminal) ---

// Transmit an image file for later placement under `id` (1..2^32-1). `t=f`
// tells the terminal to read the file at the base64-encoded path.
export function buildTransmit(path: string, id: number): string {
  const payload = Buffer.from(path, 'utf8').toString('base64');
  return `${ESC}_Ga=t,t=f,f=100,i=${id},q=2;${payload}${ST}`;
}

// Place image `id` in a c x r cell box whose top-left is at cell (x, y),
// 0-indexed. The placement anchors at the current cursor position, so the
// cursor is moved to the target cell first. p=1 makes repeated placements of
// the same image id replace each other (move/resize without flicker).
export function buildPlace(id: number, x: number, y: number, cols: number, rows: number): string {
  const move = `${ESC}[${y + 1};${x + 1}H`;
  return `${move}${ESC}_Ga=p,i=${id},p=1,c=${cols},r=${rows},q=2${ST}`;
}

// Delete image `id` and all of its placements (d=I).
export function buildRemove(id: number): string {
  return `${ESC}_Ga=d,d=I,i=${id},q=2${ST}`;
}

// Delete every image on screen.
export function buildClear(): string {
  return `${ESC}_Ga=d,d=A,q=2${ST}`;
}

// Number of terminal rows the image needs to fill `boxCols` columns without
// distortion, clamped to the reserved `boxRows` so the overlay never covers
// the text the layout reserved space for. Falls back to the full box when the
// source dimensions are unknown.
export function placementRows(
  boxCols: number,
  boxRows: number,
  imgWidth: number,
  imgHeight: number,
): number {
  if (imgWidth <= 0 || imgHeight <= 0) return boxRows;
  return Math.max(1, Math.min(boxRows, Math.round((boxCols * imgHeight) / imgWidth)));
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// Short stable hash of the resource src, appended to the temp filename so
// two different srcs that sanitize to the same name cannot collide (e.g.
// "a/b" and "a_b" both sanitize to "a_b").
function hashSrc(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Resolved PNG for a placement: a readable temp file plus the source image's
// pixel dimensions (used to size the placement box without distortion).
interface ResolvedPng {
  path: string;
  width: number;
  height: number;
}

// Read width/height from a PNG's IHDR chunk (bytes 16..23 after the 8-byte
// signature: 4-byte length + "IHDR" + 4-byte BE width + 4-byte BE height).
function pngDimensions(data: Uint8Array): { width: number; height: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export class KittyImageLayer {
  private active = false;
  // Detection hook, injectable for tests (the real one reads process.stdout,
  // which cannot be stubbed reliably across Node versions).
  private detect: () => boolean;

  constructor(detect: () => boolean = supportsNativeGraphics) {
    this.detect = detect;
  }
  private tmpDir = '';
  // resource src -> resolved PNG (converted on demand, cached per book)
  private cache = new Map<string, ResolvedPng>();
  // placement identifier -> kitty image id (stable per identifier)
  private imgIds = new Map<string, number>();
  private nextId = 1;
  private shown = new Map<string, ShownGeometry>();
  private exitHandler: (() => void) | null = null;

  start(): boolean {
    if (this.active) return true;
    if (!this.detect()) return false;
    this.tmpDir = join(tmpdir(), `tabook-kitty-${process.pid}`);
    mkdirSync(this.tmpDir, { recursive: true });
    this.active = true;
    this.exitHandler = () => this.stop();
    process.once('exit', this.exitHandler);
    return true;
  }

  private emit(s: string): void {
    if (!this.active) return;
    try {
      process.stdout.write(s);
    } catch {
      // stdout closed (pipe to head, etc.) — ignore
    }
  }

  private isPng(data: Uint8Array): boolean {
    return (
      data.length > 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    );
  }

  // Resolve a book resource to a PNG file path the terminal can read, plus
  // the source pixel dimensions (for distortion-free placement sizing).
  // Returns null when the resource is missing or cannot be converted.
  private resolvePng(src: string, resources: Map<string, Uint8Array>): ResolvedPng | null {
    const cached = this.cache.get(src);
    if (cached && existsSync(cached.path)) return cached;
    const data = resources.get(src);
    if (!data || data.length === 0) return null;
    let out: Uint8Array = data;
    let dims: { width: number; height: number } | null = null;
    if (this.isPng(data)) {
      dims = pngDimensions(data);
    } else {
      if (!isNativeAvailable()) return null;
      try {
        const r = getNative().imageToPng(Buffer.from(data));
        // napi-rs surfaces decode failures as an error value, not a throw;
        // guard against both so a bad resource is skipped, not transmitted.
        if (isNativeErrorResult(r) || !r.data || r.data.length === 0) return null;
        out = new Uint8Array(r.data);
        dims = { width: r.width, height: r.height };
      } catch {
        return null;
      }
    }
    const path = join(this.tmpDir, `${sanitize(src)}-${hashSrc(src)}.png`);
    writeFileSync(path, out);
    const resolved: ResolvedPng = { path, width: dims?.width ?? 0, height: dims?.height ?? 0 };
    this.cache.set(src, resolved);
    return resolved;
  }

  update(placements: ImagePlacement[], resources: Map<string, Uint8Array>): void {
    if (!this.active) return;
    const { toRemove, toAdd } = reconcile(this.shown, placements);
    for (const id of toRemove) {
      const imgId = this.imgIds.get(id);
      if (imgId !== undefined) {
        this.emit(buildRemove(imgId));
        this.imgIds.delete(id);
      }
      this.shown.delete(id);
    }
    for (const p of toAdd) {
      const resolved = this.resolvePng(p.src, resources);
      if (!resolved) continue;
      let imgId = this.imgIds.get(p.identifier);
      if (imgId === undefined) {
        imgId = this.nextId++;
        this.imgIds.set(p.identifier, imgId);
        this.emit(buildTransmit(resolved.path, imgId));
      }
      // Aspect-preserving height: fit the image into the c x r box without
      // distortion and without overflowing the rows the layout reserved.
      const rows = placementRows(p.width, p.height, resolved.width, resolved.height);
      this.emit(buildPlace(imgId, p.x, p.y, p.width, rows));
      this.shown.set(p.identifier, { x: p.x, y: p.y, width: p.width, height: p.height });
    }
  }

  clear(): void {
    if (!this.active) return;
    for (const imgId of this.imgIds.values()) this.emit(buildRemove(imgId));
    this.imgIds.clear();
    this.shown.clear();
  }

  stop(): void {
    if (!this.active) return;
    // Clear the screen while still active — emit() no-ops once inactive.
    this.emit(buildClear());
    this.active = false;
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler);
      this.exitHandler = null;
    }
    this.imgIds.clear();
    this.shown.clear();
    this.cache.clear();
    if (this.tmpDir) {
      try {
        rmSync(this.tmpDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
      this.tmpDir = '';
    }
  }
}
