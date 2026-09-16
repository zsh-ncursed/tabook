import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { LibraryDb } from '../db/db.js';
import { defaultConfig } from '../config/defaults.js';
import { folderNeedsRescan, scanLibraryFolder, type ScanSummary } from '../db/scan.js';
import type * as ScanModule from '../db/scan.js';

// Mock the scan module so the entry checks are fully deterministic: the real
// folderNeedsRescan walks the disk (timing-dependent), and a real scan would
// parse files. resolveFolderPath keeps its real implementation via
// importOriginal — App also imports it.
vi.mock('../db/scan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ScanModule>();
  return {
    ...actual,
    folderNeedsRescan: vi.fn(async () => false),
    scanLibraryFolder: vi.fn(async (): Promise<ScanSummary> => ({
      total: 0,
      added: 0,
      updated: 0,
      removed: 0,
      failed: 0,
      errors: [],
    })),
  };
});

const folderNeedsRescanMock = vi.mocked(folderNeedsRescan);
const scanLibraryFolderMock = vi.mocked(scanLibraryFolder);

let dir: string;
let db: LibraryDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-app-test-'));
  db = new LibraryDb(path.join(dir, 'lib.sqlite'));
  folderNeedsRescanMock.mockReset();
  folderNeedsRescanMock.mockResolvedValue(false);
  scanLibraryFolderMock.mockReset();
  scanLibraryFolderMock.mockResolvedValue({
    total: 0,
    added: 0,
    updated: 0,
    removed: 0,
    failed: 0,
    errors: [],
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

describe('App — library entry folder checks', () => {
  it('scans folders reported as stale on entering the library', async () => {
    db.addLibraryFolder('/books/a');
    folderNeedsRescanMock.mockResolvedValueOnce(true);

    const { unmount } = render(<App db={db} config={defaultConfig()} />);
    await settle();

    expect(folderNeedsRescanMock).toHaveBeenCalledTimes(1);
    expect(folderNeedsRescanMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ path: '/books/a' }),
    );
    expect(scanLibraryFolderMock).toHaveBeenCalledTimes(1);
    expect(scanLibraryFolderMock).toHaveBeenCalledWith(db, '/books/a', expect.any(Function));
    unmount();
    await settle();
  });

  it('skips clean folders without triggering a scan', async () => {
    db.addLibraryFolder('/books/a');
    folderNeedsRescanMock.mockResolvedValueOnce(false);

    const { unmount } = render(<App db={db} config={defaultConfig()} />);
    await settle();

    expect(folderNeedsRescanMock).toHaveBeenCalledTimes(1);
    expect(scanLibraryFolderMock).not.toHaveBeenCalled();
    unmount();
    await settle();
  });

  it('writes the alternate-screen leave sequence on unmount (TTY)', async () => {
    const origTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { unmount } = render(<App db={db} config={defaultConfig()} />);
      await settle();
      unmount();
      await settle();
      // main.ts enters the alternate screen on start; the App must leave it
      // on exit so the shell's original content is restored.
      expect(writeSpy).toHaveBeenCalledWith('\x1b[?1049l');
    } finally {
      writeSpy.mockRestore();
      if (origTTY) Object.defineProperty(process.stdout, 'isTTY', origTTY);
    }
  });

  it('cancels pending checks when leaving the library before they finish', async () => {
    db.addLibraryFolder('/books/a');
    let resolveCheck!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      resolveCheck = resolve;
    });
    folderNeedsRescanMock.mockReturnValueOnce(pending);

    const { unmount } = render(<App db={db} config={defaultConfig()} />);
    await settle();
    expect(folderNeedsRescanMock).toHaveBeenCalledTimes(1);

    // Leaving the library view. Ink renders through its own reconciler, whose
    // unmount commit (and effect cleanups) is scheduled rather than fully
    // synchronous — so wait for it before resolving the in-flight check to
    // guarantee the cleanup has set `cancelled`. A check resolving after
    // cancellation must not trigger a scan.
    unmount();
    await settle();
    resolveCheck(true);
    await settle();
    expect(scanLibraryFolderMock).not.toHaveBeenCalled();
  });

  // ponytail: the root must always be at least the terminal height. Ink has
  // two paint paths — a frame SHORTER than the screen is written incrementally
  // (erase N previous lines + new frame), a TALLER one wipes the whole screen
  // first. A view that is short now and tall a moment later (a confirm dialog
  // opens, then closes) leaves the incremental path's line counter stale, so
  // the next erase under-clears and the tail of the old, taller frame stays
  // on screen: stale rows and dialog borders the user can still see after the
  // action completed. Keeping every frame ≥ the screen height forces the
  // full-clear path, so nothing stale can survive a redraw. This test pins
  // the invariant; it cannot reproduce the visual bug itself (ink-testing
  // never reports a real rows count), which needs a live terminal.
  it('renders the root at least the terminal height so stale frames cannot survive', async () => {
    const { lastFrame, unmount } = render(<App db={db} config={defaultConfig()} />);
    await settle();
    const frame = lastFrame() ?? '';
    // useTerminalSize falls back to 24 rows when stdout has no `rows` (tests).
    // minHeight (not height) so a genuinely taller frame still grows — a
    // smaller value here would mean the layout clips content instead.
    expect(frame.split('\n').length).toBeGreaterThanOrEqual(24);
    unmount();
    await settle();
  });
});
