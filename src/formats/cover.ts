import fs from 'node:fs';
import { openZip } from '../utils/zip.js';
import { decodeXmlBuffer, isZipBuffer } from './encoding.js';
import type { BookRecord } from '../db/db.js';

// Cover-bytes extraction for list thumbnails. A full parseBookFile per row
// would re-decode every book on every scroll; these two paths read only what
// the cover needs:
//   - EPUB: the cover is a single file inside the archive (coverKey is its
//     path), so we open the zip and read just that entry.
//   - FB2: the cover is a <binary id="coverKey">base64</binary> block, which
//     we locate with a targeted regex instead of building the whole document.
//
// All failures return undefined (missing cover, unreadable file, bad zip) —
// a missing thumbnail must never break the list, only skip the image.

/** Decode a base64 data: URI (data:image/png;base64,....) to bytes. */
export function decodeDataUri(href: string): Uint8Array | undefined {
  const comma = href.indexOf(',');
  if (comma < 0) return undefined;
  const meta = href.slice(0, comma);
  if (!/^data:[^;]+;base64$/i.test(meta)) return undefined;
  try {
    return Buffer.from(href.slice(comma + 1), 'base64');
  } catch {
    return undefined;
  }
}

// The cover id is a plain resource key (e.g. "cover.jpg"); escape it so a
// regex metacharacter in a book's cover key can't break the match.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Locate <binary id="coverKey">…base64…</binary> in an FB2 document. */
export function extractFb2CoverBytes(xmlText: string, coverKey: string): Uint8Array | undefined {
  if (!coverKey) return undefined;
  const idRe = new RegExp(`\\bid\\s*=\\s*["']${escapeRe(coverKey)}["']`, 'i');
  const binaryRe = /<binary\b([^>]*)>([^<]*)<\/binary>/gi;
  for (const m of xmlText.matchAll(binaryRe)) {
    const attrs = m[1] ?? '';
    if (!idRe.test(attrs)) continue;
    const b64 = (m[2] ?? '').replace(/\s+/g, '');
    try {
      const bytes = Buffer.from(b64, 'base64');
      return bytes.length > 0 ? bytes : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Read the fb2 document text from a plain .fb2 or a .fb2.zip file buffer. */
function fb2XmlText(data: Uint8Array): string | undefined {
  if (isZipBuffer(data)) {
    let zip;
    try {
      zip = openZip(data);
    } catch {
      return undefined;
    }
    const entries = zip.entries
      .filter((e) => e.name.endsWith('.fb2') && !e.name.startsWith('__MACOSX'))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length === 0) return undefined;
    try {
      return decodeXmlBuffer(zip.read(entries[0]!.name));
    } catch {
      return undefined;
    }
  }
  try {
    return decodeXmlBuffer(data);
  } catch {
    return undefined;
  }
}

/**
 * Extract the cover image bytes from a book file on disk. Returns undefined
 * when the file is unreadable, has no cover, or the cover can't be decoded.
 */
export function extractCoverBytes(
  filePath: string,
  format: BookRecord['format'],
  coverKey: string | undefined,
): Uint8Array | undefined {
  if (!coverKey) return undefined;
  let data: Buffer;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    return undefined;
  }
  if (format === 'epub') {
    if (!isZipBuffer(data)) return undefined;
    let zip;
    try {
      zip = openZip(data);
    } catch {
      return undefined;
    }
    // coverKey is the entry path inside the archive; some feeds/EPUBs add a
    // leading ./ or use a different casing — try exact, then suffix match.
    const exact = zip.entries.find((e) => e.name === coverKey);
    const bySuffix = exact
      ? undefined
      : zip.entries.find(
          (e) => e.name.endsWith(coverKey) || coverKey.endsWith('/' + e.name.split('/').pop()!),
        );
    const entry = exact ?? bySuffix;
    if (!entry) return undefined;
    try {
      const bytes = zip.read(entry.name);
      return bytes.length > 0 ? bytes : undefined;
    } catch {
      return undefined;
    }
  }
  const xmlText = fb2XmlText(data);
  if (xmlText === undefined) return undefined;
  return extractFb2CoverBytes(xmlText, coverKey);
}
