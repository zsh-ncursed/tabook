import path from 'node:path';
import {
  parseXml,
  childrenOf,
  firstChild,
  findChildren,
  attrOf,
  textOf,
  tagOf,
  fullTextOf,
} from '../xml.js';
import type { XmlChildren, XmlNode } from '../xml.js';
import { normalizeInlines, parseInlines } from '../inline.js';
import type { Block, BookMetadata, Inline, ListItem, ParsedBook, TocEntry } from '../model.js';
import { decodeXmlBuffer, isZipBuffer } from '../encoding.js';
import { ParseError } from '../../utils/errors.js';
import { normalizeWhitespace } from '../../utils/text.js';
import { openZip } from '../../utils/zip.js';

interface Fb2Document {
  root: XmlNode;
  rootChildren: XmlChildren;
}

function findRoot(children: XmlChildren): Fb2Document {
  for (const node of children) {
    const tag = tagOf(node);
    if (tag === 'FictionBook') {
      return { root: node, rootChildren: childrenOf(node) };
    }
  }
  throw new ParseError('Not an FB2 document: missing <FictionBook> root element');
}

function titleInfo(root: XmlNode): XmlNode | undefined {
  const description = firstChild(root, 'description');
  if (!description) return undefined;
  return firstChild(description, 'title-info');
}

function parseAuthor(node: XmlNode) {
  const result = [];
  for (const author of findChildren(node, 'author')) {
    const nickname = textOf(firstChild(author, 'nickname'));
    const firstName = textOf(firstChild(author, 'first-name'));
    const lastName = textOf(firstChild(author, 'last-name'));
    const middleName = textOf(firstChild(author, 'middle-name'));
    if (nickname || firstName || lastName || middleName) {
      result.push({ firstName, lastName, middleName, nickname });
    }
  }
  return result;
}

function parseAnnotation(node: XmlNode | undefined): string {
  if (!node) return '';
  const paragraphs = findChildren(node, 'p');
  if (paragraphs.length > 0) {
    return paragraphs
      .map((p) => normalizeWhitespace(fullTextOf(p)))
      .filter(Boolean)
      .join('\n\n');
  }
  return normalizeWhitespace(fullTextOf(node));
}

function collectGenres(titleInfoNode: XmlNode): string[] {
  return findChildren(titleInfoNode, 'genre')
    .map((g) => normalizeWhitespace(textOf(g)))
    .filter(Boolean);
}

function parseMetadata(root: XmlNode, fallbackTitle: string): BookMetadata {
  const info = titleInfo(root);
  const metadata: BookMetadata = {
    title: '',
    authors: [],
    genres: [],
    annotation: '',
  };
  if (!info) {
    metadata.title = fallbackTitle;
    return metadata;
  }
  const bookTitle = textOf(firstChild(info, 'book-title'));
  metadata.title = normalizeWhitespace(bookTitle) || fallbackTitle;
  metadata.authors = parseAuthor(info);
  metadata.genres = collectGenres(info);
  metadata.annotation = parseAnnotation(firstChild(info, 'annotation'));
  metadata.lang = textOf(firstChild(info, 'lang')) || undefined;

  const sequence = firstChild(info, 'sequence');
  if (sequence) {
    const name = attrOf(sequence, 'name');
    if (name) {
      const numberRaw = attrOf(sequence, 'number');
      const number = numberRaw !== undefined ? Number(numberRaw) : undefined;
      metadata.series = {
        name,
        number: number !== undefined && Number.isFinite(number) ? number : undefined,
      };
    }
  }

  const coverpage = firstChild(info, 'coverpage');
  const cover = coverpage ? firstChild(coverpage, 'image') : undefined;
  if (cover) {
    const href = attrOf(cover, 'href');
    if (href) metadata.coverKey = href.replace(/^#/, '');
  }
  const descriptionNode = firstChild(root, 'description');
  const publishInfo = firstChild(descriptionNode, 'publish-info');
  if (publishInfo) {
    metadata.publisher = textOf(firstChild(publishInfo, 'publisher')) || undefined;
    metadata.isbn = textOf(firstChild(publishInfo, 'isbn')) || undefined;
    const yearText = textOf(firstChild(publishInfo, 'year'));
    if (yearText) {
      const year = Number(yearText);
      if (Number.isFinite(year)) metadata.year = year;
    }
  }

  return metadata;
}

function collectResources(rootChildren: XmlChildren): Map<string, Uint8Array> {
  const resources = new Map<string, Uint8Array>();
  const binaries = rootChildren.filter((node) => tagOf(node) === 'binary');
  for (const bin of binaries) {
    const id = attrOf(bin, 'id');
    if (!id) continue;
    try {
      resources.set(id, Buffer.from(textOf(bin).replace(/\s+/g, ''), 'base64'));
    } catch {
      resources.set(id, new Uint8Array(0));
    }
  }
  return resources;
}

interface ParseState {
  blocks: Block[];
  toc: TocEntry[];
  blockIndex: number;
}

function emitBlock(state: ParseState, block: Block | Block[]): void {
  const list = Array.isArray(block) ? block : [block];
  for (const b of list) {
    if (b.type === 'empty') {
      state.blocks.push(b);
      state.blockIndex += 1;
      continue;
    }
    state.blocks.push(b);
    state.blockIndex += 1;
  }
}

function emitHeading(
  state: ParseState,
  level: number,
  inlines: Inline[],
  id?: string,
  isTocEntry = true,
): void {
  const normalized = normalizeInlines(inlines);
  emitBlock(state, { type: 'heading', level, children: normalized });
  if (isTocEntry && normalized.length > 0) {
    state.toc.push({
      id: id ?? `h${state.toc.length + 1}`,
      label: plainHeadingText(normalized),
      level,
      blockIndex: state.blockIndex - 1,
    });
  }
}

function plainHeadingText(inlines: Inline[]): string {
  let out = '';
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text':
        out += inline.text;
        break;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
      case 'link':
        out += plainHeadingText(inline.children);
        break;
      case 'code':
        out += inline.text;
        break;
      default:
        break;
    }
  }
  return normalizeWhitespace(out);
}

function parseList(node: XmlNode): Block {
  const items: ListItem[] = [];
  for (const li of findChildren(node, 'li')) {
    const kids = childrenOf(li);
    const itemInlines: Inline[] = [];
    const nested: Block[] = [];
    for (const kid of kids) {
      const tag = tagOf(kid);
      if (tag === 'list' || tag === 'section') {
        nested.push(parseList(kid));
      } else {
        itemInlines.push(...parseInlines(kid));
      }
    }
    items.push({ children: normalizeInlines(itemInlines), nested });
  }
  return { type: 'list', ordered: false, items };
}

function parsePoem(node: XmlNode): Block {
  const stanzas: { lines: Inline[][] }[] = [];
  let current: { lines: Inline[][] } = { lines: [] };
  const flush = (): void => {
    if (current.lines.length > 0) {
      stanzas.push(current);
      current = { lines: [] };
    }
  };
  for (const kid of childrenOf(node)) {
    const tag = tagOf(kid);
    if (tag === 'stanza') {
      flush();
      for (const v of findChildren(kid, 'v')) {
        current.lines.push(normalizeInlines(parseInlines(v)));
      }
      for (const sub of findChildren(kid, 'subtitle')) {
        current.lines.push(normalizeInlines(parseInlines(sub)));
      }
    } else if (tag === 'v') {
      current.lines.push(normalizeInlines(parseInlines(kid)));
    } else if (tag === 'subtitle') {
      current.lines.push(normalizeInlines(parseInlines(kid)));
    } else if (tag === 'title') {
      flush();
      stanzas.push({ lines: [normalizeInlines(parseInlines(firstChild(kid, 'p') ?? kid))] });
    }
  }
  flush();
  return { type: 'poem', stanzas };
}

function parseTable(node: XmlNode): Block {
  const rows: XmlNode[] = findChildren(node, 'tr');
  const tableRows: Inline[][][] = [];
  let headers: Inline[][] = [];
  let isFirst = true;
  for (const tr of rows) {
    const cells = [...findChildren(tr, 'td'), ...findChildren(tr, 'th')];
    const cellInlines = cells.map((c) => normalizeInlines(parseInlines(c)));
    if (isFirst && findChildren(tr, 'th').length > 0) {
      headers = cellInlines;
    } else {
      tableRows.push(cellInlines);
    }
    isFirst = false;
  }
  return { type: 'table', headers, rows: tableRows };
}

function parseEpigraph(node: XmlNode): Block[] {
  const result: Block[] = [];
  for (const kid of childrenOf(node)) {
    const tag = tagOf(kid);
    if (tag === 'p' || tag === 'poem') {
      if (tag === 'poem') {
        result.push(parsePoem(kid));
      } else {
        result.push({ type: 'epigraph', children: normalizeInlines(parseInlines(kid)) });
      }
    } else if (tag === 'text-author') {
      result.push({
        type: 'epigraph',
        children: [{ kind: 'italic', children: normalizeInlines(parseInlines(kid)) }],
      });
    }
  }
  if (result.length === 0) {
    result.push({ type: 'epigraph', children: normalizeInlines(parseInlines(node)) });
  }
  return result;
}

function parseContainer(state: ParseState, nodes: XmlChildren, depth: number): void {
  for (const node of nodes) {
    const tag = tagOf(node);
    switch (tag) {
      case 'section': {
        const kids = childrenOf(node);
        for (const kid of kids) {
          const kidTag = tagOf(kid);
          if (kidTag === 'title') {
            const p = firstChild(kid, 'p') ?? kid;
            const level = Math.min(depth, 6);
            emitHeading(state, level, parseInlines(p), attrOf(kid, 'id'));
          } else {
            parseContainer(state, [kid], depth + 1);
          }
        }
        break;
      }
      case 'title': {
        const p = firstChild(node, 'p') ?? node;
        emitHeading(state, Math.min(depth, 6), parseInlines(p), attrOf(node, 'id'));
        break;
      }
      case 'subtitle':
        emitHeading(state, 3, parseInlines(node), attrOf(node, 'id'), false);
        break;
      case 'p': {
        const inlines = normalizeInlines(parseInlines(node));
        if (inlines.length === 0) {
          emitBlock(state, { type: 'empty' });
        } else {
          emitBlock(state, { type: 'paragraph', children: inlines });
        }
        break;
      }
      case 'empty-line':
        emitBlock(state, { type: 'empty' });
        break;
      case 'cite':
        emitBlock(state, { type: 'quote', children: normalizeInlines(parseInlines(node)) });
        break;
      case 'poem':
        emitBlock(state, parsePoem(node));
        break;
      case 'table':
        emitBlock(state, parseTable(node));
        break;
      case 'image': {
        const src = attrOf(node, 'href')?.replace(/^#/, '') ?? '';
        emitBlock(state, { type: 'image', src, alt: attrOf(node, 'alt') ?? '' });
        break;
      }
      case 'list':
        emitBlock(state, parseList(node));
        break;
      case 'epigraph':
        emitBlock(state, parseEpigraph(node));
        break;
      case 'annotation':
        emitBlock(state, { type: 'annotation', children: normalizeInlines(parseInlines(node)) });
        break;
      case 'text-author':
        emitBlock(state, {
          type: 'paragraph',
          children: [{ kind: 'italic', children: normalizeInlines(parseInlines(node)) }],
        });
        break;
      case 'code':
        emitBlock(state, { type: 'paragraph', children: normalizeInlines(parseInlines(node)) });
        break;
      default: {
        const kids = childrenOf(node);
        if (kids.length > 0) {
          parseContainer(state, kids, depth);
        }
        break;
      }
    }
  }
}

function selectMainBody(rootChildren: XmlChildren): XmlChildren {
  const bodies = rootChildren.filter((node) => tagOf(node) === 'body');
  if (bodies.length === 0) return [];
  for (const body of bodies) {
    if (!attrOf(body, 'name')) return childrenOf(body);
  }
  return childrenOf(bodies[0]!);
}

export function parseFb2Text(xmlText: string, _path: string, filename: string): ParsedBookResult {
  const children = parseXml(xmlText);
  const { root, rootChildren } = findRoot(children);
  const fallbackTitle = filename.replace(/\.[^.]+$/, '');
  const metadata = parseMetadata(root, fallbackTitle);
  const resources = collectResources(rootChildren);
  const state: ParseState = { blocks: [], toc: [], blockIndex: 0 };
  const body = selectMainBody(rootChildren);
  parseContainer(state, body, 2);
  return { metadata, resources, state };
}

export interface ParsedBookResult {
  metadata: BookMetadata;
  resources: Map<string, Uint8Array>;
  state: ParseState;
}

export function parseFb2Buffer(data: Uint8Array, filePath: string): ParsedBook {
  if (isZipBuffer(data)) {
    return parseFb2Zip(data, filePath);
  }
  return buildBookFromResult(
    parseFb2Text(decodeXmlBuffer(data), filePath, path.basename(filePath)),
    filePath,
  );
}

function parseFb2Zip(data: Uint8Array, filePath: string): ParsedBook {
  const zip = openZip(data);
  const entries = zip.entries.filter(
    (e) => e.name.endsWith('.fb2') && !e.name.startsWith('__MACOSX'),
  );
  if (entries.length === 0) {
    throw new ParseError('ZIP archive does not contain an .fb2 file');
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const entry = entries[0]!;
  const inner = zip.read(entry.name);
  const xmlText = decodeXmlBuffer(inner);
  return buildBookFromResult(
    parseFb2Text(xmlText, filePath, entry.name.split('/').pop() ?? entry.name),
    filePath,
    data.length,
  );
}

function buildBookFromResult(result: ParsedBookResult, filePath: string, size = 0): ParsedBook {
  return {
    format: 'fb2',
    path: filePath,
    filename: path.basename(filePath),
    size,
    metadata: result.metadata,
    toc: result.state.toc,
    content: result.state.blocks,
    resources: result.resources,
  };
}

export function extractFb2FromZip(data: Uint8Array): { name: string; data: Uint8Array } {
  const zip = openZip(data);
  const fb2Entries = zip.entries.filter((e) => e.name.endsWith('.fb2'));
  if (fb2Entries.length === 0) {
    throw new ParseError('ZIP archive does not contain an .fb2 file');
  }
  const entry = fb2Entries[0]!;
  return { name: entry.name, data: zip.read(entry.name) };
}

// Metadata-only parse: extracts BookMetadata without building content blocks
// or decoding base64 resources. ~10x faster than parseFb2Buffer for large files.
export function parseFb2Metadata(data: Uint8Array, filePath: string): BookMetadata {
  if (isZipBuffer(data)) {
    const zip = openZip(data);
    const entries = zip.entries.filter(
      (e) => e.name.endsWith('.fb2') && !e.name.startsWith('__MACOSX'),
    );
    if (entries.length === 0) {
      throw new ParseError('ZIP archive does not contain an .fb2 file');
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const entry = entries[0]!;
    const inner = zip.read(entry.name);
    const { root } = findRoot(parseXml(decodeXmlBuffer(inner)));
    const fallback = (entry.name.split('/').pop() ?? entry.name).replace(/\.[^.]+$/, '');
    return parseMetadata(root, fallback);
  }
  const { root } = findRoot(parseXml(decodeXmlBuffer(data)));
  return parseMetadata(root, path.basename(filePath).replace(/\.[^.]+$/, ''));
}
