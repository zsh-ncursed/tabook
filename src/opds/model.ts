export type LinkRel =
  | 'self'
  | 'start'
  | 'up'
  | 'next'
  | 'previous'
  | 'first'
  | 'last'
  | 'search'
  | 'subsection'
  | 'alternate'
  | 'related'
  | 'http://opds-spec.org/acquisition'
  | 'http://opds-spec.org/acquisition/open-access'
  | 'http://opds-spec.org/acquisition/buy'
  | 'http://opds-spec.org/acquisition/borrow'
  | 'http://opds-spec.org/acquisition/sample'
  | 'http://opds-spec.org/acquisition/subscribe'
  | 'http://opds-spec.org/image'
  | 'http://opds-spec.org/image/thumbnail'
  | 'http://opds-spec.org/facet'
  | 'http://opds-spec.org/sort/new'
  | 'http://opds-spec.org/sort/popular'
  | 'http://opds-spec.org/subsection'
  | string;

export interface OpdsLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
  length?: number;
  facetGroup?: string;
  activeFacet?: boolean;
  count?: number;
}

export type FeedKind = 'navigation' | 'acquisition' | 'unknown';

export interface OpdsFacet {
  group: string;
  title: string;
  href: string;
  active: boolean;
  count?: number;
}

export interface OpdsAuthor {
  name: string;
  uri?: string;
}

export interface OpdsCategory {
  scheme?: string;
  term: string;
  label?: string;
}

export interface OpdsEntry {
  id: string;
  title: string;
  updated: string;
  summary?: string;
  content?: string;
  authors: OpdsAuthor[];
  categories: OpdsCategory[];
  language?: string;
  issued?: string;
  publisher?: string;
  identifier?: string;
  rights?: string;
  published?: string;
  links: OpdsLink[];
  acquisitionLinks: OpdsLink[];
  thumbnailHref?: string;
  imageHref?: string;
  isAcquisition: boolean;
  isNavigation: boolean;
  subsectionHref?: string;
}

export interface OpdsFeed {
  id: string;
  title: string;
  subtitle?: string;
  updated: string;
  kind: FeedKind;
  links: OpdsLink[];
  facets: OpdsFacet[];
  entries: OpdsEntry[];
  selfHref?: string;
  startHref?: string;
  upHref?: string;
  nextHref?: string;
  prevHref?: string;
  searchHref?: string;
  totalResults?: number;
  itemsPerPage?: number;
  startIndex?: number;
}

export interface OpdsCatalog {
  id: number;
  name: string;
  url: string;
  username?: string;
  password?: string;
}

export const ACQUISITION_RELS = new Set<string>([
  'http://opds-spec.org/acquisition',
  'http://opds-spec.org/acquisition/open-access',
  'http://opds-spec.org/acquisition/buy',
  'http://opds-spec.org/acquisition/borrow',
  'http://opds-spec.org/acquisition/sample',
  'http://opds-spec.org/acquisition/subscribe',
]);

export const SUPPORTED_MIME_TYPES = new Set<string>([
  'application/epub+zip',
  'text/fb2+xml',
  'application/fb2+zip',
  'application/x-fictionbook+xml',
  'application/fb2',
]);

export function mimeToExtension(mime: string): string {
  switch (mime) {
    case 'application/epub+zip':
      return '.epub';
    case 'text/fb2+xml':
    case 'application/x-fictionbook+xml':
    case 'application/fb2':
      return '.fb2';
    case 'application/fb2+zip':
      return '.fb2.zip';
    default:
      return '';
  }
}

export function pickAcquisitionLink(links: OpdsLink[]): OpdsLink | undefined {
  const supported = links.filter(
    (l) => ACQUISITION_RELS.has(l.rel) && l.type && SUPPORTED_MIME_TYPES.has(l.type),
  );
  if (supported.length === 0) return undefined;
  const full = supported.filter((l) => l.rel !== 'http://opds-spec.org/acquisition/sample');
  const pool = full.length > 0 ? full : supported;
  const epub = pool.find((l) => l.type === 'application/epub+zip');
  return epub ?? pool[0];
}