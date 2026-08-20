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
import { imageLayer } from '../imageLayer.js';
import { FB2_SAMPLE } from '../../formats/test-utils.js';

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
  vi.restoreAllMocks();
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
      // Selected rows are marked with '▸'. Headers never carry the marker.
      const selLine = frame.split('\n').find((l) => l.includes('▸'));
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
    const selLine = frame.split('\n').find((l) => l.includes('▸'));
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
    const selLine = frame.split('\n').find((l) => l.includes('▸'));
    expect(selLine).toBeDefined();
    expect(selLine).toContain('Alpha');
  });
});

describe('LibraryView cover thumbnails', () => {
  it('draws a cover thumbnail for a book with a coverKey', async () => {
    const filePath = path.join(dir, 'cover.fb2');
    fs.writeFileSync(filePath, FB2_SAMPLE, 'utf8');
    db.addBook({
      path: filePath,
      filename: 'cover.fb2',
      format: 'fb2',
      size: fs.statSync(filePath).size,
      metadata: {
        title: 'With Cover',
        authors: [{ firstName: 'A', lastName: 'B' }],
        genres: [],
        annotation: '',
        coverKey: 'cover.jpg',
      },
    });
    // Force the facade's start() to succeed so update() is reachable.
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    const { lastFrame } = render(<LibraryView {...makeProps()} />);
    await settle();
    expect(lastFrame() ?? '').toContain('With Cover');
    expect(updateSpy).toHaveBeenCalled();
    const [placements] = updateSpy.mock.calls.at(-1)! as [
      Array<{ identifier: string; width: number; height: number }>,
      Map<string, Uint8Array>,
    ];
    expect(placements.length).toBe(1);
    expect(placements[0]!.identifier).toMatch(/^lib-cover-/);
    expect(placements[0]!.width).toBeGreaterThan(0);
    expect(placements[0]!.height).toBe(3);
  });

  it('repositions remaining covers after a book is deleted', async () => {
    // Three books with covers: A(y=1), B(y=4), C(y=7). Deleting B (cursor
    // row 1) must re-draw C at y=4 — not leave it at its old y=7 position.
    for (const t of ['A', 'B', 'C']) {
      const filePath = path.join(dir, `${t}.fb2`);
      fs.writeFileSync(filePath, FB2_SAMPLE, 'utf8');
      db.addBook({
        path: filePath,
        filename: `${t}.fb2`,
        format: 'fb2',
        size: fs.statSync(filePath).size,
        metadata: {
          title: `Book ${t}`,
          authors: [{ firstName: 'A', lastName: 'B' }],
          genres: [],
          annotation: '',
          coverKey: 'cover.jpg',
        },
      });
    }
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    const { stdin } = render(<LibraryView {...makeProps()} />);
    await settle();
    // Cursor is on Book A (row 0); move to Book B (row 1) and delete it.
    stdin.write('j');
    await settle();
    stdin.write('d');
    await settle();
    stdin.write('y');
    await settle();
    const [placements] = updateSpy.mock.calls.at(-1)! as [
      Array<{ identifier: string; y: number }>,
      Map<string, Uint8Array>,
    ];
    const ys = placements.map((p) => p.y).sort((a, b) => a - b);
    expect(ys).toEqual([1, 4]);
  });

  it('repositions remaining covers after a book is deleted (full call sequence)', async () => {
    // Five books; delete the middle one while the list is scrolled so the
    // visible window shifts. Every update call must carry correct y's for
    // the rows it represents — a stale call (old y for a moved cover) is
    // what would look like "images shifted up" in the terminal.
    for (const t of ['A', 'B', 'C', 'D', 'E']) {
      const filePath = path.join(dir, `${t}.fb2`);
      fs.writeFileSync(filePath, FB2_SAMPLE, 'utf8');
      db.addBook({
        path: filePath,
        filename: `${t}.fb2`,
        format: 'fb2',
        size: fs.statSync(filePath).size,
        metadata: {
          title: `Book ${t}`,
          authors: [{ firstName: 'A', lastName: 'B' }],
          genres: [],
          annotation: '',
          coverKey: 'cover.jpg',
        },
      });
    }
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    const { stdin } = render(<LibraryView {...makeProps()} />);
    await settle();
    // Cursor: Book A → C (2 j presses; B is at index 1).
    stdin.write('j');
    await settle();
    stdin.write('j');
    await settle();
    // Delete Book C (the selected one).
    stdin.write('d');
    await settle();
    stdin.write('y');
    await settle();
    const lastCall = updateSpy.mock.calls.at(-1)! as [
      Array<{ identifier: string; y: number }>,
      Map<string, Uint8Array>,
    ];
    const ys = lastCall[0].map((p) => p.y).sort((a, b) => a - b);
    // Books A, B, D, E remain; their covers sit at y=1,4,7,10 (CARD_ROWS=3
    // apart), with no gap where C was.
    expect(ys).toEqual([1, 4, 7, 10]);
    expect(lastCall[0]).toHaveLength(4);
  });

  it('keeps covers drawn while the filter prompt is open', async () => {
    // The filter prompt is an inline row below the list, not a modal —
    // covers must stay (and re-draw for the narrowed window as you type)
    // instead of being cleared on every '/' keystroke.
    for (const t of ['Alpha', 'Beta']) {
      const filePath = path.join(dir, `${t}.fb2`);
      fs.writeFileSync(filePath, FB2_SAMPLE, 'utf8');
      db.addBook({
        path: filePath,
        filename: `${t}.fb2`,
        format: 'fb2',
        size: fs.statSync(filePath).size,
        metadata: {
          title: `Book ${t}`,
          authors: [{ firstName: 'A', lastName: 'B' }],
          genres: [],
          annotation: '',
          coverKey: 'cover.jpg',
        },
      });
    }
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    const clearSpy = vi.spyOn(imageLayer, 'clear');
    const { stdin } = render(<LibraryView {...makeProps()} />);
    await settle();
    // Covers are drawn initially (2 placements).
    expect(clearSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalled();
    // Open the filter prompt: covers must NOT be cleared.
    stdin.write('/');
    await settle();
    expect(clearSpy).not.toHaveBeenCalled();
    // Typing a narrowing query re-draws covers for the filtered window.
    // The live filter debounces 120ms, so wait past it. 'alp' only matches
    // 'Book Alpha', so Beta's cover must leave the window.
    for (const ch of 'alp') {
      stdin.write(ch);
      await settle(200);
    }
    expect(clearSpy).not.toHaveBeenCalled();
    const [placements] = updateSpy.mock.calls.at(-1)! as [
      Array<{ identifier: string }>,
      Map<string, Uint8Array>,
    ];
    expect(placements.length).toBe(1);
  });

  it('does not draw covers when an App-level overlay (inputDisabled) is open', async () => {
    const filePath = path.join(dir, 'cover.fb2');
    fs.writeFileSync(filePath, FB2_SAMPLE, 'utf8');
    db.addBook({
      path: filePath,
      filename: 'cover.fb2',
      format: 'fb2',
      size: fs.statSync(filePath).size,
      metadata: {
        title: 'With Cover',
        authors: [{ firstName: 'A', lastName: 'B' }],
        genres: [],
        annotation: '',
        coverKey: 'cover.jpg',
      },
    });
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    const clearSpy = vi.spyOn(imageLayer, 'clear');
    render(<LibraryView {...makeProps({ inputDisabled: true })} />);
    await settle();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('LibraryView mouse clicks', () => {
  it('a click moves the cursor to the row under it', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha Book');
    addBook(db, '/tmp/b.fb2', 'Beta Book');
    const { lastFrame } = render(<LibraryView {...makeProps()} />);
    await settle();
    // Rows start below the 1-line header; each card is CARD_ROWS (3) tall,
    // so row 0 spans y=2..4 and row 1 spans y=5..7 (1-based terminal Y).
    emitMouseClick({ x: 5, y: 6, button: 'left', press: true, motion: false });
    await settle();
    const frame = lastFrame() ?? '';
    const selLine = frame.split('\n').find((l) => l.includes('▸'));
    expect(selLine).toBeDefined();
    expect(selLine).toContain('Beta Book');
  });

  it('a second click on the same row opens the book detail', async () => {
    addBook(db, '/tmp/a.fb2', 'Alpha Book');
    const { lastFrame } = render(<LibraryView {...makeProps()} />);
    await settle();
    emitMouseClick({ x: 5, y: 2, button: 'left', press: true, motion: false }); // row 0
    await settle();
    emitMouseClick({ x: 5, y: 2, button: 'left', press: true, motion: false }); // double-click
    await settle();
    const frame = lastFrame() ?? '';
    // BookDetail modal opened: metadata line is visible.
    expect(frame).toContain('Authors:');
  });
});
