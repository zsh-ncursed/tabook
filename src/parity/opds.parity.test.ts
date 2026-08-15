// Golden parity: OPDS parsing — native.parseOpdsAtom (Rust) vs the pure-TS
// fallback (parseOpdsAtomTs). Feeds come from the real-world fixtures in
// src/opds/fixtures (Gutenberg, Flibusta, anarchist, synthetic facets).
import { describe, it, expect } from 'vitest';
import { parseOpdsAtomTs } from '../opds/parser.js';
import { isNativeErrorResult } from '../native.js';
import { opdsFixture, requireNative } from './helpers.js';

const n = requireNative();

// Atom feed fixtures only — opensearch.xml / gutenberg_opensearch.xml are
// OpenSearch description documents (parsed by opensearch.ts), not feeds.
const FIXTURES = [
  'gutenberg_root.xml',
  'gutenberg_acq.xml',
  'gutenberg_book.xml',
  'anarchist_root.xml',
  'anarchist_acq.xml',
  'textos_root.xml',
  'flibusta_root.xml',
  'flibusta_search_books.xml',
  'synthetic_facets.xml',
];

// Native OpdsLink always carries activeFacet (false when unset); the TS
// parser only emits it for true. Normalize both sides to a shared shape.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v === null || v === undefined) continue;
      if (k === 'activeFacet' && v === false) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

describe('parity: OPDS parser', () => {
  for (const name of FIXTURES) {
    it(`parses ${name} identically`, () => {
      const xml = opdsFixture(name);
      const ts = parseOpdsAtomTs(xml);
      const nat = n.parseOpdsAtom(xml);
      expect(canonical(ts)).toEqual(canonical(nat));
    });
  }

  it('rejects malformed documents the same way', () => {
    // napi-rs Result fns surface errors as a value ({ code, message }) rather
    // than throwing; the app's parseOpdsAtom normalizes both to ParseError.
    // Treat an error-value as rejection, mirroring that contract.
    // NB: a truncated feed like '<feed><entry></feed>' is an accepted
    // divergence — the fast-xml-parser fallback auto-closes the entry while
    // quick-xml rejects the mismatched tag, so it is not asserted here.
    for (const xml of ['not xml at all', '<html><body></body></html>']) {
      const tsRejected = (() => {
        try {
          parseOpdsAtomTs(xml);
          return false;
        } catch (err) {
          return err instanceof Error ? true : String(err);
        }
      })();
      const natResult = n.parseOpdsAtom(xml);
      const natRejected = isNativeErrorResult(natResult);
      expect(natRejected, `native should reject ${JSON.stringify(xml)}`).toBe(true);
      expect(tsRejected, `TS should reject ${JSON.stringify(xml)}`).toBe(true);
    }
  });
});
