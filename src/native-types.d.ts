/* tslint:disable */
/* eslint-disable */

/* Hand-written type declarations for @tabook/native. */

// model.rs
export interface Author {
  firstName: string;
  lastName: string;
  middleName?: string;
  nickname?: string;
}
export interface SeriesInfo {
  name: string;
  number?: number;
}
export interface BookMetadata {
  title: string;
  authors: Author[];
  series?: SeriesInfo;
  genres: string[];
  annotation: string;
  lang?: string;
  coverKey?: string;
  publisher?: string;
  isbn?: string;
  year?: number;
}
export interface TocEntry {
  id: string;
  label: string;
  level: number;
  blockIndex: number;
}
export interface Inline {
  kind: string;
  text?: string;
  children?: Inline[];
  href?: string;
  src?: string;
  alt?: string;
}
export interface ListItem {
  children: Inline[];
  nested: Block[];
}
export interface Stanza {
  lines: Inline[][];
}
export interface Block {
  type: string;
  children?: Inline[];
  level?: number;
  ordered?: boolean;
  items?: ListItem[];
  headers?: Inline[][];
  rows?: Inline[][][];
  stanzas?: Stanza[];
  src?: string;
  alt?: string;
  title?: string;
}
export interface ResourceEntry {
  key: string;
  data: Uint8Array;
}
export interface ParsedBook {
  format: string;
  path: string;
  filename: string;
  size: number;
  metadata: BookMetadata;
  toc: TocEntry[];
  content: Block[];
  resources: ResourceEntry[];
}

// text.rs
export declare function displayWidth(input: string): number;
export declare function decodeEntities(input: string): string;
export declare function normalizeWhitespace(input: string): string;
export declare function stripHtml(html: string): string;
export declare function truncate(input: string, maxLength: number, suffix?: string): string;
export declare function truncateW(text: string, max: number): string;
export declare function splitChars(input: string): string[];

// encoding.rs
export declare function detectEncoding(data: Buffer | Uint8Array): string;
export declare function normalizeEncoding(enc: string): string;
export declare function decodeXmlBuffer(data: Buffer | Uint8Array): string;
export declare function fileExtension(name: string): string;
export declare function isZipBuffer(data: Buffer | Uint8Array): boolean;

// zip.rs
export interface ZipEntryInfo {
  name: string;
  size: number;
}
export declare class ZipArchiveHandle {
  readonly entries: ZipEntryInfo[];
  read(name: string): Buffer;
}
export declare function openZip(data: Buffer | Uint8Array): ZipArchiveHandle;

// xml.rs
export declare function parseXml(text: string): void;

// formats_index.rs
export declare function detectFormat(data: Buffer | Uint8Array, name: string): string;
export declare function parseBookFile(filePath: string): ParsedBook;
export declare function invalidateBookCache(): void;

// fb2/parser.rs
export declare function parseFb2Buffer(data: Buffer | Uint8Array, filePath: string): ParsedBook;
export declare function parseFb2Metadata(data: Buffer | Uint8Array, filePath: string): BookMetadata;

// epub/parser.rs
export declare function parseEpubBuffer(data: Buffer | Uint8Array, filePath: string): ParsedBook;
export declare function parseEpubMetadata(
  data: Buffer | Uint8Array,
  filePath: string,
): BookMetadata;

// search.rs
export interface SearchMatch {
  blockIndex: number;
  start: number;
  end: number;
}
export interface HighlightRange {
  start: number;
  end: number;
}
export interface BlockHighlights {
  blockIndex: number;
  ranges: HighlightRange[];
}
export declare class BookSearchIndex {
  constructor(blocks: Block[]);
  readonly blockCount: number;
  search(query: string): SearchMatch[];
  blockHighlights(query: string, blockIndex: number): HighlightRange[];
  highlightRanges(query: string): BlockHighlights[];
}
export declare function buildSearchIndex(blocks: Block[]): BookSearchIndex;

// renderer/layout.rs
export interface StyledSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  link: boolean;
  highlight: boolean;
}
export interface TextLine {
  role: string;
  spans: StyledSpan[];
  indent: number;
  prefix: string;
  blockIndex: number;
  charOffset: number;
}
export interface TypographyConfigNapi {
  measure: number;
  lineSpacing: number;
  paragraphIndent: number;
  paragraphSpacing: number;
  hyphenation: boolean;
  justify: boolean;
}
export declare class BookLayout {
  constructor(blocks: Block[], typo: TypographyConfigNapi, width: number, justify: boolean);
  readonly blockCount: number;
  readonly totalChars: number;
  ensureBlocksUpTo(blockIndex: number): void;
  ensureLineCount(count: number): number;
  lineCount(): number;
  getPage(page: number, pageHeight: number): TextLine[];
  getRange(start: number, count: number): TextLine[];
  pageForCharOffset(charOffset: number, pageHeight: number): number;
  textNear(charOffset: number, length?: number): string;
  estimateLineCount(): number;
  blockStartLine(blockIndex: number): number | null;
  lineForBlock(blockIndex: number): number;
  blockCharStart(blockIndex: number): number;
  lineForCharOffset(charOffset: number): number;
  charOffsetForLine(line: number): number;
  invalidate(): void;
  setHighlights(highlights: BlockHighlights[]): void;
}

// db.rs
export interface BookRecord {
  id: number;
  path: string;
  filename: string;
  format: string;
  size: number;
  title: string;
  authors: Author[];
  series?: SeriesInfo;
  genres: string[];
  annotation: string;
  lang?: string;
  coverKey?: string;
  publisher?: string;
  isbn?: string;
  year?: number;
  addedAt: string;
  lastOpenedAt?: string;
  progressPercent?: number;
  progressPosition?: number;
}
export interface BookmarkRecord {
  id: number;
  bookId: number;
  position: number;
  label: string;
  createdAt: string;
}
export interface ProgressRecord {
  bookId: number;
  position: number;
  percent: number;
  updatedAt: string;
}
export interface HistoryRecord {
  bookId: number;
  title: string;
  openedAt: string;
}
export interface SessionStats {
  totalSeconds: number;
  totalPages: number;
  sessionCount: number;
  lastReadAt?: string;
}
export interface CatalogRecord {
  id: number;
  name: string;
  url: string;
  username?: string;
  password?: string;
}
export interface LibraryFolderRecord {
  id: number;
  path: string;
  addedAt: string;
  lastScannedAt?: number;
}
export declare function openLibraryDb(filePath: string): LibraryDb | NativeErrorValue;
export declare class LibraryDb {
  readonly filePath: string;
  close(): void;
  fileExists(): boolean;
  // napi-rs Option params accept both undefined and null as "no value".
  addBook(
    path: string,
    filename: string,
    format: string,
    size: number,
    metadata: BookMetadata,
    libraryRoot?: string | null,
  ): number;
  getBook(id: number): BookRecord | null;
  getBookByPath(path: string): BookRecord | null;
  listBooks(limit?: number | null, offset?: number, orderBy?: string): BookRecord[];
  removeBook(id: number): boolean;
  setProgress(bookId: number, position: number, percent: number): void;
  getProgress(bookId: number): ProgressRecord | null;
  addBookmark(bookId: number, position: number, label: string): number;
  listBookmarks(bookId: number): BookmarkRecord[];
  getBookmark(id: number): BookmarkRecord | null;
  deleteBookmark(id: number): boolean;
  updateBookmarkLabel(id: number, label: string): boolean;
  recordOpen(bookId: number): void;
  listHistory(limit: number): HistoryRecord[];
  listRecentBooks(limit: number): BookRecord[];
  listContinueBooks(limit: number): BookRecord[];
  startSession(bookId: number): number;
  endSession(sessionId: number, pagesRead: number): void;
  getStats(bookId: number): SessionStats;
  addCatalog(name: string, url: string, username?: string | null, password?: string | null): number;
  listCatalogs(): CatalogRecord[];
  getCatalog(id: number): CatalogRecord | null;
  getCatalogByName(name: string): CatalogRecord | null;
  updateCatalog(
    id: number,
    name?: string | null,
    url?: string | null,
    username?: string | null,
    password?: string | null,
  ): void;
  removeCatalog(id: number): void;
  addLibraryFolder(path: string): number;
  listLibraryFolders(): LibraryFolderRecord[];
  getLibraryFolderByPath(path: string): LibraryFolderRecord | null;
  setFolderScannedAt(id: number, scannedAtMs: number): void;
  removeLibraryFolder(id: number): boolean;
  listPathsByLibraryRoot(root: string): string[];
  removeBooksByPaths(paths: string[]): number;
  removeBooksByLibraryRoot(root: string): number;
}

// scan.rs
export interface ScanSummaryNapi {
  total: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  errors: string[];
}
export declare function walkBookFiles(root: string): string[];
export declare function scanLibraryFolder(db: LibraryDb, root: string): ScanSummaryNapi;
export declare function folderNeedsRescan(db: LibraryDb, folder: LibraryFolderRecord): boolean;
export declare function resolveFolderPath(p: string): string;

// napi-rs returns Err from Result-returning fns as a plain value
// ({ code, message }) rather than throwing.
export interface NativeErrorValue {
  code: string;
  message?: string;
}

// image.rs
export interface ImageToPng {
  data: Buffer;
  width: number;
  height: number;
}
export declare function imageToPng(data: Buffer | Uint8Array): ImageToPng;

// opds_parser.rs
export interface OpdsLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
  length?: number;
  facetGroup?: string;
  activeFacet: boolean;
  count?: number;
}
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
  kind: string;
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
export declare function parseOpdsAtom(text: string): OpdsFeed;

// misc
export declare function hello(): string;
