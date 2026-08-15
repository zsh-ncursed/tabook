// Golden parity: format detection — native.detectFormat (Rust) vs the
// pure-TS fallback (detectFormatTs).
import { describe, it, expect } from 'vitest';
import { FB2_SAMPLE, makeFb2Zip, buildEpub } from '../formats/test-utils.js';
import { detectFormatTs } from '../formats/index.js';
import { isNativeErrorResult } from '../native.js';
import { requireNative } from './helpers.js';

const n = requireNative();

function tsResult(data: Uint8Array, name: string): { ok: boolean; value?: string; error?: string } {
  try {
    return { ok: true, value: detectFormatTs(data, name) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function nativeResult(
  data: Uint8Array,
  name: string,
): { ok: boolean; value?: string; error?: string } {
  try {
    const r = n.detectFormat(data, name);
    // napi-rs Result fns surface errors as a value; the app's detectFormat
    // re-throws them. Treat an error-value as rejection, like the app does.
    if (typeof r !== 'string' || isNativeErrorResult(r)) {
      return { ok: false, error: String(r) };
    }
    return { ok: true, value: r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const fb2Buf = Buffer.from(FB2_SAMPLE, 'utf8');
const epubBuf = buildEpub();
const fb2Zip = makeFb2Zip(FB2_SAMPLE);
const xmlHead = Buffer.from('<?xml version="1.0"?><FictionBook xmlns="http://x"/>', 'utf8');
const garbage = Buffer.from('this is not a book file at all', 'utf8');

const CASES: Array<{ data: Uint8Array; name: string }> = [
  { data: fb2Buf, name: 'book.fb2' },
  { data: fb2Buf, name: 'book.FB2' },
  { data: fb2Buf, name: 'no-extension' },
  { data: fb2Buf, name: 'book.txt' },
  { data: fb2Zip, name: 'book.fb2.zip' },
  { data: epubBuf, name: 'book.epub' },
  { data: epubBuf, name: 'no-extension' },
  { data: epubBuf, name: 'book.txt' },
  { data: xmlHead, name: 'unknown' },
  { data: garbage, name: 'book.fb2' },
  { data: garbage, name: 'book.epub' },
  { data: garbage, name: 'no-extension' },
];

describe('parity: format detection', () => {
  for (const { data, name } of CASES) {
    it(`detects ${JSON.stringify(name)} consistently`, () => {
      const ts = tsResult(data, name);
      const nat = nativeResult(data, name);
      // Both must agree on success/failure; error message text may differ.
      expect(nat.ok, `native(${JSON.stringify(name)}): ${nat.error ?? nat.value}`).toBe(ts.ok);
      if (ts.ok) expect(ts.value).toBe(nat.value);
    });
  }
});
