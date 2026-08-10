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

const theme: Theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;
const config = defaultConfig();

let dir: string;
let db: LibraryDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-opds-test-'));
  db = new LibraryDb(path.join(dir, 'lib.sqlite'));
});

afterEach(() => {
  db.close();
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
    expect(frame).toContain('🔒');
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => feedXml,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response));
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
      text: async () => '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>x</title><updated>2026-01-01T00:00:00Z</updated></feed>',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    await settle();
  });

  it('shows error on fetch failure', async () => {
    db.addCatalog({ name: 'Test', url: 'https://example.com/opds' });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: new Map(),
      text: async () => 'Not Found',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response));
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
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => feedXml,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response)) as unknown as typeof globalThis.fetch;

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
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Map(),
      text: async () => 'Unauthorized',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response)) as unknown as typeof globalThis.fetch;

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
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Map(),
      text: async () => 'Unauthorized',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response)) as unknown as typeof globalThis.fetch;

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

describe('OpdsView — catalog refresh', () => {
  it('refreshes catalog list when returning from browsing via c', async () => {
    db.addCatalog({ name: 'Alpha', url: 'https://a/' });
    const feedXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>Feed</title><updated>2026-01-01T00:00:00Z</updated><link rel="self" href="https://x" type="application/atom+xml;profile=opds-catalog;kind=navigation"/></feed>`;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => feedXml,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response)) as unknown as typeof globalThis.fetch;

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