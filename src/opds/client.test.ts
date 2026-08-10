import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchFeed, fetchOpenSearch, OpdsError } from './client.js';
import { parseOpenSearch, buildSearchUrl } from './opensearch.js';
import { setFetchMock, mockResponse } from './client.test-utils.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchFeed', () => {
  it('parses a valid OPDS feed', async () => {
    const xml = fixture('gutenberg_root.xml');
    setFetchMock(vi.fn(async () => mockResponse(xml)));

    const feed = await fetchFeed('https://m.gutenberg.org/ebooks.opds/');
    expect(feed.title).toBe('Project Gutenberg');
    expect(feed.entries).toHaveLength(3);
  });

  it('sends Authorization header with Basic auth', async () => {
    const xml = fixture('anarchist_root.xml');
    let capturedHeaders: Headers | undefined;
    setFetchMock(vi.fn(async (_url, init?) => {
      capturedHeaders = new Headers(init?.headers);
      return mockResponse(xml);
    }));

    await fetchFeed('https://theanarchistlibrary.org/opds', {
      auth: { username: 'user', password: 'pass' },
    });
    expect(capturedHeaders?.get('Authorization')).toMatch(/^Basic /);
  });

  it('sends User-Agent header', async () => {
    let capturedHeaders: Headers | undefined;
    setFetchMock(vi.fn(async (_url, init?) => {
      capturedHeaders = new Headers(init?.headers);
      return mockResponse(fixture('gutenberg_root.xml'));
    }));

    await fetchFeed('https://x/');
    expect(capturedHeaders?.get('User-Agent')).toContain('tabook');
  });

  it('follows redirects manually', async () => {
    const xml = fixture('gutenberg_root.xml');
    const calls: string[] = [];
    setFetchMock(vi.fn(async (url, _init?) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return mockResponse('', { status: 301, headers: { location: 'https://m.gutenberg.org/ebooks.opds/' } });
      }
      return mockResponse(xml);
    }));

    const feed = await fetchFeed('https://gutenberg.org/redirect');
    expect(calls).toHaveLength(2);
    expect(feed.title).toBe('Project Gutenberg');
  });

  it('resolves relative redirect Location against base URL', async () => {
    const xml = fixture('gutenberg_root.xml');
    const calls: string[] = [];
    setFetchMock(vi.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return mockResponse('', { status: 302, headers: { location: '/ebooks.opds/' } });
      }
      return mockResponse(xml);
    }));

    const feed = await fetchFeed('https://m.gutenberg.org/old');
    expect(calls[1]).toBe('https://m.gutenberg.org/ebooks.opds/');
    expect(feed.title).toBe('Project Gutenberg');
  });

  it('throws OpdsError on HTTP 404', async () => {
    setFetchMock(vi.fn(async () => mockResponse('Not Found', { status: 404 })));
    await expect(fetchFeed('https://x/')).rejects.toThrow(OpdsError);
    await expect(fetchFeed('https://x/')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws OpdsError on HTTP 401', async () => {
    setFetchMock(vi.fn(async () => mockResponse('Unauthorized', { status: 401 })));
    await expect(fetchFeed('https://x/')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws OpdsError on network failure', async () => {
    setFetchMock(vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(fetchFeed('https://x/')).rejects.toThrow(OpdsError);
  });

  it('throws on too many redirects', async () => {
    setFetchMock(vi.fn(async () =>
      mockResponse('', { status: 301, headers: { location: 'https://x/loop' } }),
    ));
    await expect(fetchFeed('https://x/')).rejects.toThrow('redirect');
  });

  it('resolves relative href against base URL', async () => {
    const xml = fixture('gutenberg_root.xml');
    let capturedUrl: string | undefined;
    setFetchMock(vi.fn(async (url) => {
      capturedUrl = String(url);
      return mockResponse(xml);
    }));

    await fetchFeed('/ebooks.opds/', { base: 'https://m.gutenberg.org/' });
    expect(capturedUrl).toBe('https://m.gutenberg.org/ebooks.opds/');
  });

  it('keeps auth on same-origin redirect', async () => {
    const xml = fixture('gutenberg_root.xml');
    const calls: Array<{ url: string; auth: string | null }> = [];
    setFetchMock(vi.fn(async (url, init?) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get('Authorization') });
      if (calls.length === 1) {
        return mockResponse('', { status: 302, headers: { location: '/ebooks.opds/' } });
      }
      return mockResponse(xml);
    }));

    await fetchFeed('https://m.gutenberg.org/old', { auth: { username: 'u', password: 'p' } });
    expect(calls[1]!.auth).toMatch(/^Basic /);
  });

  it('drops auth on cross-origin redirect', async () => {
    const xml = fixture('gutenberg_root.xml');
    const calls: Array<{ url: string; auth: string | null }> = [];
    setFetchMock(vi.fn(async (url, init?) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get('Authorization') });
      if (calls.length === 1) {
        return mockResponse('', { status: 302, headers: { location: 'https://cdn.example.org/feed.xml' } });
      }
      return mockResponse(xml);
    }));

    await fetchFeed('https://m.gutenberg.org/old', { auth: { username: 'u', password: 'p' } });
    expect(calls[0]!.auth).toMatch(/^Basic /);
    expect(calls[1]!.auth).toBeNull();
  });

  it('records the final post-redirect URL on the feed', async () => {
    const xml = fixture('gutenberg_root.xml');
    const calls: string[] = [];
    setFetchMock(vi.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return mockResponse('', { status: 301, headers: { location: 'https://m.gutenberg.org/ebooks.opds/' } });
      }
      return mockResponse(xml);
    }));

    const feed = await fetchFeed('https://m.gutenberg.org/redirect');
    expect(calls).toHaveLength(2);
    expect(feed.url).toBe('https://m.gutenberg.org/ebooks.opds/');
  });
});

describe('fetchOpenSearch', () => {
  it('returns raw XML text', async () => {
    const xml = fixture('opensearch.xml');
    setFetchMock(vi.fn(async () => mockResponse(xml)));
    const text = await fetchOpenSearch('https://x/opensearch.xml');
    expect(text).toContain('OpenSearchDescription');
  });

  it('throws on HTTP error', async () => {
    setFetchMock(vi.fn(async () => mockResponse('', { status: 500 })));
    await expect(fetchOpenSearch('https://x/')).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('OpenSearch integration', () => {
  it('fetches and builds search URL from OpenSearch description', async () => {
    const xml = fixture('opensearch.xml');
    setFetchMock(vi.fn(async () => mockResponse(xml)));
    const text = await fetchOpenSearch('https://x/opensearch.xml');
    const desc = parseOpenSearch(text);
    const url = buildSearchUrl(desc, 'bakunin');
    expect(url).toBe('https://theanarchistlibrary.org/opds/search?query=bakunin');
  });
});