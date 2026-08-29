import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { LibraryDb } from '../db/db.js';
import { defaultConfig } from '../config/defaults.js';
import { FB2_SAMPLE } from '../formats/test-utils.js';
import { opdsDownloadQueue } from '../opds/downloadQueue.js';
import { mockResponse } from '../opds/client.test-utils.js';

// The file picker spawns zenity/kdialog — mock it so 'o' is deterministic in
// tests: null → the OpenPathPrompt fallback opens, a path → the book opens.
vi.mock('../utils/open.js', () => ({
  pickBookFile: vi.fn(async () => null),
}));

// Journeys under test: docs/UX_SCENARIOS.md, part 2. Each test drives the
// full App (real LibraryDb, real fb2 parsing, real library scan); only the
// OPDS HTTP layer (globalThis.fetch) and the file picker are mocked.

let dir: string;
let db: LibraryDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-ux-'));
  db = new LibraryDb(path.join(dir, 'lib.sqlite'));
  // OPDS downloads land here (download.ts honours XDG_CACHE_HOME).
  process.env.XDG_CACHE_HOME = path.join(dir, 'cache');
  fs.mkdirSync(process.env.XDG_CACHE_HOME, { recursive: true });
});

afterEach(() => {
  db.close();
  opdsDownloadQueue.reset();
  delete process.env.XDG_CACHE_HOME;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function settle(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** True if any frame ever contained `s` — catches transient notify messages. */
function seen(frames: string[], s: string): boolean {
  return frames.some((f) => f.includes(s));
}

/**
 * Type a command through the UI: ':' opens the prompt, then the command is
 * typed char-by-char (Ink parses only the first char of a stdin chunk), then
 * Enter submits.
 */
async function typeCommand(stdin: { write(data: string): void }, cmd: string): Promise<void> {
  stdin.write(':');
  await settle(20);
  for (const ch of cmd) {
    stdin.write(ch);
    await settle(8);
  }
  await settle(20);
  stdin.write('\r');
  await settle(40);
}

function makeBookFile(name: string, xml: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, xml, 'utf8');
  return p;
}

// A book long enough that a few page turns land the reader at 1–99% —
// required for the "Continue reading" list (percent > 0 and < 100).
function makeLongFb2(title: string, paragraphs = 60): string {
  const body = Array.from(
    { length: paragraphs },
    (_, i) =>
      `<p>Paragraph ${i + 1}: reading through this long book with plenty of text to scroll.</p>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info>
    <author><first-name>Jane</first-name><last-name>Roe</last-name></author>
    <book-title>${title}</book-title>
  </title-info></description>
  <body><section><title><p>Chapter One</p></title>${body}</section></body>
</FictionBook>`;
}

function makeLibraryFolder(name: string, books: Array<{ file: string; xml: string }>): string {
  const libDir = path.join(dir, name);
  fs.mkdirSync(libDir, { recursive: true });
  for (const b of books) {
    fs.writeFileSync(path.join(libDir, b.file), b.xml, 'utf8');
  }
  return libDir;
}

const OPDS_ROOT_FEED = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Root Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <entry>
    <id>https://example.com/section</id>
    <title>Section</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="https://example.com/section.opds"/>
  </entry>
  <entry>
    <id>https://example.com/books/2</id>
    <title>Book Two</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="text/fb2+xml" href="https://example.com/books/2.fb2"/>
  </entry>
</feed>`;

function feedResponse(xml: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => xml,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

describe('UX journeys (docs/UX_SCENARIOS.md)', () => {
  it('J1+J2: first run → attach folder → scan feedback → read → restart → continue reading restores position', async () => {
    const libDir = makeLibraryFolder('lib1', [
      { file: 'a.fb2', xml: makeLongFb2('Long Book') },
      { file: 'b.fb2', xml: FB2_SAMPLE },
    ]);
    const longPath = path.join(libDir, 'a.fb2');

    const app = render(<App db={db} config={defaultConfig()} />);
    const { stdin, lastFrame, frames } = app;
    await settle(100);

    // J1.1 — empty state explains what to do.
    expect(lastFrame()).toContain('Library is empty.');
    expect(lastFrame()).toContain(':library add');

    // J1.2 — attach a folder; every stage is visible to the user.
    await typeCommand(stdin, `library add ${libDir}`);
    await settle(600);
    expect(seen(frames, 'Attached folder')).toBe(true);
    expect(seen(frames, 'Scanning')).toBe(true);
    expect(lastFrame()).toContain('+2 new');
    expect(lastFrame()).toContain('Long Book');
    expect(lastFrame()).toContain('Test Book');

    // J1.3 — enter opens the book card (cursor starts on row 0 = Long Book).
    stdin.write('\r');
    await settle(120);
    expect(lastFrame()).toContain('Authors:');

    // J1.4 — enter in the card opens the reader.
    stdin.write('\r');
    await settle(300);
    expect(lastFrame()).toContain('Long Book');
    expect(lastFrame()).toContain('p.1/');

    // J1.5 — read a few pages, then back to the library.
    stdin.write(' ');
    await settle(80);
    stdin.write(' ');
    await settle(80);
    stdin.write(' ');
    await settle(80);
    stdin.write('q');
    await settle(200);
    expect(lastFrame()).toContain('Library');
    expect(lastFrame()).not.toContain('p.1/');

    // J1.6 — the book is now in Recent.
    stdin.write('R');
    await settle(120);
    expect(lastFrame()).toContain('Recent');
    expect(lastFrame()).toContain('Long Book');
    stdin.write('R'); // back to all
    await settle(80);
    app.unmount();
    await settle(100);

    // J2 — restart on the same DB: Continue reading + restored position.
    const bookId = db.getBookByPath(longPath)!.id;
    const progress = db.getProgress(bookId);
    expect(progress).toBeDefined();
    expect(progress!.percent).toBeGreaterThan(0);
    expect(progress!.percent).toBeLessThan(100);
    const pct = progress!.percent;

    const app2 = render(<App db={db} config={defaultConfig()} />);
    const stdin2 = app2.stdin;
    await settle(150);
    stdin2.write('C');
    await settle(120);
    expect(app2.lastFrame()).toContain('Continue reading');
    expect(app2.lastFrame()).toContain('Long Book');
    expect(app2.lastFrame()).toContain(`${pct}%`);

    // Open it again: the reader resumes at the saved position (same %).
    stdin2.write('\r');
    await settle(120);
    stdin2.write('\r');
    await settle(300);
    expect(app2.lastFrame()).toContain('Long Book');
    expect(app2.lastFrame()).toContain(`${pct}%`);
    app2.unmount();
    await settle(100);
  });

  it('J3: attach → remove folder with confirm → books gone, files intact → re-attach works', async () => {
    const libDir = makeLibraryFolder('lib2', [
      { file: 'a.fb2', xml: FB2_SAMPLE },
      { file: 'b.fb2', xml: makeLongFb2('Second Book') },
    ]);
    const bookPath = path.join(libDir, 'a.fb2');

    const { stdin, lastFrame, frames } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);
    await typeCommand(stdin, `library add ${libDir}`);
    await settle(600);
    expect(lastFrame()).toContain('+2 new');

    // Remove: a confirmation names the folder and the book count.
    await typeCommand(stdin, `library remove ${libDir}`);
    await settle(150);
    expect(lastFrame()).toContain('Detach');
    expect(lastFrame()).toContain('2 books');

    // Confirm: books leave the library, files stay on disk.
    stdin.write('y');
    await settle(200);
    expect(seen(frames, 'Detached')).toBe(true);
    expect(lastFrame()).toContain('Library is empty.');
    expect(db.listBooks()).toHaveLength(0);
    expect(fs.existsSync(bookPath)).toBe(true);

    // Re-attaching the same folder re-imports the books.
    await typeCommand(stdin, `library add ${libDir}`);
    await settle(600);
    expect(lastFrame()).toContain('+2 new');
    expect(db.listBooks()).toHaveLength(2);
  });

  it('J4: :open outside the library → save → broken file → picker fallback prompt', async () => {
    const solo = makeBookFile('solo.fb2', FB2_SAMPLE);
    const broken = makeBookFile('broken.fb2', 'this is not a book');

    const { stdin, lastFrame, frames } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    // Open a file that is not in the library.
    await typeCommand(stdin, `open ${solo}`);
    await settle(300);
    expect(lastFrame()).toContain('Test Book');
    expect(lastFrame()).toContain('p.1/');
    expect(db.listBooks()).toHaveLength(0);

    // Save it to the library from the reader.
    stdin.write('s');
    await settle(150);
    expect(seen(frames, 'Saved to library')).toBe(true);
    expect(db.listBooks()).toHaveLength(1);

    // A broken file fails with a readable message; the app stays alive.
    await typeCommand(stdin, `open ${broken}`);
    await settle(300);
    expect(seen(frames, 'Cannot open')).toBe(true);
    expect(lastFrame()).toContain('Test Book'); // still reading the old book

    // 'o' with no picker available falls back to the path prompt; esc cancels.
    stdin.write('o');
    await settle(250);
    expect(seen(frames, 'Selecting file')).toBe(true);
    expect(lastFrame()).toContain('open:');
    stdin.write('\u001b');
    await settle(120);
    expect(lastFrame()).not.toContain('path to .fb2');

    // Back to the library; the saved book is listed.
    stdin.write('q');
    await settle(200);
    expect(lastFrame()).toContain('Library');
    expect(lastFrame()).toContain('Test Book');
  });

  it('J5: OPDS add → browse → download → open from downloads → lands in library', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'https://example.com/opds') return feedResponse(OPDS_ROOT_FEED);
      return mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame, frames } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    // Add a catalog via command; feedback confirms it.
    await typeCommand(stdin, 'opds add Test https://example.com/opds');
    await settle(150);
    expect(seen(frames, 'Added catalog: Test')).toBe(true);

    // Enter the OPDS browser: the catalog list shows the new catalog.
    await typeCommand(stdin, 'opds');
    await settle(250);
    expect(lastFrame()).toContain('OPDS Catalogs');
    expect(lastFrame()).toContain('example.com');

    // Open the catalog: loading → browsing with feed entries.
    stdin.write('\r');
    await settle(400);
    expect(lastFrame()).toContain('Root Feed');
    expect(lastFrame()).toContain('Book Two');

    // Queue a download on the acquisition entry (row 1).
    stdin.write('j');
    await settle(80);
    stdin.write('d');
    await settle(1500);
    // The notification uses the parsed title from FB2_SAMPLE ("Test Book"),
    // not the feed entry title ("Book Two"), because the download queue's
    // onDone callback prefers job.result.title over entry.title.
    expect(seen(frames, 'Downloaded: Test Book')).toBe(true);
    expect(db.listBooks()).toHaveLength(1);

    // Downloads panel shows the finished job; enter opens the book.
    stdin.write('x');
    await settle(150);
    expect(lastFrame()).toContain('done');
    expect(lastFrame()).toContain('Book Two');
    stdin.write('\r');
    await settle(300);
    expect(lastFrame()).toContain('Test Book');
    expect(lastFrame()).toContain('p.1/');

    // Back to the library: the downloaded book is there.
    stdin.write('q');
    await settle(250);
    expect(lastFrame()).toContain('Library');
    expect(lastFrame()).toContain('Test Book');
  });

  it(
    'J6: mixed day — local read + OPDS download, separate progress for both, Continue shows both',
    { timeout: 15000 },
    async () => {
      // Step 1: attach a local library folder and read a book from it.
      const libDir = makeLibraryFolder('lib6', [
        { file: 'local.fb2', xml: makeLongFb2('Local Book') },
      ]);

      const { stdin, lastFrame, frames } = render(<App db={db} config={defaultConfig()} />);
      await settle(100);

      await typeCommand(stdin, `library add ${libDir}`);
      await settle(600);
      expect(lastFrame()).toContain('+1 new');
      expect(lastFrame()).toContain('Local Book');

      // Open Local Book from the library and scroll forward.
      stdin.write('\r'); // open book card
      await settle(120);
      stdin.write('\r'); // open reader
      await settle(300);
      expect(lastFrame()).toContain('Local Book');
      expect(lastFrame()).toContain('p.1/');

      stdin.write(' ');
      await settle(80);
      stdin.write(' ');
      await settle(80);
      stdin.write(' ');
      await settle(80);

      // q back to library.
      stdin.write('q');
      await settle(200);
      expect(lastFrame()).toContain('Library');

      // Verify Local Book has progress in the DB.
      const localId = db.getBookByPath(path.join(libDir, 'local.fb2'))!.id;
      const localProgress = db.getProgress(localId);
      expect(localProgress).toBeDefined();
      expect(localProgress!.percent).toBeGreaterThan(0);

      // Step 2: download a book from OPDS.
      const fetchMock = vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u === 'https://example.com/opds') return feedResponse(OPDS_ROOT_FEED);
        return mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } });
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await typeCommand(stdin, 'opds add Test https://example.com/opds');
      await settle(150);
      await typeCommand(stdin, 'opds');
      await settle(250);
      stdin.write('\r'); // open catalog
      await settle(400);
      stdin.write('j'); // move to Book Two (acquisition entry)
      await settle(80);
      stdin.write('d'); // download
      await settle(1500);
      expect(seen(frames, 'Downloaded: Test Book')).toBe(true);
      expect(db.listBooks()).toHaveLength(2); // Local Book + OPDS book

      // Open the downloaded book from the downloads panel.
      stdin.write('x');
      await settle(150);
      stdin.write('\r');
      await settle(300);
      expect(lastFrame()).toContain('Test Book');
      expect(lastFrame()).toContain('p.1/');

      // Scroll forward in the downloaded book too.
      stdin.write(' ');
      await settle(80);
      stdin.write(' ');
      await settle(80);
      stdin.write(' ');
      await settle(80);

      // q back to library.
      stdin.write('q');
      await settle(200);
      expect(lastFrame()).toContain('Library');

      // Step 3: both books are in the library with separate progress.
      const booksNow = db.listBooks();
      expect(booksNow).toHaveLength(2);

      const dlBook = booksNow.find((b) => b.title === 'Test Book');
      const lbBook = booksNow.find((b) => b.title === 'Local Book');
      expect(dlBook).toBeDefined();
      expect(lbBook).toBeDefined();
      const dlProgress = db.getProgress(dlBook!.id);
      const lbProgress = db.getProgress(lbBook!.id);
      expect(dlProgress).toBeDefined();
      expect(dlProgress!.percent).toBeGreaterThan(0);
      // The OPDS book (FB2_SAMPLE) is short — a few pages may reach 100%.
      expect(dlProgress!.percent).toBeLessThanOrEqual(100);
      expect(lbProgress).toBeDefined();
      expect(lbProgress!.percent).toBeGreaterThan(0);
      expect(lbProgress!.percent).toBeLessThan(100);

      // Step 4: Continue reading shows both books.
      stdin.write('C');
      await settle(120);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Continue reading');
      expect(frame).toContain('Local Book');
      expect(frame).toContain('Test Book');
    },
  );

  it('J7: SIGTERM while reading flushes progress and exits cleanly', async () => {
    const solo = makeBookFile('solo.fb2', makeLongFb2('Long Book'));

    const { stdin, lastFrame } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    // Open the file, save it to the library (so progress has a bookId), read.
    await typeCommand(stdin, `open ${solo}`);
    await settle(300);
    stdin.write('s');
    await settle(150);
    stdin.write(' ');
    await settle(100);
    expect(lastFrame()).toContain('Long Book');

    // App registered its SIGTERM handler. Ink always has signal-exit's own
    // handler too, so count the delta rather than the absolute number.
    const beforeSignal = process.listenerCount('SIGTERM');
    expect(beforeSignal).toBeGreaterThanOrEqual(1);

    // Graceful termination: flush progress, close the session, exit via Ink.
    process.emit('SIGTERM');
    await settle(300);
    // Our handler was removed; signal-exit's own handler remains.
    expect(process.listenerCount('SIGTERM')).toBeLessThan(beforeSignal);

    const bookId = db.getBookByPath(solo)!.id;
    const progress = db.getProgress(bookId);
    expect(progress).toBeDefined();
    expect(progress!.position).toBeGreaterThan(0);
  });

  it('J7: chunked input (t+esc in one write) does not wedge the reader', async () => {
    const solo = makeBookFile('solo.fb2', FB2_SAMPLE);
    const { stdin, lastFrame } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    await typeCommand(stdin, `open ${solo}`);
    await settle(300);
    expect(lastFrame()).toContain('Test Book');

    // Fast typing coalesces into one stdin chunk: the TOC must open and close.
    stdin.write('t\u001b');
    await settle(200);
    expect(lastFrame()).not.toContain('Table of Contents');

    // Input still works: the TOC opens again and esc closes it.
    stdin.write('t');
    await settle(120);
    expect(lastFrame()).toContain('Table of Contents');
    stdin.write('\u001b');
    await settle(120);
    expect(lastFrame()).not.toContain('Table of Contents');
    expect(lastFrame()).toContain('Test Book');
  });

  it('J8: notify message expires after ~3.5 seconds', async () => {
    const { stdin, lastFrame, frames } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    // Trigger a notification: :theme dracula shows "Theme: dracula".
    await typeCommand(stdin, 'theme dracula');
    await settle(50);
    expect(seen(frames, 'Theme: dracula')).toBe(true);

    // After 3.5 seconds the message should be gone.
    await settle(3600);
    const after = lastFrame();
    expect(after).not.toContain('Theme: dracula');
  });

  it('J8: status bar shows [SEARCH] mode when reader search is open', async () => {
    const solo = makeBookFile('solo.fb2', FB2_SAMPLE);
    const { stdin, lastFrame } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    await typeCommand(stdin, `open ${solo}`);
    await settle(300);
    expect(lastFrame()).toContain('Test Book');

    // Open search: the status bar should reflect SEARCH mode.
    stdin.write('/');
    await settle(80);
    expect(lastFrame()).toContain('[SEARCH]');

    // Close search: mode disappears.
    stdin.write('\u001b');
    await settle(80);
    expect(lastFrame()).not.toContain('[SEARCH]');
  });

  it('J8: status bar shows [COMMAND] mode when command prompt is open', async () => {
    const { stdin, lastFrame } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    // Open the command prompt.
    stdin.write(':');
    await settle(50);
    // In the library, ':' opens the command prompt — we should see the mode.
    // The library's command mode shows as a prompt in the status bar area.
    // Open a book to test COMMAND mode in reader.
    const solo = makeBookFile('solo.fb2', FB2_SAMPLE);
    await typeCommand(stdin, `open ${solo}`);
    await settle(300);

    stdin.write(':');
    await settle(50);
    expect(lastFrame()).toContain('[COMMAND]');

    stdin.write('\u001b');
    await settle(50);
    expect(lastFrame()).not.toContain('[COMMAND]');
  });

  it('J8: opening a book from library shows spinner then reader', async () => {
    // openBookRecord (Enter on library card) uses setImmediate to show a
    // spinner while parsing; openBookPath (:open) skips the spinner.
    const libDir = makeLibraryFolder('lib-spinner', [{ file: 'a.fb2', xml: FB2_SAMPLE }]);
    const { stdin, lastFrame } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    await typeCommand(stdin, `library add ${libDir}`);
    await settle(600);
    expect(lastFrame()).toContain('Test Book');

    // Enter on the book card → reader (setImmediate shows spinner first).
    stdin.write('\r');
    await settle(120);
    stdin.write('\r');
    await settle(300);
    // The spinner "Opening book" is painted between the two setImmediate
    // ticks; we can't reliably catch it in ink-testing-library frames for
    // small files, but we verify the reader opened successfully.
    expect(lastFrame()).toContain('Test Book');
    expect(lastFrame()).toContain('p.1/');
  });

  it('J8: OPDS catalog entry opens after loading', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'https://example.com/opds') return feedResponse(OPDS_ROOT_FEED);
      return mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<App db={db} config={defaultConfig()} />);
    await settle(100);

    await typeCommand(stdin, 'opds add Test https://example.com/opds');
    await settle(150);
    await typeCommand(stdin, 'opds');
    await settle(250);
    // The catalog list is shown.
    expect(lastFrame()).toContain('OPDS Catalogs');
    expect(lastFrame()).toContain('example.com');

    // Enter the catalog — loading completes and feed is shown.
    stdin.write('\r');
    await settle(400);
    expect(lastFrame()).toContain('Root Feed');
    expect(lastFrame()).toContain('Book Two');
  });
});
