import {
  parseXml,
  findChildren,
  firstChild,
  textOf,
  fullTextOf,
  attributesOf,
  type XmlNode,
} from '../formats/xml.js';
import { ParseError } from '../utils/errors.js';
import { stripHtml } from '../utils/text.js';
import type { OpdsFeed, OpdsEntry, OpdsLink, FeedKind } from './model.js';
import { ACQUISITION_RELS } from './model.js';

export function parseOpdsAtom(xml: string): OpdsFeed {
  let root: XmlNode[];
  try {
    root = parseXml(xml);
  } catch (err) {
    throw new ParseError(
      `Failed to parse OPDS feed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const feedNode = root.find((n) => {
    const tag = Object.keys(n)[0] ?? '';
    return tag === 'feed';
  });
  if (!feedNode) throw new ParseError('No <feed> root element in OPDS document');

  return parseFeed(feedNode);
}

function parseFeed(node: XmlNode): OpdsFeed {
  const id = textOf(firstChild(node, 'id')) || '';
  const title = textOf(firstChild(node, 'title')) || '';
  const subtitle = textOf(firstChild(node, 'subtitle')) || undefined;
  const updated = textOf(firstChild(node, 'updated')) || '';

  const linkNodes = findChildren(node, 'link');
  const links = linkNodes.map(parseLink).filter((l): l is OpdsLink => l !== null);

  const facets = links
    .filter((l) => l.rel === 'http://opds-spec.org/facet')
    .map((l) => ({
      group: l.facetGroup ?? '',
      title: l.title ?? '',
      href: l.href,
      active: l.activeFacet ?? false,
      count: l.count,
    }));

  const entryNodes = findChildren(node, 'entry');
  const entries = entryNodes.map(parseEntry);

  const kind = inferFeedKind(links, entries);

  return {
    id,
    title,
    subtitle,
    updated,
    kind,
    links,
    facets,
    entries,
    selfHref: findRel(links, 'self'),
    startHref: findRel(links, 'start'),
    upHref: findRel(links, 'up'),
    nextHref: findRel(links, 'next'),
    prevHref: findRel(links, 'previous') ?? findRel(links, 'prev'),
    searchHref: findRel(links, 'search'),
    totalResults: numChild(node, 'totalResults'),
    itemsPerPage: numChild(node, 'itemsPerPage'),
    startIndex: numChild(node, 'startIndex'),
  };
}

function parseEntry(node: XmlNode): OpdsEntry {
  const id = textOf(firstChild(node, 'id')) || '';
  const title = textOf(firstChild(node, 'title')) || '';
  const updated = textOf(firstChild(node, 'updated')) || '';
  const summary = textOf(firstChild(node, 'summary')) || undefined;
  const contentNode = firstChild(node, 'content');
  const contentType = contentNode ? attributesOf(contentNode).type : undefined;
  const rawContent = contentNode ? fullTextOf(contentNode) : undefined;
  const content =
    rawContent && contentType && /html/i.test(contentType)
      ? stripHtml(rawContent)
      : rawContent;
  const rights = textOf(firstChild(node, 'rights')) || undefined;
  const published = textOf(firstChild(node, 'published')) || undefined;

  const authorNodes = findChildren(node, 'author');
  const authors = authorNodes.map((an) => ({
    name: textOf(firstChild(an, 'name')) || '',
    uri: textOf(firstChild(an, 'uri')) || undefined,
  }));

  const categoryNodes = findChildren(node, 'category');
  const categories = categoryNodes.map((cn) => {
    const attrs = attributesOf(cn);
    return {
      scheme: attrs.scheme,
      term: attrs.term ?? '',
      label: attrs.label,
    };
  });

  const language = textOf(firstChild(node, 'language')) || undefined;
  const issued = textOf(firstChild(node, 'issued')) || undefined;
  const publisher = textOf(firstChild(node, 'publisher')) || undefined;
  const identifier = textOf(firstChild(node, 'identifier')) || undefined;

  const linkNodes = findChildren(node, 'link');
  const links = linkNodes.map(parseLink).filter((l): l is OpdsLink => l !== null);
  const acquisitionLinks = links.filter((l) => ACQUISITION_RELS.has(l.rel));

  const thumbnailHref = links.find((l) => l.rel === 'http://opds-spec.org/image/thumbnail')?.href;
  const imageHref = links.find((l) => l.rel === 'http://opds-spec.org/image')?.href;
  const subsectionHref =
    links.find((l) => l.rel === 'subsection' || l.rel === 'http://opds-spec.org/subsection')?.href ??
    // Flibusta and some other catalogs omit rel on navigation links. An entry
    // with no acquisition links but a link to an OPDS catalog feed is a
    // navigation entry — use that link as the subsection href.
    links.find(
      (l) =>
        !ACQUISITION_RELS.has(l.rel) &&
        l.rel !== 'alternate' &&
        l.rel !== 'http://opds-spec.org/image' &&
        l.rel !== 'http://opds-spec.org/image/thumbnail' &&
        l.rel !== 'related' &&
        l.type?.includes('opds-catalog'),
    )?.href;

  const isAcquisition = acquisitionLinks.length > 0;
  const isNavigation = !isAcquisition && subsectionHref !== undefined;

  return {
    id,
    title,
    updated,
    summary,
    content,
    authors,
    categories,
    language,
    issued,
    publisher,
    identifier,
    rights,
    published,
    links,
    acquisitionLinks,
    thumbnailHref,
    imageHref,
    isAcquisition,
    isNavigation,
    subsectionHref,
  };
}

function parseLink(node: XmlNode): OpdsLink | null {
  const attrs = attributesOf(node);
  const rel = attrs.rel ?? '';
  const href = attrs.href ?? '';
  if (!href) return null;
  const link: OpdsLink = { rel, href, type: attrs.type, title: attrs.title };
  if (attrs.length) {
    const n = Number(attrs.length);
    if (!Number.isNaN(n)) link.length = n;
  }
  if (attrs.facetGroup) link.facetGroup = attrs.facetGroup;
  if (attrs.activeFacet === 'true') link.activeFacet = true;
  if (attrs.count) {
    const n = Number(attrs.count);
    if (!Number.isNaN(n)) link.count = n;
  }
  return link;
}

function inferFeedKind(links: OpdsLink[], entries: OpdsEntry[]): FeedKind {
  const selfLink = links.find((l) => l.rel === 'self');
  if (selfLink?.type) {
    if (selfLink.type.includes('kind=acquisition')) return 'acquisition';
    if (selfLink.type.includes('kind=navigation')) return 'navigation';
  }
  if (entries.length > 0 && entries.some((e) => e.isAcquisition)) return 'acquisition';
  if (entries.length > 0 && entries.some((e) => e.isNavigation)) return 'navigation';
  return 'unknown';
}

function findRel(links: OpdsLink[], rel: string): string | undefined {
  return links.find((l) => l.rel === rel)?.href;
}

function numChild(node: XmlNode, tag: string): number | undefined {
  const child = firstChild(node, tag);
  if (!child) return undefined;
  const text = textOf(child);
  if (!text) return undefined;
  const n = Number(text);
  return Number.isNaN(n) ? undefined : n;
}
