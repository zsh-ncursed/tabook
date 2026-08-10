import { parseOpdsAtom } from './parser.js';
import { appVersion } from '../utils/version.js';
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
const UA = `tabook/${appVersion()} (+https://github.com/zsh-ncursed/tabook)`;

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

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

interface FetchOptions {
  auth?: OpdsAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
  base?: string;
  accept?: string;
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
  const merged = opts.signal ? mergeSignals(opts.signal, controller.signal) : null;
  const signal = merged ? merged.signal : controller.signal;

  try {
    const res = await fetch(url, {
      headers: {
        ...authHeaders(opts.auth),
        'User-Agent': UA,
        Accept: opts.accept ?? 'application/atom+xml,*/*',
      },
      signal,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new OpdsError(`Redirect ${res.status} without Location header from ${url}`);
      const next = resolveUrl(location, url);
      // Never forward credentials to a different origin — a malicious or
      // compromised catalog could otherwise steal Basic auth via redirect.
      const nextOpts =
        sameOrigin(url, next) ? opts : { ...opts, auth: undefined };
      return fetchWithTimeout(next, nextOpts, redirectCount + 1);
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
    // Release the listeners on both source signals once the request has
    // finished (success, error, or abort) — otherwise a long-lived external
    // signal keeps this closure (and the controller) alive indefinitely.
    merged?.cleanup();
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  if (a.aborted) return { signal: a, cleanup: () => {} };
  if (b.aborted) return { signal: b, cleanup: () => {} };
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  const cleanup = (): void => {
    a.removeEventListener('abort', onAbort);
    b.removeEventListener('abort', onAbort);
  };
  return { signal: controller.signal, cleanup };
}

export async function fetchFeed(
  href: string,
  opts?: { auth?: OpdsAuth; signal?: AbortSignal; base?: string },
): Promise<OpdsFeed> {
  const url = resolveUrl(href, opts?.base);
  const { response, finalUrl } = await fetchWithTimeout(url, opts ?? {});
  if (!response.ok) {
    throw new OpdsError(`HTTP ${response.status} fetching feed ${url}`, { statusCode: response.status });
  }
  const text = await response.text();
  const feed = parseOpdsAtom(text);
  // Remember the URL the feed was served from (post-redirect) so relative
  // links inside it can be resolved correctly on later navigation.
  feed.url = finalUrl;
  return feed;
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
  const { response, finalUrl } = await fetchWithTimeout(url, {
    ...opts,
    accept: 'application/epub+zip,text/fb2+xml,application/fb2+zip,*/*',
  });
  if (!response.ok) {
    throw new OpdsError(`HTTP ${response.status} downloading ${url}`, { statusCode: response.status });
  }
  const buf = await response.arrayBuffer();
  return { data: new Uint8Array(buf), finalUrl };
}

export function catalogAuth(catalog: { username?: string | null; password?: string | null }): OpdsAuth {
  return { username: catalog.username ?? undefined, password: catalog.password ?? undefined };
}