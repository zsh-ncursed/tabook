import { parseOpdsAtom } from './parser.js';
import type { OpdsFeed } from './model.js';

export interface OpdsAuth {
  username?: string;
  password?: string;
}

export class OpdsError extends Error {
  readonly statusCode?: number;
  constructor(message: string, opts?: { statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = 'OpdsError';
    this.statusCode = opts?.statusCode;
    if (opts?.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const UA = `tabook/0.1.2 (+https://github.com/zsh-ncursed/tabook)`;

function authHeaders(auth?: OpdsAuth): Record<string, string> {
  if (!auth?.username) return {};
  const creds = `${auth.username}:${auth.password ?? ''}`;
  return { Authorization: `Basic ${Buffer.from(creds, 'utf8').toString('base64')}` };
}

function resolveUrl(href: string, base?: string): string {
  if (base) {
    try {
      return new URL(href, base).href;
    } catch {
      return href;
    }
  }
  return href;
}

interface FetchOptions {
  auth?: OpdsAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
  base?: string;
}

interface FetchedResult {
  response: Response;
  finalUrl: string;
}

async function fetchWithTimeout(
  url: string,
  opts: FetchOptions,
  redirectCount = 0,
): Promise<FetchedResult> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new OpdsError(`Too many redirects fetching ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal
    ? mergeSignals(opts.signal, controller.signal)
    : controller.signal;

  try {
    const res = await fetch(url, {
      headers: { ...authHeaders(opts.auth), 'User-Agent': UA, Accept: 'application/atom+xml,*/*' },
      signal,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new OpdsError(`Redirect ${res.status} without Location header from ${url}`);
      const next = resolveUrl(location, url);
      return fetchWithTimeout(next, opts, redirectCount + 1);
    }

    return { response: res, finalUrl: url };
  } catch (err) {
    if (err instanceof OpdsError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new OpdsError(`Request timed out fetching ${url}`, { cause: err });
    }
    throw new OpdsError(`Network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  } finally {
    clearTimeout(timeout);
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

export async function fetchFeed(
  href: string,
  opts?: { auth?: OpdsAuth; signal?: AbortSignal; base?: string },
): Promise<OpdsFeed> {
  const url = resolveUrl(href, opts?.base);
  const { response } = await fetchWithTimeout(url, opts ?? {});
  if (!response.ok) {
    throw new OpdsError(`HTTP ${response.status} fetching feed ${url}`, { statusCode: response.status });
  }
  const text = await response.text();
  return parseOpdsAtom(text);
}

export async function fetchOpenSearch(
  href: string,
  opts?: { auth?: OpdsAuth; signal?: AbortSignal; base?: string },
): Promise<string> {
  const url = resolveUrl(href, opts?.base);
  const { response } = await fetchWithTimeout(url, opts ?? {});
  if (!response.ok) {
    throw new OpdsError(`HTTP ${response.status} fetching OpenSearch ${url}`, { statusCode: response.status });
  }
  return response.text();
}

export async function downloadBook(
  href: string,
  opts?: { auth?: OpdsAuth; signal?: AbortSignal; base?: string },
): Promise<{ data: Uint8Array; finalUrl: string }> {
  const url = resolveUrl(href, opts?.base);
  const { response, finalUrl } = await fetchWithTimeout(url, opts ?? {});
  if (!response.ok) {
    throw new OpdsError(`HTTP ${response.status} downloading ${url}`, { statusCode: response.status });
  }
  const buf = await response.arrayBuffer();
  return { data: new Uint8Array(buf), finalUrl };
}

export function catalogAuth(catalog: { username?: string | null; password?: string | null }): OpdsAuth {
  return { username: catalog.username ?? undefined, password: catalog.password ?? undefined };
}