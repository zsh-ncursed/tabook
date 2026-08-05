import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { parseEpubBuffer } from './parser.js';
import { buildEpub, buildNcxEpub, makeBrokenZip } from '../test-utils.js';
import { ParseError } from '../../utils/errors.js';
import { joinAuthors } from '../model.js';

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function buildRawEpub(
  opfContent: string,
  files: Record<string, string> = {},
  container = CONTAINER_XML,
): Buffer {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(container, 'utf8'));
  zip.addFile('content.opf', Buffer.from(opfContent, 'utf8'));
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

function simpleOpf(opts: {
  metadata?: string;
  manifest?: string;
  spine?: string;
  spineAttr?: string;
}): string {
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${opts.metadata ?? ''}</metadata>
  <manifest>${opts.manifest ?? ''}</manifest>
  <spine${opts.spineAttr ? ` ${opts.spineAttr}` : ''}>${opts.spine ?? ''}</spine>
</package>`;
}

const XHTML = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`;

describe('EPUB parser', () => {
  it('parses metadata from the OPF', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    expect(book.format).toBe('epub');
    expect(book.metadata.title).toBe('Epub Book');
    expect(book.metadata.authors).toHaveLength(1);
    expect(joinAuthors(book.metadata.authors)).toContain('Jane Roe');
    expect(book.metadata.lang).toBe('en');
    expect(book.metadata.genres).toContain('Fiction');
    expect(book.metadata.annotation).toContain('compelling');
    expect(book.metadata.isbn).toBe('urn:isbn:9781234567890');
    expect(book.metadata.coverKey).toBe('OEBPS/images/cover.jpg');
  });

  it('parses spine content into blocks in order', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    const types = book.content.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
    expect(types).toContain('quote');
    expect(types).toContain('table');
    expect(types).toContain('image');
    const firstHeading = book.content.findIndex((b) => b.type === 'heading');
    expect(firstHeading).toBe(0);
    const heading = book.content[0];
    if (heading && heading.type === 'heading') {
      expect(heading.level).toBe(1);
    }
  });

  it('builds TOC from the nav document with fragment resolution', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    const labels = book.toc.map((t) => t.label);
    expect(labels).toEqual(['Chapter One', 'Chapter Two', 'A Section']);
    expect(book.toc[0]!.blockIndex).toBe(0);
    expect(book.toc[2]!.level).toBe(2);
    const last = book.toc[2]!;
    expect(book.content[last.blockIndex]).toBeDefined();
  });

  it('builds TOC from NCX when present', () => {
    const book = parseEpubBuffer(buildNcxEpub(), '/tmp/ncx.epub');
    expect(book.metadata.title).toBe('Ncx Book');
    expect(book.toc.map((t) => t.label)).toEqual(['First Chapter']);
    expect(book.toc[0]!.blockIndex).toBe(0);
  });

  it('collects image resources', () => {
    const book = parseEpubBuffer(buildEpub(), '/tmp/book.epub');
    expect(book.resources.has('OEBPS/images/cover.jpg')).toBe(true);
  });

  it('rejects a non-zip epub', () => {
    expect(() => parseEpubBuffer(Buffer.from('not a zip'), '/tmp/x.epub')).toThrow(ParseError);
  });

  it('rejects a broken zip container', () => {
    expect(() => parseEpubBuffer(makeBrokenZip(), '/tmp/x.epub')).toThrow(ParseError);
  });
});

describe('EPUB parser coverage edge cases', () => {
  it('rejects container.xml without a <container> root', () => {
    const zip = buildRawEpub('', {}, '<?xml version="1.0"?><wrong/>');
    expect(() => parseEpubBuffer(zip, '/tmp/x.epub')).toThrow(/missing <container>/);
  });

  it('rejects container.xml without rootfiles', () => {
    const zip = buildRawEpub('', {}, '<?xml version="1.0"?><container/>');
    expect(() => parseEpubBuffer(zip, '/tmp/x.epub')).toThrow(/no rootfile found/);
  });

  it('rejects a rootfile without a full-path attribute', () => {
    const zip = buildRawEpub(
      '',
      {},
      '<?xml version="1.0"?><container><rootfiles><rootfile/></rootfiles></container>',
    );
    expect(() => parseEpubBuffer(zip, '/tmp/x.epub')).toThrow(/no rootfile found/);
  });

  it('rejects an OPF without a <package> root', () => {
    const zip = buildRawEpub('<?xml version="1.0"?><not-a-package/>');
    expect(() => parseEpubBuffer(zip, '/tmp/x.epub')).toThrow(/missing <package>/);
  });

  it('falls back to filename when title is missing and skips empty metadata', () => {
    const opf = simpleOpf({
      metadata: '<dc:date>in progress</dc:date>',
      manifest: '<item id="c1" href="c1.xhtml"/>',
      spine: '<itemref idref="c1"/>',
    });
    const zip = buildRawEpub(opf, { 'c1.xhtml': XHTML('<h1>Hi</h1>') });
    const book = parseEpubBuffer(zip, '/tmp/untitled.epub');
    expect(book.metadata.title).toBe('untitled');
    expect(book.metadata.lang).toBeUndefined();
    expect(book.metadata.year).toBeUndefined();
    expect(book.metadata.authors).toEqual([]);
  });

  it('skips manifest items without id or href', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Skips</dc:title>',
      manifest:
        '<item href="noid.xhtml" media-type="application/xhtml+xml"/><item id="nohref" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
    });
    const zip = buildRawEpub(opf, { 'c1.xhtml': XHTML('<h1>Hi</h1>') });
    const book = parseEpubBuffer(zip, '/tmp/x.epub');
    expect(book.content).toHaveLength(1);
  });

  it('skips spine items not in the manifest and non-html items', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Skips</dc:title>',
      manifest:
        '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/>',
      spine: '<itemref idref="ghost"/><itemref idref="css"/><itemref idref="c1"/>',
    });
    const zip = buildRawEpub(opf, { 'c1.xhtml': XHTML('<h1>Hi</h1>') });
    const book = parseEpubBuffer(zip, '/tmp/x.epub');
    expect(book.content).toHaveLength(1);
  });

  it('parses spine content files without an <html> wrapper', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Raw</dc:title>',
      manifest: '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
    });
    const zip = buildRawEpub(opf, {
      'c1.xhtml': '<?xml version="1.0"?><section><h1>Raw</h1><p>Body</p></section>',
    });
    const book = parseEpubBuffer(zip, '/tmp/x.epub');
    expect(book.content.map((b) => b.type)).toContain('heading');
  });

  it('throws when a spine content file cannot be read', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Missing</dc:title>',
      manifest: '<item id="c1" href="gone.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
    });
    const zip = buildRawEpub(opf);
    expect(() => parseEpubBuffer(zip, '/tmp/x.epub')).toThrow(/Cannot read EPUB content file/);
  });

  it('returns empty toc for NCX without <ncx> or navMap', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Ncx</dc:title>',
      manifest:
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
      spineAttr: 'toc="ncx"',
    });
    const zipNoRoot = buildRawEpub(opf, {
      'toc.ncx': '<?xml version="1.0"?><not-ncx/>',
      'c1.xhtml': XHTML('<h1>Hi</h1>'),
    });
    expect(parseEpubBuffer(zipNoRoot, '/tmp/x.epub').toc).toEqual([]);
    const zipNoMap = buildRawEpub(opf, {
      'toc.ncx': '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"/>',
      'c1.xhtml': XHTML('<h1>Hi</h1>'),
    });
    expect(parseEpubBuffer(zipNoMap, '/tmp/x.epub').toc).toEqual([]);
  });

  it('parses navPoints without src or fragment', () => {
    const ncx = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>No Src</text></navLabel></navPoint>
    <navPoint id="n2"><navLabel><text>No Frag</text></navLabel><content src="c1.xhtml"/></navPoint>
  </navMap>
</ncx>`;
    const opf = simpleOpf({
      metadata: '<dc:title>Ncx</dc:title>',
      manifest:
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
      spineAttr: 'toc="ncx"',
    });
    const zip = buildRawEpub(opf, {
      'toc.ncx': ncx,
      'c1.xhtml': XHTML('<h1 id="top">Hi</h1>'),
    });
    const book = parseEpubBuffer(zip, '/tmp/x.epub');
    expect(book.toc.map((t) => t.label)).toEqual(['No Src', 'No Frag']);
  });

  it('returns empty toc when the nav document has no html/body/nav/ol', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Nav</dc:title>',
      manifest:
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
    });
    const noHtml = buildRawEpub(opf, {
      'nav.xhtml': '<nav><ol><li><a href="c1.xhtml">X</a></li></ol></nav>',
      'c1.xhtml': XHTML('<h1>Hi</h1>'),
    });
    expect(parseEpubBuffer(noHtml, '/tmp/x.epub').toc).toEqual([]);
    const noNav = buildRawEpub(opf, {
      'nav.xhtml': XHTML('<p>no nav</p>'),
      'c1.xhtml': XHTML('<h1>Hi</h1>'),
    });
    expect(parseEpubBuffer(noNav, '/tmp/x.epub').toc).toEqual([]);
    const noOl = buildRawEpub(opf, {
      'nav.xhtml': XHTML('<nav><p>no ol</p></nav>'),
      'c1.xhtml': XHTML('<h1>Hi</h1>'),
    });
    expect(parseEpubBuffer(noOl, '/tmp/x.epub').toc).toEqual([]);
  });

  it('falls back to the first nav when no nav has type="toc"', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Nav</dc:title>',
      manifest:
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
    });
    const zip = buildRawEpub(opf, {
      'nav.xhtml': XHTML('<nav><ol><li><a href="c1.xhtml">First</a></li></ol></nav>'),
      'c1.xhtml': XHTML('<h1 id="top">Hi</h1>'),
    });
    const book = parseEpubBuffer(zip, '/tmp/x.epub');
    expect(book.toc.map((t) => t.label)).toEqual(['First']);
  });

  it('skips empty labels and handles spans without href in nav li', () => {
    const opf = simpleOpf({
      metadata: '<dc:title>Nav</dc:title>',
      manifest:
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
      spine: '<itemref idref="c1"/>',
    });
    const zip = buildRawEpub(opf, {
      'nav.xhtml': XHTML(
        '<nav><ol><li><a href="c1.xhtml#top">Real</a></li><li><span>No Href</span></li><li></li></ol></nav>',
      ),
      'c1.xhtml': XHTML('<h1 id="top">Hi</h1>'),
    });
    const book = parseEpubBuffer(zip, '/tmp/x.epub');
    expect(book.toc.map((t) => t.label)).toEqual(['Real', 'No Href']);
  });
});
