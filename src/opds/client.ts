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

const DEFAULT_TIMEOUT_MS = 60_000;
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

/** Bytes received so far (and total when the server sends Content-Length). */
export interface DownloadProgress {
  received: number;
  total?: number;
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
      if (!location)
        throw new OpdsError(`Redirect ${res.status} without Location header from ${url}`);
      const next = resolveUrl(location, url);
      // Never forward credentials to a different origin — a malicious or
      // compromised catalog could otherwise steal Basic auth via redirect.
      const nextOpts = sameOrigin(url, next) ? opts : { ...opts, auth: undefined };
      return fetchWithTimeout(next, nextOpts, redirectCount + 1);
    }

    return { response: res, finalUrl: url };
  } catch (err) {
    if (err instanceof OpdsError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new OpdsError(`Request timed out fetching ${url}`, { cause: err });
    }
    throw new OpdsError(
      `Network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timeout);
    // Release the listeners on both source signals once the request has
    // finished (success, error, or abort) — otherwise a long-lived external
    // signal keeps this closure (and the controller) alive indefinitely.
    merged?.cleanup();
  }
}

function mergeSignals(
  a: AbortSignal,
  b: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
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
    throw new OpdsError(`HTTP ${response.status} fetching feed ${url}`, {
      statusCode: response.status,
    });
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
    throw new OpdsError(`HTTP ${response.status} fetching OpenSearch ${url}`, {
      statusCode: response.status,
    });
  }
  return response.text();
}

function contentLength(headers: Headers | Map<string, string>): number | undefined {
  const raw = headers.get('content-length');
  if (raw === null || raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Reads the response body while reporting byte progress. Uses the streaming
// body when available (progress is live); falls back to arrayBuffer() for
// mocked/legacy responses without a body (single progress report at the end).
async function readBodyWithProgress(
  response: Response,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Uint8Array> {
  const total = contentLength(response.headers);
  if (!response.body) {
    const buf = await response.arrayBuffer();
    onProgress?.({ received: buf.byteLength, total: total ?? buf.byteLength });
    return new Uint8Array(buf);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.({ received, total });
    }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function downloadBook(
  href: string,
  opts?: {
    auth?: OpdsAuth;
    signal?: AbortSignal;
    base?: string;
    onProgress?: (p: DownloadProgress) => void;
  },
): Promise<{ data: Uint8Array; finalUrl: string }> {
  const url = resolveUrl(href, opts?.base);
  const { response, finalUrl } = await fetchWithTimeout(url, {
    ...opts,
    accept: 'application/epub+zip,text/fb2+xml,application/fb2+zip,*/*',
  });
  if (!response.ok) {
    throw new OpdsError(`HTTP ${response.status} downloading ${url}`, {
      statusCode: response.status,
    });
  }
  const data = await readBodyWithProgress(response, opts?.onProgress);
  return { data, finalUrl };
}

export function catalogAuth(catalog: {
  username?: string | null;
  password?: string | null;
}): OpdsAuth {
  return { username: catalog.username ?? undefined, password: catalog.password ?? undefined };
}
