import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { LibraryView } from './LibraryView.js';
import { LibraryDb } from '../../db/db.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';
import type { Theme } from '../../themes/themes.js';

const theme: Theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;
const config = defaultConfig();

function addBook(db: LibraryDb, pathStr: string, title: string, series?: string, number?: number) {
  return db.addBook({
    path: pathStr,
    filename: path.basename(pathStr),
    format: 'fb2',
    size: 100,
    metadata: {
      title,
      authors: [{ firstName: 'A', lastName: 'B' }],
      series: series ? { name: series, number } : undefined,
      genres: [],
      annotation: '',
    },
  });
}

let dir: string;
let db: LibraryDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-lib-test-'));
  db = new LibraryDb(path.join(dir, 'lib.sqlite'));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeProps(overrides: Partial<Parameters<typeof LibraryView>[0]> = {}) {
  return {
    db,
    config,
    theme,
    refreshTrigger: 0,
    cmdBus: {},
    cmdVersion: 0,
    notify: vi.fn(),
    onOpenBook: vi.fn(),
    onOpenFile: vi.fn(),
    onQuit: vi.fn(),
    onHelp: vi.fn(),
    runCommand: vi.fn(),
    completeCommand: vi.fn(() => null),
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

describe('LibraryView grouping and cursor', () => {
  it('renders series group headers when grouping is enabled', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha', 'Trilogy', 1);
    addBook(db, '/tmp/b.fb2', 'Beta', 'Trilogy', 2);
    addBook(db, '/tmp/c.fb2', 'Gamma');
    const props = makeProps({ cmdBus: { group: true }, cmdVersion: 1 });
    const { lastFrame } = render(<LibraryView {...props} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Trilogy (2)');
    expect(frame).toContain('Standalone (1)');
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Beta');
    expect(frame).toContain('Gamma');
  });

  it('keeps the cursor on a book row, not a group header', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha', 'Trilogy', 1);
    addBook(db, '/tmp/b.fb2', 'Beta', 'Trilogy', 2);
    addBook(db, '/tmp/c.fb2', 'Gamma');
    const props = makeProps({ cmdBus: { group: true }, cmdVersion: 1 });
    const { stdin, lastFrame } = render(<LibraryView {...props} />);
    await settle();
    // Move down several times: the cursor must never land on a header row.
    for (let i = 0; i < 6; i++) {
      stdin.write('j');
      await settle();
      const frame = lastFrame() ?? '';
      // Selected rows are marked with '▶'. Headers never carry the marker.
      const selLine = frame.split('\n').find((l) => l.includes('▶'));
      expect(selLine).toBeDefined();
      expect(selLine).not.toMatch(/^\s*Trilogy/);
      expect(selLine).not.toMatch(/^\s*Standalone/);
    }
  });

  it('go_to_end lands on the last book, not a trailing header', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha', 'Trilogy', 1);
    addBook(db, '/tmp/b.fb2', 'Beta', 'Trilogy', 2);
    const props = makeProps({ cmdBus: { group: true }, cmdVersion: 1 });
    const { stdin, lastFrame } = render(<LibraryView {...props} />);
    await settle();
    stdin.write('G');
    await settle();
    const frame = lastFrame() ?? '';
    const selLine = frame.split('\n').find((l) => l.includes('▶'));
    expect(selLine).toBeDefined();
    expect(selLine).toContain('Beta');
  });

  it('clamps the cursor after deleting a book', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha');
    addBook(db, '/tmp/b.fb2', 'Beta');
    const props = makeProps();
    const { stdin, lastFrame } = render(<LibraryView {...props} />);
    await settle();
    stdin.write('G');
    await settle();
    // Delete the last book ('Beta') and confirm.
    stdin.write('d');
    await settle();
    stdin.write('y');
    await settle();
    expect(db.listBooks()).toHaveLength(1);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Beta');
    // Cursor must stay on a valid row: 'Alpha' is still selected.
    const selLine = frame.split('\n').find((l) => l.includes('▶'));
    expect(selLine).toBeDefined();
    expect(selLine).toContain('Alpha');
  });
});
