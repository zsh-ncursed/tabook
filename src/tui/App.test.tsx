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
});
