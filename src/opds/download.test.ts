import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { downloadBook, catalogAuth } from './client.js';
import { downloadAndSave } from './download.js';
import { setFetchMock, mockResponse } from './client.test-utils.js';
import { FB2_SAMPLE } from '../formats/test-utils.js';
import type { OpdsEntry } from './model.js';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makeDbStub() {
  let nextId = 1;
  const books: { path: string; filename: string; format: string; size: number }[] = [];
  return {
    addBook(rec: { path: string; filename: string; format: string; size: number; metadata: unknown }): number {
      const id = nextId++;
      books.push({ path: rec.path, filename: rec.filename, format: rec.format, size: rec.size });
      return id;
    },
    getBooks() {
      return books;
    },
  };
}

describe('downloadBook', () => {
  it('returns binary data and finalUrl', async () => {
    const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]);
    setFetchMock(vi.fn(async () => mockResponse(data)));
    const result = await downloadBook('https://x/book.epub');
    expect(result.data.length).toBe(5);
    expect(result.data[0]).toBe(0x50);
    expect(result.finalUrl).toBe('https://x/book.epub');
  });

  it('throws on HTTP 403', async () => {
    setFetchMock(vi.fn(async () => mockResponse('', { status: 403 })));
    await expect(downloadBook('https://x/')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns final URL after redirect', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const calls: string[] = [];
    setFetchMock(vi.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return mockResponse('', { status: 302, headers: { location: 'https://cdn.x/book.epub' } });
      }
      return mockResponse(data);
    }));
    const result = await downloadBook('https://x/book.epub');
    expect(result.finalUrl).toBe('https://cdn.x/book.epub');
  });
});

describe('downloadAndSave', () => {
  const testDownloadDir = join(process.env.TMPDIR ?? '/tmp', 'tabook-download-test');
  let origXdgCache: string | undefined;

  beforeEach(() => {
    mkdirSync(testDownloadDir, { recursive: true });
    origXdgCache = process.env.XDG_CACHE_HOME;
  });

  afterEach(() => {
    rmSync(testDownloadDir, { recursive: true, force: true });
    if (origXdgCache !== undefined) process.env.XDG_CACHE_HOME = origXdgCache;
    else delete process.env.XDG_CACHE_HOME;
  });

  it('downloads an FB2 book, saves to disk, and adds to library', async () => {
    const fb2Xml = FB2_SAMPLE;
    setFetchMock(vi.fn(async () => mockResponse(fb2Xml, { headers: { 'content-type': 'text/fb2+xml' } })));

    const entry: OpdsEntry = {
      id: 'urn:test:fb2',
      title: 'Test FB2 Book',
      updated: '',
      authors: [],
      categories: [],
      links: [{ rel: 'http://opds-spec.org/acquisition', href: 'https://x/book.fb2', type: 'text/fb2+xml' }],
      acquisitionLinks: [{ rel: 'http://opds-spec.org/acquisition', href: 'https://x/book.fb2', type: 'text/fb2+xml' }],
      isAcquisition: true,
      isNavigation: false,
    };

    const db = makeDbStub();
    process.env.XDG_CACHE_HOME = testDownloadDir;

    const result = await downloadAndSave(entry, { db: db as never });
    expect(result.bookId).toBe(1);
    expect(result.title).toBeTruthy();
    expect(db.getBooks()).toHaveLength(1);
    expect(db.getBooks()[0]!.format).toBe('fb2');
  });

  it('throws when entry has no acquisition links', async () => {
    const entry: OpdsEntry = {
      id: 'x',
      title: 'No links',
      updated: '',
      authors: [],
      categories: [],
      links: [],
      acquisitionLinks: [],
      isAcquisition: false,
      isNavigation: false,
    };
    const db = makeDbStub();
    await expect(downloadAndSave(entry, { db: db as never })).rejects.toThrow('No supported');
  });

  it('throws when acquisition link has no MIME type', async () => {
    const entry: OpdsEntry = {
      id: 'x',
      title: 'No mime',
      updated: '',
      authors: [],
      categories: [],
      links: [{ rel: 'http://opds-spec.org/acquisition', href: 'http://x/b.epub' }],
      acquisitionLinks: [{ rel: 'http://opds-spec.org/acquisition', href: 'http://x/b.epub' }],
      isAcquisition: true,
      isNavigation: false,
    };
    const db = makeDbStub();
    await expect(downloadAndSave(entry, { db: db as never })).rejects.toThrow('No supported');
  });
});

describe('catalogAuth', () => {
  it('returns auth object from catalog with credentials', () => {
    const auth = catalogAuth({ username: 'user', password: 'pass' });
    expect(auth.username).toBe('user');
    expect(auth.password).toBe('pass');
  });

  it('returns empty auth when no credentials', () => {
    const auth = catalogAuth({ username: undefined, password: undefined });
    expect(auth.username).toBeUndefined();
    expect(auth.password).toBeUndefined();
  });
});