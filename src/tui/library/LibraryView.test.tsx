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
import { emitMouseClick } from '../mouse.js';

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

async function settle(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
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

  it('toggles the continue-reading view with C', async () => {
    const done = addBook(db, '/tmp/done.fb2', 'Finished');
    const reading = addBook(db, '/tmp/reading.fb2', 'In Progress');
    db.setProgress(reading, 100, 42);
    db.setProgress(done, 999, 100);
    const props = makeProps();
    const { stdin, lastFrame } = render(<LibraryView {...props} />);
    await settle();
    stdin.write('C');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Continue reading');
    expect(frame).toContain('In Progress');
    expect(frame).toContain('42%');
    expect(frame).not.toContain('Finished');
  });

  it('live-filters the list as you type (debounced, no Enter needed)', async () => {
    addBook(db, '/tmp/alpha.fb2', 'Alpha Book');
    addBook(db, '/tmp/beta.fb2', 'Beta Book');
    const props = makeProps();
    const { stdin, lastFrame } = render(<LibraryView {...props} />);
    await settle();
    expect(lastFrame() ?? '').toContain('Beta Book');
    // Open the filter prompt and type "alpha": the list narrows without Enter.
    stdin.write('/');
    await settle(30);
    for (const ch of 'alpha') {
      stdin.write(ch);
      await settle(10);
    }
    // Wait out the 120ms debounce.
    await settle(250);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Alpha Book');
    expect(frame).not.toContain('Beta Book');
    // Escape restores the previous (empty) filter.
    stdin.write('\u001b');
    await settle(50);
    expect(lastFrame() ?? '').toContain('Beta Book');
  });

  it('shows an annotation preview for the selected book', async () => {
    db.addBook({
      path: '/tmp/ann.fb2',
      filename: 'ann.fb2',
      format: 'fb2',
      size: 100,
      metadata: {
        title: 'Annotated',
        authors: [{ firstName: 'A', lastName: 'B' }],
        genres: [],
        annotation: 'A short but meaningful annotation about this book.',
      },
    });
    const props = makeProps();
    const { lastFrame } = render(<LibraryView {...props} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Annotation');
    expect(frame).toContain('A short but meaningful annotation');
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

describe('LibraryView mouse clicks', () => {
  it('a click moves the cursor to the row under it', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha Book');
    addBook(db, '/tmp/b.fb2', 'Beta Book');
    const { lastFrame } = render(<LibraryView {...makeProps()} />);
    await settle();
    // Rows start below the 1-line header: y=2 → row 0, y=3 → row 1.
    emitMouseClick({ x: 5, y: 3, button: 'left', press: true });
    await settle();
    const frame = lastFrame() ?? '';
    const selLine = frame.split('\n').find((l) => l.includes('▶'));
    expect(selLine).toBeDefined();
    expect(selLine).toContain('Beta Book');
  });

  it('a second click on the same row opens the book detail', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha Book');
    const { lastFrame } = render(<LibraryView {...makeProps()} />);
    await settle();
    emitMouseClick({ x: 5, y: 2, button: 'left', press: true }); // row 0
    await settle();
    emitMouseClick({ x: 5, y: 2, button: 'left', press: true }); // double-click
    await settle();
    const frame = lastFrame() ?? '';
    // BookDetail modal opened: metadata line is visible.
    expect(frame).toContain('Authors:');
  });
});
