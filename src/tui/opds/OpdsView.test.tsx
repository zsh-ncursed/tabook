import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { OpdsView } from './OpdsView.js';
import { LibraryDb } from '../../db/db.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';
import type { Theme } from '../../themes/themes.js';
import { opdsDownloadQueue } from '../../opds/downloadQueue.js';
import { mockResponse } from '../../opds/client.test-utils.js';
import { FB2_SAMPLE } from '../../formats/test-utils.js';
import { emitMouseClick } from '../mouse.js';
import { imageLayer } from '../imageLayer.js';

const theme: Theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;
const config = defaultConfig();

// The desktop notification is a real subprocess in production; stub it so a
// test can assert "download finished → user was told" without notify-send.
// Hoisted (vi.mock is hoisted itself) so the module import sees the mock.
vi.mock('../../notify/desktop.js', () => ({
  notifyDesktop: vi.fn(),
  __resetDesktopNotifyForTests: vi.fn(),
}));

/** Returns the stubbed notifyDesktop, cleared for the current test. */
async function mockDesktopNotify(): Promise<ReturnType<typeof vi.fn>> {
  const m = (await import('../../notify/desktop.js')).notifyDesktop as ReturnType<typeof vi.fn>;
  m.mockClear();
  return m;
}

let dir: string;
let db: LibraryDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-opds-test-'));
  db = new LibraryDb(path.join(dir, 'lib.sqlite'));
});

afterEach(() => {
  db.close();
  opdsDownloadQueue.reset();
  delete process.env.XDG_CACHE_HOME;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeProps(overrides: Partial<Parameters<typeof OpdsView>[0]> = {}) {
  return {
    db,
    config,
    theme,
    notify: vi.fn(),
    onExit: vi.fn(),
    onHelp: vi.fn(),
    onOpenDownloaded: vi.fn(),
    inputDisabled: false,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 100));
}

describe('OpdsView — catalog list', () => {
  it('shows empty state when no catalogs', async () => {
    const { lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No OPDS catalogs');
  });

  it('lists configured catalogs', async () => {
    db.addCatalog({ name: 'Gutenberg', url: 'https://m.gutenberg.org/ebooks.opds/' });
    db.addCatalog({ name: 'Anarchist', url: 'https://theanarchistlibrary.org/opds' });
    const { lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Gutenberg');
    expect(frame).toContain('Anarchist');
    expect(frame).toContain('m.gutenberg.org');
  });

  it('shows lock icon for catalogs with credentials', async () => {
    db.addCatalog({
      name: 'Standard Ebooks',
      url: 'https://standardebooks.org/feeds/opds',
      username: 'user@example.com',
      password: 'secret',
    });
    const { lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Standard Ebooks');
    expect(frame).toContain('#');
  });

  it('exits to library on q', async () => {
    db.addCatalog({ name: 'Gutenberg', url: 'https://x/' });
    const onExit = vi.fn();
    const { stdin } = render(<OpdsView {...makeProps({ onExit })} />);
    await settle();
    stdin.write('q');
    await settle();
    expect(onExit).toHaveBeenCalled();
  });

  it('calls onExit on esc from catalog list', async () => {
    db.addCatalog({ name: 'Gutenberg', url: 'https://x/' });
    const onExit = vi.fn();
    const { stdin } = render(<OpdsView {...makeProps({ onExit })} />);
    await settle();
    stdin.write('\x1b');
    await settle();
    expect(onExit).toHaveBeenCalled();
  });

  it('enter opens the highlighted catalog, not always the first', async () => {
    db.addCatalog({ name: 'Alpha', url: 'https://a/' });
    db.addCatalog({ name: 'Beta', url: 'https://b/' });
    const feedXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://b/</id><title>Feed B</title><updated>2026-01-01T00:00:00Z</updated><link rel="self" href="https://b/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/></feed>`;
    globalThis.fetch = vi.fn(async () =>
      feedResponse(feedXml),
    ) as unknown as typeof globalThis.fetch;
    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    // Move cursor to Beta
    stdin.write('j');
    await settle();
    expect(lastFrame() ?? '').toContain('▸ Beta');
    // Press Enter — should open Beta, not Alpha
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    expect(lastFrame() ?? '').toContain('Feed B');
    // Verify fetch was called with Beta's URL
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(fetchCalls.some((c: unknown[]) => String(c[0]).includes('b/'))).toBe(true);
  });
});

describe('OpdsView — browsing', () => {
  it('debug: j moves cursor in catalog list', async () => {
    db.addCatalog({ name: 'A', url: 'https://a/' });
    db.addCatalog({ name: 'B', url: 'https://b/' });
    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    const before = lastFrame() ?? '';
    expect(before).toContain('A');
    expect(before).toContain('B');
    stdin.write('j');
    await settle();
    const after = lastFrame() ?? '';
    expect(after).toContain('▸ B');
  });

  it('fetches and displays feed entries on catalog open', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const feedXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Test Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <entry>
    <id>https://example.com/books/1</id>
    <title>Book One</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="https://example.com/books/1.opds"/>
  </entry>
  <entry>
    <id>https://example.com/books/2</id>
    <title>Book Two</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://example.com/books/2.epub"/>
  </entry>
</feed>`;
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => feedXml,
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const notify = vi.fn();
    const { stdin, lastFrame } = render(<OpdsView {...makeProps({ notify })} />);
    await settle();
    // Enter on the first catalog to open it
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 300));
    // Check that fetch was called
    expect(fetchMock).toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Test Feed');
    expect(frame).toContain('Book One');
    expect(frame).toContain('Book Two');
  });

  it('shows the page indicator from OpenSearch metadata', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const feedXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <id>https://example.com/opds</id>
  <title>Test Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="next" href="https://example.com/opds?page=2" type="application/atom+xml;profile=opds-catalog"/>
  <opensearch:startIndex>26</opensearch:startIndex>
  <opensearch:itemsPerPage>25</opensearch:itemsPerPage>
  <opensearch:totalResults>543</opensearch:totalResults>
  <entry><id>1</id><title>B1</title><updated>2026-01-01T00:00:00Z</updated></entry>
</feed>`;
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => feedXml,
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    ) as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    // startIndex 26 with itemsPerPage 25 → page 2 of ceil(543/25)=22
    expect(frame).toContain('page 2/22');
  });

  it('navigates to the previous page with p', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const makeFeed = (
      id: string,
      self: string,
      prev?: string,
      next?: string,
    ) => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${id}</id>
  <title>Feed ${id}</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="${self}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>${prev ? `<link rel="previous" href="${prev}" type="application/atom+xml;profile=opds-catalog"/>` : ''}${next ? `<link rel="next" href="${next}" type="application/atom+xml;profile=opds-catalog"/>` : ''}
  <entry><id>${id}-1</id><title>Entry ${id}</title><updated>2026-01-01T00:00:00Z</updated></entry>
</feed>`;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('page=2')) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () =>
            makeFeed('p2', u, 'https://example.com/opds', 'https://example.com/opds?page=3'),
          arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => makeFeed('p1', u, undefined, 'https://example.com/opds?page=2'),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    // Open catalog (page 1), go next (page 2), then back with p (page 1 again).
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 200));
    let frame = lastFrame() ?? '';
    expect(frame).toContain('Feed p2');
    stdin.write('p');
    await new Promise((r) => setTimeout(r, 200));
    frame = lastFrame() ?? '';
    expect(frame).toContain('Feed p1');
  });

  it('shows loading state while fetching', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Loading');

    // Resolve the fetch to clean up
    resolveFetch({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>x</title><updated>2026-01-01T00:00:00Z</updated></feed>',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    await settle();
  });

  it('shows error on fetch failure', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 404,
          headers: new Map(),
          text: async () => 'Not Found',
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Error');
    expect(frame).toContain('404');
  });

  it('returns to catalog list on esc from browsing', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const feedXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>Feed</title><updated>2026-01-01T00:00:00Z</updated><link rel="self" href="https://x" type="application/atom+xml;profile=opds-catalog;kind=navigation"/></feed>`;
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => feedXml,
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    ) as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('\x1b');
    await new Promise((r) => setTimeout(r, 100));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Test');
    expect(frame).toContain('example.com');
  });
});

describe('OpdsView — auth prompt on 401', () => {
  it('shows auth prompt on HTTP 401', async () => {
    db.addCatalog({ name: 'Protected', url: 'https://example.com/opds' });
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          headers: new Map(),
          text: async () => 'Unauthorized',
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    ) as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Authentication required');
    expect(frame).toContain('Protected');
    expect(frame).toContain('username:');
  });

  it('esc from auth prompt returns to catalog list', async () => {
    db.addCatalog({ name: 'Protected', url: 'https://example.com/opds' });
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          headers: new Map(),
          text: async () => 'Unauthorized',
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    ) as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('\x1b');
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Protected');
    expect(frame).not.toContain('Authentication required');
  });
});

function queueFeedXml(): string {
  return `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Queue Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <entry>
    <id>https://example.com/books/1</id>
    <title>Book One</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="https://example.com/books/1.opds"/>
  </entry>
  <entry>
    <id>https://example.com/books/2</id>
    <title>Book Two</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="text/fb2+xml" href="https://example.com/books/2.fb2"/>
  </entry>
  <entry>
    <id>https://example.com/books/3</id>
    <title>Book Three</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="text/fb2+xml" href="https://example.com/books/3.fb2"/>
  </entry>
</feed>`;
}

function feedResponse(xml: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => xml,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

// Two acquisition entries that share a title: identifying the download by
// title would match the wrong entry's detail.
function sameTitleFeedXml(): string {
  return `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Same Title Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <entry>
    <id>https://example.com/books/a</id>
    <title>Same Title</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="text/fb2+xml" href="https://example.com/books/a.fb2"/>
  </entry>
  <entry>
    <id>https://example.com/books/b</id>
    <title>Same Title</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="text/fb2+xml" href="https://example.com/books/b.fb2"/>
  </entry>
</feed>`;
}

// A streaming response whose body stays open until the test closes the
// controller — lets us observe the mid-download state.
function deferredStreamResponse(
  body: string,
  onStart: (controller: ReadableStreamDefaultController<Uint8Array>) => void,
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        onStart(controller);
      },
    }),
    { status: 200, headers: { 'content-type': 'text/fb2+xml' } },
  );
}

describe('OpdsView — remappable feed verbs', () => {
  // The feed verbs (d/x/n/p/c/u) used to be hardcoded. They now resolve
  // through the layered OPDS keymap, so a rebinding in config must work —
  // and the global meaning of a shared letter must NOT leak into this view.
  it('a rebound download verb queues via the new key', async () => {
    setup({
      downloads: () => mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } }),
    });
    const cfg = defaultConfig();
    // Rebind download to 'D'; 'd' stays delete_from_library globally.
    cfg.keybindings.D = 'opds_download';
    process.env.XDG_CACHE_HOME = dir;
    const { stdin } = render(<OpdsView {...makeProps({ config: cfg })} />);
    await settle();
    stdin.write('\r'); // open catalog
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j'); // Book Two (acquisition)
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('D'); // the rebound verb
    await new Promise((r) => setTimeout(r, 400));
    expect(db.listBooks()).toHaveLength(1);
  });

  it("'d' downloads in OPDS even though it deletes in the library", async () => {
    // The layered keymap must override the global binding in this view, not
    // the other way round.
    setup({
      downloads: () => mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } }),
    });
    process.env.XDG_CACHE_HOME = dir;
    const { stdin } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('d');
    await new Promise((r) => setTimeout(r, 400));
    expect(db.listBooks()).toHaveLength(1);
  });

  it('shows the download spinner only for the entry actually queued (id, not title)', async () => {
    // Two acquisition entries share a title. Queue entry A, then open B's
    // detail: the spinner must NOT appear there — a title match would
    // wrongly show it, since the running job has the same title.
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const streamState: { controller: ReadableStreamDefaultController<Uint8Array> | null } = {
      controller: null,
    };
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'https://example.com/opds') return feedResponse(sameTitleFeedXml());
      return deferredStreamResponse(FB2_SAMPLE, (c) => {
        streamState.controller = c;
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    process.env.XDG_CACHE_HOME = dir;
    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r'); // open catalog (entry A is on top)
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('d'); // queue A's download — stays in-flight (stream open)
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('\r'); // open A's detail
    await new Promise((r) => setTimeout(r, 100));
    expect(lastFrame() ?? '').toContain('Downloading');
    stdin.write('\u001b'); // back to browsing
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('j'); // entry B (same title, different id)
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('\r'); // open B's detail
    await new Promise((r) => setTimeout(r, 100));
    expect(lastFrame() ?? '').not.toContain('Downloading');
    streamState.controller?.close();
    await new Promise((r) => setTimeout(r, 300));
  });
});

// Shared fixture for download scenarios: a catalog whose feed lists books,
// with a pluggable handler for the acquisition URLs.
function setup(
  opts: {
    downloads?: (url: string) => Response;
  } = {},
) {
  db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
  const fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u === 'https://example.com/opds') return feedResponse(queueFeedXml());
    return opts.downloads?.(u) ?? mockResponse(FB2_SAMPLE);
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

describe('OpdsView — download queue', () => {
  it('d queues a download, shows progress, and input stays live', async () => {
    const streamState: { controller: ReadableStreamDefaultController<Uint8Array> | null } = {
      controller: null,
    };
    setup({
      downloads: (url) => {
        expect(url).toContain('books/2.fb2');
        return deferredStreamResponse(FB2_SAMPLE, (c) => {
          streamState.controller = c;
        });
      },
    });
    const notify = vi.fn();
    process.env.XDG_CACHE_HOME = dir;
    const { stdin, lastFrame } = render(<OpdsView {...makeProps({ notify })} />);
    await settle();
    stdin.write('\r'); // open catalog
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j'); // Book Two (acquisition)
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('d'); // queue the download
    await new Promise((r) => setTimeout(r, 100));

    let frame = lastFrame() ?? '';
    expect(frame).toContain('downloading…');
    expect(frame).toContain('↓');

    // Input is not blocked while downloading: u returns to the catalog list.
    stdin.write('u');
    await new Promise((r) => setTimeout(r, 100));
    frame = lastFrame() ?? '';
    expect(frame).toContain('OPDS Catalogs');

    // Release the stream; the background download finishes and lands in the lib.
    streamState.controller?.close();
    await new Promise((r) => setTimeout(r, 400));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Downloaded:'));
    expect(db.listBooks()).toHaveLength(1);
  });

  it('x opens the queue and enter opens a finished book', async () => {
    setup({
      downloads: () => mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } }),
    });
    const onOpenDownloaded = vi.fn();
    process.env.XDG_CACHE_HOME = dir;
    const { stdin, lastFrame } = render(<OpdsView {...makeProps({ onOpenDownloaded })} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('d');
    await new Promise((r) => setTimeout(r, 400)); // completes

    // No auto-open: the book lands in the library, the user opens it manually.
    expect(onOpenDownloaded).not.toHaveBeenCalled();
    expect(db.listBooks()).toHaveLength(1);

    stdin.write('x'); // open the downloads queue
    await new Promise((r) => setTimeout(r, 100));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓ done');
    expect(frame).toContain('Book Two');

    stdin.write('\r'); // enter opens the finished book
    await new Promise((r) => setTimeout(r, 100));
    expect(onOpenDownloaded).toHaveBeenCalledTimes(1);
    expect(onOpenDownloaded.mock.calls[0]![0]).toBeTypeOf('number');
  });

  it('offers "enter — read" on the entry and opens the book without leaving OPDS', async () => {
    setup({
      downloads: () => mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } }),
    });
    const onOpenDownloaded = vi.fn();
    process.env.XDG_CACHE_HOME = dir;
    const { stdin, lastFrame } = render(<OpdsView {...makeProps({ onOpenDownloaded })} />);
    await settle();
    stdin.write('\r'); // open catalog
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j'); // entry "Book Two" (acquisition)
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('\r'); // open its detail
    await new Promise((r) => setTimeout(r, 100));
    // Download from the detail view, then wait for completion.
    stdin.write('d');
    await new Promise((r) => setTimeout(r, 400));

    // The detail view now advertises reading instead of just downloading,
    // and the status-bar hint says "read".
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Downloaded');
    expect(frame.toLowerCase()).toContain('read');
    expect(frame).toContain('read ·');

    // Enter opens the finished book directly — no walk back to the library.
    expect(onOpenDownloaded).not.toHaveBeenCalled();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
    expect(onOpenDownloaded).toHaveBeenCalledTimes(1);
    expect(onOpenDownloaded.mock.calls[0]![0]).toBeTypeOf('number');
  });

  it('enter on an already-downloaded entry reads it instead of re-downloading', async () => {
    // Second download of the same entry must not enqueue a duplicate job: the
    // user already has the file, so enter opens it.
    setup({
      downloads: () => mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } }),
    });
    const onOpenDownloaded = vi.fn();
    process.env.XDG_CACHE_HOME = dir;
    const { stdin } = render(<OpdsView {...makeProps({ onOpenDownloaded })} />);
    await settle();
    stdin.write('\r'); // open catalog
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j'); // entry "Book Two"
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('d'); // first download
    await new Promise((r) => setTimeout(r, 400));
    expect(db.listBooks()).toHaveLength(1);

    // Open the entry detail for the same entry and press enter again.
    stdin.write('\r'); // detail
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('\r'); // would re-download if it ignored the finished job
    await new Promise((r) => setTimeout(r, 200));

    expect(onOpenDownloaded).toHaveBeenCalledTimes(1);
    // No duplicate book was added — the finished job was reused.
    expect(db.listBooks()).toHaveLength(1);
  });

  it('fires a desktop notification when a download lands in the library', async () => {
    const notifyMock = await mockDesktopNotify();
    process.env.DISPLAY = ':0';

    setup({
      downloads: () => mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } }),
    });
    process.env.XDG_CACHE_HOME = dir;
    const { stdin } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r'); // open catalog
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j'); // entry "Book Two"
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('d');
    await new Promise((r) => setTimeout(r, 400));

    expect(db.listBooks()).toHaveLength(1);
    // Body names the book and points at the library.
    expect(notifyMock).toHaveBeenCalledWith('tabook', expect.stringContaining('in your library'));
  });

  it('stays silent when notifications are disabled in config', async () => {
    const notifyMock = await mockDesktopNotify();
    process.env.DISPLAY = ':0';

    setup({
      downloads: () => mockResponse(FB2_SAMPLE, { headers: { 'content-type': 'text/fb2+xml' } }),
    });
    process.env.XDG_CACHE_HOME = dir;
    const config = { ...makeProps().config, notifications: false };
    const { stdin } = render(<OpdsView {...makeProps({ config })} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('d');
    await new Promise((r) => setTimeout(r, 400));

    // The book still lands; only the desktop ping is suppressed.
    expect(db.listBooks()).toHaveLength(1);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('OpdsView — search discovery from the root feed', () => {
  it('searches via the root feed OpenSearch when the current feed has none', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const rootXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Root Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="search" href="https://example.com/opensearch.xml" type="application/opensearchdescription+xml"/>
  <entry>
    <id>https://example.com/section</id>
    <title>Section</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="https://example.com/section.opds"/>
  </entry>
</feed>`;
    // Sub-feed without any search link (typical for acquisition pages).
    const subXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/section.opds</id>
  <title>Sub Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/section.opds" type="application/atom+xml;profile=opds-catalog"/>
  <entry>
    <id>https://example.com/books/1</id>
    <title>Book One</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="text/fb2+xml" href="https://example.com/books/1.fb2"/>
  </entry>
</feed>`;
    const osdXml = `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Test</ShortName>
  <Url type="application/atom+xml" template="https://example.com/search?q={searchTerms}"/>
</OpenSearchDescription>`;
    const resultsXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/search?q=test</id>
  <title>Search Results</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/search?q=test" type="application/atom+xml;profile=opds-catalog"/>
  <entry>
    <id>https://example.com/books/9</id>
    <title>Found Book</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/acquisition" type="text/fb2+xml" href="https://example.com/books/9.fb2"/>
  </entry>
</feed>`;
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u === 'https://example.com/opds') return feedResponse(rootXml);
      if (u === 'https://example.com/section.opds') return feedResponse(subXml);
      if (u === 'https://example.com/opensearch.xml') return feedResponse(osdXml);
      if (u === 'https://example.com/search?q=test') return feedResponse(resultsXml);
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r'); // open the catalog (root feed)
    await new Promise((r) => setTimeout(r, 200));
    stdin.write('\r'); // open the subsection
    await new Promise((r) => setTimeout(r, 200));
    expect(lastFrame() ?? '').toContain('Sub Feed');

    stdin.write('/'); // search prompt
    await new Promise((r) => setTimeout(r, 100));
    for (const ch of 'test') {
      stdin.write(ch);
      await new Promise((r) => setTimeout(r, 20));
    }
    stdin.write('\r'); // submit
    await new Promise((r) => setTimeout(r, 300));

    expect(calls).toContain('https://example.com/opensearch.xml');
    expect(calls).toContain('https://example.com/search?q=test');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Search Results');
    expect(frame).toContain('Found Book');
  });
});

describe('OpdsView — cover thumbnails', () => {
  it('fetches thumbnailHref covers and draws them for visible entries', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const feedXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://example.com/opds</id>
  <title>Cover Feed</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <entry>
    <id>https://example.com/books/1</id>
    <title>Covered Book</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/image/thumbnail" type="image/jpeg" href="https://example.com/covers/1.jpg"/>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://example.com/books/1.epub"/>
  </entry>
</feed>`;
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'https://example.com/opds') return feedResponse(feedXml);
      if (u === 'https://example.com/covers/1.jpg') {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-length', '4']]),
          text: async () => '',
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchMock;
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');

    const { stdin } = render(<OpdsView {...makeProps()} />);
    await settle();
    stdin.write('\r'); // open catalog
    await new Promise((r) => setTimeout(r, 250));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('covers/1.jpg'),
      expect.anything(),
    );
    expect(updateSpy).toHaveBeenCalled();
    const [placements] = updateSpy.mock.calls.at(-1)! as [
      Array<{ identifier: string; width: number; height: number }>,
      Map<string, Uint8Array>,
    ];
    expect(placements.length).toBe(1);
    expect(placements[0]!.identifier).toMatch(/^opds-cover-/);
    expect(placements[0]!.height).toBe(3);
  });

  it('does not fetch or draw covers when inputDisabled', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const feedXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>x</id><title>F</title><updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="https://x" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <entry>
    <id>e1</id><title>B</title><updated>2026-01-01T00:00:00Z</updated>
    <link rel="http://opds-spec.org/image/thumbnail" type="image/jpeg" href="https://example.com/c.jpg"/>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://example.com/b.epub"/>
  </entry>
</feed>`;
    globalThis.fetch = vi.fn(async () =>
      feedResponse(feedXml),
    ) as unknown as typeof globalThis.fetch;
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    const clearSpy = vi.spyOn(imageLayer, 'clear');

    const { stdin } = render(<OpdsView {...makeProps({ inputDisabled: true })} />);
    await settle();
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('OpdsView — mouse clicks', () => {
  it('single click moves the cursor; double-click opens the catalog', async () => {
    db.addCatalog({ name: 'Alpha', url: 'https://a/' });
    db.addCatalog({ name: 'Beta', url: 'https://b/' });
    const feedXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://b/</id><title>Feed B</title><updated>2026-01-01T00:00:00Z</updated><link rel="self" href="https://b/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/></feed>`;
    globalThis.fetch = vi.fn(async () =>
      feedResponse(feedXml),
    ) as unknown as typeof globalThis.fetch;

    const { lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    // Click row 1 (y=3) → cursor moves to Beta.
    emitMouseClick({ x: 5, y: 3, button: 'left', press: true, motion: false });
    await settle();
    expect(lastFrame() ?? '').toContain('▸ Beta');
    // Double-click the same row → opens the catalog (fetches its feed).
    emitMouseClick({ x: 5, y: 3, button: 'left', press: true, motion: false });
    await new Promise((r) => setTimeout(r, 250));
    expect(lastFrame() ?? '').toContain('Feed B');
  });
});

describe('OpdsView — catalog refresh', () => {
  it('refreshes catalog list when returning from browsing via c', async () => {
    db.addCatalog({ name: 'Alpha', url: 'https://a/' });
    const feedXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>Feed</title><updated>2026-01-01T00:00:00Z</updated><link rel="self" href="https://x" type="application/atom+xml;profile=opds-catalog;kind=navigation"/></feed>`;
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => feedXml,
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    ) as unknown as typeof globalThis.fetch;

    const { stdin, lastFrame } = render(<OpdsView {...makeProps()} />);
    await settle();
    // Open the catalog
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 200));
    // Add a new catalog to the DB while browsing
    db.addCatalog({ name: 'Beta', url: 'https://b/' });
    // Press c to go back to catalog list
    stdin.write('c');
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    // Both catalogs should be visible after refresh
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Beta');
  });
});
