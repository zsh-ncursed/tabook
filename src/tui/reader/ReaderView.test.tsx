import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ReaderView } from './ReaderView.js';
import type { ReaderSession } from './readerModel.js';
import type { LibraryDb } from '../../db/db.js';
import type { ParsedBook } from '../../formats/model.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';

const theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;
const config = defaultConfig();

const book: ParsedBook = {
  format: 'fb2',
  path: '/tmp/test.fb2',
  filename: 'test.fb2',
  size: 1000,
  metadata: {
    title: 'Test Book',
    authors: [{ firstName: 'A', lastName: 'B', nickname: 'AB' }],
    genres: [],
    annotation: 'Test annotation.',
  },
  toc: [
    { id: 'toc-1', label: 'Chapter 1', level: 1, blockIndex: 0 },
    { id: 'toc-2', label: 'Chapter 2', level: 1, blockIndex: 1 },
    { id: 'toc-3', label: 'Chapter 3', level: 1, blockIndex: 2 },
  ],
  content: [{ type: 'paragraph', children: [{ kind: 'text', text: 'Hello world.' }] }],
  resources: new Map(),
};

// Minimal mock — only the methods/properties ReaderView accesses.
function makeSession(overrides: Partial<ReaderSession> = {}): ReaderSession {
  const session = {
    book,
    get bookId() {
      return null;
    },
    setViewport: vi.fn(),
    scrollDown: vi.fn(),
    scrollUp: vi.fn(),
    pageDown: vi.fn(),
    pageUp: vi.fn(),
    goToStart: vi.fn(),
    goToEnd: vi.fn(),
    pageNumber: 0,
    totalPages: vi.fn(() => 1),
    percent: vi.fn(() => 0),
    pageHeight: vi.fn(() => 10),
    viewportLines: vi.fn(() => []),
    searchState: vi.fn(() => ({ query: '', matches: 0, current: 0 })),
    nextMatch: vi.fn(() => false),
    prevMatch: vi.fn(() => false),
    textNear: vi.fn(() => ''),
    isSimplified: false,
    setSimplified: vi.fn(),
    isJustify: false,
    setJustify: vi.fn(),
    isWide: false,
    setWide: vi.fn(),
    setBookId: vi.fn(),
    addBookmarkAtCurrent: vi.fn(() => 1),
    gotoBookmark: vi.fn(),
    goToToc: vi.fn(),
    goToCharOffset: vi.fn(),
    saveProgress: vi.fn(),
    charOffset: vi.fn(() => 0),
  };
  return { ...session, ...overrides } as unknown as ReaderSession;
}

function makeDb(overrides: Partial<LibraryDb> = {}): LibraryDb {
  const db = {
    listBookmarks: vi.fn(() => []),
    deleteBookmark: vi.fn(),
    updateBookmarkLabel: vi.fn(),
    addBookmark: vi.fn(() => 1),
    getStats: vi.fn(() => ({
      totalSeconds: 0,
      totalPages: 0,
      sessionCount: 0,
      lastReadAt: null,
    })),
    getProgress: vi.fn(() => undefined),
  };
  return { ...db, ...overrides } as unknown as LibraryDb;
}

function makeProps(overrides: Partial<Parameters<typeof ReaderView>[0]> = {}) {
  const session = makeSession();
  const db = makeDb();
  const onClose = vi.fn();
  return {
    session,
    config,
    theme,
    db,
    notify: vi.fn(),
    onClose,
    onSave: vi.fn(() => null),
    onOpenFile: vi.fn(),
    onHelp: vi.fn(),
    runCommand: vi.fn(),
    completeCommand: vi.fn(() => null),
    ...overrides,
  };
}

describe('ReaderView modal escape behavior', () => {
  it('opens info with i and closes with escape', async () => {
    const props = makeProps();
    const { stdin, lastFrame } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    // Open info modal
    stdin.write('i');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Book Info');
    // Close with escape
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Book Info');
  });

  it('reopens info after closing and escape still works', async () => {
    const props = makeProps();
    const { stdin, lastFrame } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    // First open
    stdin.write('i');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Book Info');
    // First close
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Book Info');
    // Reopen
    stdin.write('i');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Book Info');
    // Second close — this is where the bug manifests
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Book Info');
  });

  it('opens toc with t and closes with escape', async () => {
    const props = makeProps();
    const { stdin, lastFrame } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('t');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Table of Contents');
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Table of Contents');
  });

  it('reopens toc after closing and escape still works', async () => {
    const props = makeProps();
    const { stdin, lastFrame } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    // First open
    stdin.write('t');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Table of Contents');
    // First close
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Table of Contents');
    // Reopen
    stdin.write('t');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Table of Contents');
    // Second close — this is where the bug manifests
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Table of Contents');
  });

  it('does not call onClose (quit) when escape closes a modal', async () => {
    const props = makeProps();
    const { stdin } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    // Open toc
    stdin.write('t');
    await new Promise((r) => setTimeout(r, 50));
    // Close with escape — should NOT call onClose (quit app)
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it('TOC: navigate with j, close with esc, reopen, esc still closes', async () => {
    // Reproduce the exact user scenario: open TOC, move cursor down (j),
    // close with esc, reopen, esc again. The second esc must close — not
    // be swallowed by a stale useInput handler after the cursor re-render.
    const props = makeProps();
    const { stdin, lastFrame } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    // Open TOC
    stdin.write('t');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Table of Contents');
    // Move cursor down (triggers re-render → handler re-create race)
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 50));
    // Close with esc
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Table of Contents');
    // Reopen
    stdin.write('t');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Table of Contents');
    // Second esc — the bug: this was swallowed
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Table of Contents');
  });

  it('TOC: t+esc arriving in a single stdin chunk closes the modal', async () => {
    // When fast keypresses are coalesced into one stdin chunk ("t\u001b"),
    // Ink's parseKeypress only parses the first character, so the escape
    // would be dropped and the TOC would stay open. The handler must split
    // the chunk and dispatch each keypress.
    const props = makeProps();
    const { stdin, lastFrame } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('t\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Table of Contents');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('TOC: separate t then esc with no delay still closes (no swallowed key)', async () => {
    // Two back-to-back writes (as a fast real user types t then Esc) — the
    // second keypress must still close the TOC, even before any re-render.
    const props = makeProps();
    const { stdin, lastFrame } = render(<ReaderView {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('t');
    stdin.write('\u001b');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).not.toContain('Table of Contents');
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
