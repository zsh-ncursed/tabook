import path from 'node:path';
import { parseXml, childrenOf, firstChild, findChildren, attrOf, textOf, tagOf } from '../xml.js';
import type { XmlChildren, XmlNode } from '../xml.js';
import { decodeXmlBuffer, isZipBuffer } from '../encoding.js';
import { ParseError, messageOf } from '../../utils/errors.js';
import { normalizeWhitespace } from '../../utils/text.js';
import { openZip } from '../../utils/zip.js';
import type { ZipArchive } from '../../utils/zip.js';
import type { BookMetadata, ParsedBook, TocEntry } from '../model.js';
import { resolveHref } from '../href.js';
import { parseXhtmlBlocks } from './xhtml.js';

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface OpfData {
  metadata: BookMetadata;
  manifest: Map<string, ManifestItem>;
  spine: string[];
  ncxId: string | undefined;
  coverId: string | undefined;
  coverHrefFromProperties: string | undefined;
}

interface TocLink {
  label: string;
  href: string;
  fragment?: string;
  level: number;
  children: TocLink[];
}

function readTextFile(zip: ZipArchive, entryName: string): string {
  return decodeXmlBuffer(zip.read(entryName));
}

function findNode(children: XmlChildren, tag: string): XmlNode | undefined {
  for (const node of children) {
    if (tagOf(node) === tag) return node;
  }
  return undefined;
}

function parseContainer(zip: ZipArchive): string {
  let containerText: string;
  try {
    containerText = readTextFile(zip, 'META-INF/container.xml');
  } catch {
    throw new ParseError('Not a valid EPUB: missing META-INF/container.xml');
  }
  const children = parseXml(containerText);
  const containerNode = findNode(children, 'container');
  if (!containerNode) {
    throw new ParseError('Invalid EPUB container.xml: missing <container>');
  }
  const rootfilesNode = firstChild(containerNode, 'rootfiles');
  for (const rf of rootfilesNode ? findChildren(rootfilesNode, 'rootfile') : []) {
    const fullPath = attrOf(rf, 'full-path');
    if (fullPath) return fullPath;
  }
  throw new ParseError('Invalid EPUB container.xml: no rootfile found');
}

function parseOpf(zip: ZipArchive, opfPath: string): OpfData {
  const text = readTextFile(zip, opfPath);
  const children = parseXml(text);
  const packageNode = findNode(children, 'package');
  if (!packageNode) {
    throw new ParseError('Invalid EPUB OPF: missing <package>');
  }
  const opfDir = path.posix.dirname(opfPath);

  const metadataNode = firstChild(packageNode, 'metadata');
  const metadata: BookMetadata = { title: '', authors: [], genres: [], annotation: '' };
  if (metadataNode) {
    metadata.title = normalizeWhitespace(textOf(firstChild(metadataNode, 'title')));
    metadata.authors = findChildren(metadataNode, 'creator').map((c) => {
      const name = normalizeWhitespace(textOf(c));
      if (!name) return { firstName: '', lastName: '', nickname: undefined };
      // EPUB stores author as a single string ("Jane Roe"), unlike FB2 which
      // has separate firstName/lastName. Split into parts for structured use,
      // but keep the original string as nickname so joinAuthors preserves
      // the original order the publisher intended.
      const parts = name.split(/\s+/);
      if (parts.length >= 2) {
        return { firstName: parts[0]!, lastName: parts.slice(1).join(' '), nickname: name };
      }
      return { firstName: '', lastName: name, nickname: name };
    });
    metadata.genres = findChildren(metadataNode, 'subject')
      .map((s) => normalizeWhitespace(textOf(s)))
      .filter(Boolean);
    metadata.lang = normalizeWhitespace(textOf(firstChild(metadataNode, 'language'))) || undefined;
    metadata.annotation = findChildren(metadataNode, 'description')
      .map((d) => normalizeWhitespace(textOf(d)))
      .filter(Boolean)
      .join('\n\n');
    metadata.publisher =
      normalizeWhitespace(textOf(firstChild(metadataNode, 'publisher'))) || undefined;
    const isbn = normalizeWhitespace(textOf(firstChild(metadataNode, 'identifier')));
    if (isbn) metadata.isbn = isbn;
    const yearMatch = /^(\d{4})/.exec(
      normalizeWhitespace(textOf(firstChild(metadataNode, 'date'))),
    );
    if (yearMatch) metadata.year = Number(yearMatch[1]);
  }

  const manifest = new Map<string, ManifestItem>();
  const manifestNode = firstChild(packageNode, 'manifest');
  if (manifestNode) {
    for (const item of findChildren(manifestNode, 'item')) {
      const id = attrOf(item, 'id');
      const href = attrOf(item, 'href');
      if (!id || href === undefined) continue;
      manifest.set(id, {
        id,
        href: resolveHref(opfDir, href),
        mediaType: attrOf(item, 'media-type') ?? '',
      });
    }
  }

  const spineNode = firstChild(packageNode, 'spine');
  const spine: string[] = [];
  let ncxId: string | undefined;
  if (spineNode) {
    ncxId = attrOf(spineNode, 'toc');
    for (const itemref of findChildren(spineNode, 'itemref')) {
      const idref = attrOf(itemref, 'idref');
      if (idref) spine.push(idref);
    }
  }

  let coverId: string | undefined;
  let coverHrefFromProperties: string | undefined;
  if (metadataNode) {
    for (const meta of findChildren(metadataNode, 'meta')) {
      if (attrOf(meta, 'name') === 'cover') coverId = attrOf(meta, 'content');
    }
  }
  // EPUB3 declares cover via the manifest item's `properties="cover-image"`
  // attribute rather than the EPUB2 <meta name="cover">. Prefer the EPUB2
  // signal when present, fall back to the EPUB3 one so both work.
  if (manifestNode) {
    for (const item of findChildren(manifestNode, 'item')) {
      const props = attrOf(item, 'properties') ?? '';
      if (props.split(/\s+/).includes('cover-image')) {
        const id = attrOf(item, 'id');
        if (id) {
          coverHrefFromProperties = attrOf(item, 'href');
          if (!coverId) coverId = id;
        }
      }
    }
  }

  return { metadata, manifest, spine, ncxId, coverId, coverHrefFromProperties };
}

function parseNcx(zip: ZipArchive, ncxHref: string, opfDir: string): TocLink[] {
  const text = readTextFile(zip, ncxHref);
  const children = parseXml(text);
  const ncxNode = findNode(children, 'ncx');
  if (!ncxNode) return [];
  const navMap = firstChild(ncxNode, 'navMap');
  if (!navMap) return [];
  return findChildren(navMap, 'navPoint').map((np) => parseNavPoint(np, opfDir));
}

function parseNavPoint(node: XmlNode, opfDir: string, level = 1): TocLink {
  const navLabel = firstChild(node, 'navLabel');
  const label = normalizeWhitespace(textOf(firstChild(navLabel, 'text')));
  const src = attrOf(firstChild(node, 'content'), 'src') ?? '';
  const [file, fragment] = src.split('#');
  return {
    label,
    href: resolveHref(opfDir, file ?? ''),
    fragment: fragment && fragment !== '' ? fragment : undefined,
    level,
    children: findChildren(node, 'navPoint').map((np) => parseNavPoint(np, opfDir, level + 1)),
  };
}

function parseNavDoc(zip: ZipArchive, navHref: string, opfDir: string): TocLink[] {
  const text = readTextFile(zip, navHref);
  const children = parseXml(text);
  const html = findNode(children, 'html');
  const body = html ? firstChild(html, 'body') : undefined;
  if (!body) return [];
  let navNode: XmlNode | undefined;
  for (const nav of findChildren(body, 'nav')) {
    if (attrOf(nav, 'type') === 'toc') {
      navNode = nav;
      break;
    }
  }
  navNode = navNode ?? findChildren(body, 'nav')[0];
  if (!navNode) return [];
  const ol = firstChild(navNode, 'ol');
  if (!ol) return [];
  return findChildren(ol, 'li').map((li) => parseNavLi(li, opfDir));
}

function parseNavLi(node: XmlNode, opfDir: string, level = 1): TocLink {
  let label = '';
  let href = '';
  let fragment: string | undefined;
  for (const kid of childrenOf(node)) {
    const tag = tagOf(kid);
    if (tag === 'a' || tag === 'span') {
      const target = attrOf(kid, 'href');
      if (target) {
        const [file, frag] = target.split('#');
        href = resolveHref(opfDir, file ?? '');
        fragment = frag && frag !== '' ? frag : undefined;
      }
      if (label === '') label = normalizeWhitespace(textOf(kid));
    }
  }
  const children: TocLink[] = [];
  for (const ol of findChildren(node, 'ol')) {
    children.push(...findChildren(ol, 'li').map((li) => parseNavLi(li, opfDir, level + 1)));
  }
  return { label, href, fragment, level, children };
}

export function parseEpubBuffer(data: Uint8Array, filePath: string): ParsedBook {
  if (!isZipBuffer(data)) {
    throw new ParseError('EPUB file is not a ZIP archive');
  }
  const zip = openZip(data);
  const opfPath = parseContainer(zip);
  const opf = parseOpf(zip, opfPath);
  const opfDir = path.posix.dirname(opfPath);

  const tocLinks: TocLink[] = [];
  if (opf.ncxId) {
    const ncxItem = opf.manifest.get(opf.ncxId);
    if (ncxItem) tocLinks.push(...parseNcx(zip, ncxItem.href, opfDir));
  }
  if (tocLinks.length === 0) {
    for (const item of opf.manifest.values()) {
      if (item.mediaType === 'application/xhtml+xml' && /nav\.x?html$/i.test(item.href)) {
        tocLinks.push(...parseNavDoc(zip, item.href, opfDir));
        break;
      }
    }
  }

  const contentBlocks: ParsedBook['content'] = [];
  const idToBlock = new Map<string, number>();
  const fileToBlock = new Map<string, number>();
  let blockIndex = 0;

  for (const idref of opf.spine) {
    const item = opf.manifest.get(idref);
    if (!item) continue;
    if (!/\.x?html?$/i.test(item.href) && !/html|xml$/i.test(item.mediaType)) continue;
    let docText: string;
    try {
      docText = readTextFile(zip, item.href);
    } catch (err) {
      // Defensive: readTextFile only throws ParseError today, but keeping the
      // unknown guard (instead of `err as Error`) avoids an "undefined" message
      // if any future caller throws a non-Error value. Costs nothing and keeps
      // error reporting robust without trusting every throw site.
      throw new ParseError(`Cannot read EPUB content file ${item.href}: ${messageOf(err)}`, {
        cause: err,
      });
    }
    const parsed = parseXml(docText);
    const html = findNode(parsed, 'html');
    const body = html ? firstChild(html, 'body') : undefined;
    const result = parseXhtmlBlocks(
      body ? childrenOf(body) : parsed,
      path.posix.dirname(item.href),
    );
    fileToBlock.set(item.href, blockIndex);
    for (const [fragId, idx] of result.idToBlock) {
      idToBlock.set(`${item.href}#${fragId}`, idx + blockIndex);
    }
    contentBlocks.push(...result.blocks);
    blockIndex += result.blocks.length;
  }

  const toc: TocEntry[] = [];
  flattenToc(tocLinks, idToBlock, fileToBlock, toc);

  const resources = new Map<string, Uint8Array>();
  for (const item of opf.manifest.values()) {
    if (item.mediaType.startsWith('image/') && !resources.has(item.href)) {
      try {
        resources.set(item.href, zip.read(item.href));
      } catch {
        // ignore missing image resources
      }
    }
  }

  const coverHref =
    (opf.coverId ? opf.manifest.get(opf.coverId)?.href : undefined) ?? opf.coverHrefFromProperties;
  if (coverHref) opf.metadata.coverKey = coverHref;

  const filename = path.basename(filePath);
  if (opf.metadata.title === '') {
    opf.metadata.title = filename.replace(/\.[^.]+$/, '');
  }

  return {
    format: 'epub',
    path: filePath,
    filename,
    size: data.length,
    metadata: opf.metadata,
    toc,
    content: contentBlocks,
    resources,
  };
}

function flattenToc(
  links: TocLink[],
  idToBlock: Map<string, number>,
  fileToBlock: Map<string, number>,
  out: TocEntry[],
): void {
  for (const link of links) {
    if (link.label === '') continue;
    const withFrag = link.fragment ? `${link.href}#${link.fragment}` : link.href;
    const blockIndex = idToBlock.get(withFrag) ?? fileToBlock.get(link.href) ?? 0;
    out.push({ id: `epub-${out.length + 1}`, label: link.label, level: link.level, blockIndex });
    flattenToc(link.children, idToBlock, fileToBlock, out);
  }
}
