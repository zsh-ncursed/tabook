import type { Block, ParsedBook, TocEntry } from '../../formats/model.js';
import type { LibraryDb } from '../../db/db.js';
import { BookLayout, type TextLine } from '../../renderer/layout.js';
import { simplifyBlocksWithMap } from '../../renderer/simplify.js';
import { BookSearchIndex, type SearchMatch } from '../../search/index.js';
import type { TypographyConfig } from '../../config/defaults.js';
import { topLevelChapters, hasDirectChildHeadings, directChildHeadings } from './readerToc.js';
import { ReaderSearch, type SearchState } from './readerSearch.js';
import type { TocHeading } from './readerToc.js';

export interface ReaderOptions {
  typo: TypographyConfig;
  simplified: boolean;
  width: number;
  height: number;
  db: LibraryDb;
  bookId: number | null;
}

export class ReaderSession {
  readonly book: ParsedBook;
  private search: ReaderSearch;
  private _bookId: number | null;
  private readonly db: LibraryDb;

  get bookId(): number | null {
    return this._bookId;
  }
  private blocks: Block[];
  private layout: BookLayout;
  private simplified: boolean;
  // Original blockIndex (as used by TOC entries, which index book.content) →
  // index in the layout's block array. Null when not in simplified mode, where
  // the two arrays are identical.
  private simplifiedMap: number[] | null = null;
  private justify: boolean;
  private wide: boolean;
  private typo: TypographyConfig;
  private width: number;
  private height: number;
  private line = 0;
  private readonly tocHeadingCache = new Map<string, TocHeading[]>();
  private readonly tocHasHeadingCache = new Map<string, boolean>();

  constructor(book: ParsedBook, opts: ReaderOptions) {
    this.book = book;
    this.db = opts.db;
    this._bookId = opts.bookId;
    this.simplified = opts.simplified;
    this.justify = !!opts.typo.justify;
    this.wide = false;
    this.typo = opts.typo;
    this.width = opts.width;
    this.height = opts.height;
    if (opts.simplified) {
      const { blocks, map } = simplifyBlocksWithMap(book.content);
      this.blocks = blocks;
      this.simplifiedMap = map;
    } else {
      this.blocks = book.content;
    }
    this.search = new ReaderSearch(new BookSearchIndex(this.blocks), (match) =>
      this.jumpToMatch(match),
    );
    this.layout = this.buildLayout();
  }

  private buildLayout(): BookLayout {
    return new BookLayout(this.blocks, {
      typo: this.typo,
      width: this.contentWidth(),
      // getHighlights feeds the native layout's highlight map (via
      // setHighlights on construction/invalidate) and the TS fallback's
      // lazy per-block lookup. On the native path an active query costs one
      // book-wide pass per query change — the same order as the search
      // itself; when no query is active the callback short-circuits to
      // undefined and the pass is cheap.
      getHighlights: (blockIndex) => this.search.blockHighlights(blockIndex),
      justify: this.justify,
    });
  }

  contentWidth(): number {
    // Wide mode: ignore the typography.measure cap and use the full terminal
    // width minus the ReaderView padding (1 column per side = 2 total). This
    // lets justify fill the entire screen on wide monitors. On narrow
    // terminals wide still gives width-2 (never below 20).
    if (this.wide) return Math.max(20, this.width - 2);
    return Math.max(20, Math.min(this.typo.measure, Math.max(40, this.width - 4)));
  }

  pageHeight(): number {
    return Math.max(1, this.height - 3);
  }

  setViewport(width: number, height: number): void {
    const widthChanged = width !== this.width;
    if (!widthChanged && height === this.height) return;
    const offset = this.charOffset();
    this.width = width;
    this.height = height;
    if (widthChanged) {
      this.layout = this.buildLayout();
      this.line = this.layout.lineForCharOffset(offset);
    }
  }

  private rebuild(): void {
    const offset = this.charOffset();
    if (this.simplified) {
      const { blocks, map } = simplifyBlocksWithMap(this.book.content);
      this.blocks = blocks;
      this.simplifiedMap = map;
    } else {
      this.blocks = this.book.content;
      this.simplifiedMap = null;
    }
    this.search.setIndex(new BookSearchIndex(this.blocks));
    this.layout = this.buildLayout();
    this.line = this.layout.lineForCharOffset(offset);
  }

  setSimplified(value: boolean): void {
    if (value === this.simplified) return;
    this.simplified = value;
    this.rebuild();
  }

  get isSimplified(): boolean {
    return this.simplified;
  }

  setJustify(value: boolean): void {
    if (value === this.justify) return;
    this.justify = value;
    this.rebuild();
  }

  get isJustify(): boolean {
    return this.justify;
  }

  setWide(value: boolean): void {
    if (value === this.wide) return;
    this.wide = value;
    // Width cap changes → layout must be rebuilt, not just invalidated, so
    // setViewport is not enough (it skips rebuild when only height changes).
    const offset = this.charOffset();
    this.layout = this.buildLayout();
    this.line = this.layout.lineForCharOffset(offset);
  }

  get isWide(): boolean {
    return this.wide;
  }

  // ---- navigation ----

  private clampLine(target: number): number {
    if (target < 0) return 0;
    const max = this.layout.ensureLineCount(target + 1) - 1;
    return Math.min(target, Math.max(0, max));
  }

  scrollDown(lines = 1): void {
    this.line = this.clampLine(this.line + lines);
  }

  scrollUp(lines = 1): void {
    this.line = this.clampLine(this.line - lines);
  }

  pageDown(): void {
    this.scrollDown(this.pageHeight());
  }

  pageUp(): void {
    this.scrollUp(this.pageHeight());
  }

  goToStart(): void {
    this.line = 0;
  }

  goToEnd(): void {
    // Avoid lineCount() here — it forces laying out every block synchronously
    // and freezes the UI on large books. estimateLineCount() is a cheap upper
    // bound; over-shooting by a fraction of a page is invisible to the user
    // (the clamp on the next render corrects it). exactTotalLines is only set
    // when lineCount() is genuinely needed (e.g. goToPercent is called later).
    const total = this.layout.estimateLineCount();
    this.line = Math.max(0, total - this.pageHeight());
  }

  goToPage(pageNumber: number): void {
    this.line = this.clampLine(pageNumber * this.pageHeight());
  }

  goToPercent(pct: number): void {
    const clamped = Math.max(0, Math.min(100, pct));
    if (clamped >= 100) {
      this.goToEnd();
      return;
    }
    // Percent targets are exact via char offsets: lineForCharOffset only
    // lays out blocks up to the target, so no full-book lineCount() is
    // needed (estimateLineCount would drift on short-paragraph books).
    const target = Math.floor(((this.layout.totalChars - 1) * clamped) / 100);
    this.line = this.clampLine(this.layout.lineForCharOffset(target));
  }

  setLine(target: number): void {
    this.line = this.clampLine(target);
  }

  goToCharOffset(offset: number): void {
    this.line = this.clampLine(this.layout.lineForCharOffset(offset));
  }

  goToToc(blockIndex: number): void {
    // TOC entries carry blockIndex in original book.content coordinates. In
    // simplified mode the layout's block array differs (lists expand into
    // multiple paragraphs, images/empties drop), so remap before looking up
    // the line. Falls back to the raw index in normal mode or on out-of-range.
    this.line = this.clampLine(this.layout.lineForBlock(this.layoutBlockForToc(blockIndex)));
  }

  // ---- chapter navigation ----

  // Map an original book.content block index into layout coordinates. In
  // normal mode the two arrays are identical; in simplified mode the index
  // goes through the block map (see goToToc). Out-of-range or unmapped
  // indices fall back to the raw value.
  private layoutBlockForToc(blockIndex: number): number {
    if (this.simplifiedMap && blockIndex >= 0 && blockIndex < this.simplifiedMap.length) {
      return this.simplifiedMap[blockIndex]!;
    }
    return blockIndex;
  }

  private chapters(): TocEntry[] {
    return topLevelChapters(this.book.toc);
  }

  // Index (in layout coordinates) of the block the reader is currently on.
  private currentLayoutBlock(): number {
    const lines = this.layout.getRange(this.line, 1);
    return lines.length > 0 ? lines[0]!.blockIndex : 0;
  }

  // Jump to the start of the next chapter. Returns its label, or null when
  // the reader is already in the last chapter.
  nextChapter(): string | null {
    const chapters = this.chapters();
    if (chapters.length === 0) return null;
    const current = this.currentLayoutBlock();
    for (const ch of chapters) {
      if (this.layoutBlockForToc(ch.blockIndex) > current) {
        this.goToToc(ch.blockIndex);
        return ch.label;
      }
    }
    return null;
  }

  // Jump to the start of the current chapter when reading past it, otherwise
  // to the start of the previous chapter. Returns the label of the chapter
  // jumped to, or null when already at the first chapter.
  prevChapter(): string | null {
    const chapters = this.chapters();
    if (chapters.length === 0) return null;
    const current = this.currentLayoutBlock();
    // The chapter the reader is inside: the last chapter whose start block is
    // at or before the current block.
    let currentChapter: TocEntry | undefined;
    for (const ch of chapters) {
      if (this.layoutBlockForToc(ch.blockIndex) <= current) currentChapter = ch;
      else break;
    }
    if (!currentChapter) return null;
    const start = this.layoutBlockForToc(currentChapter.blockIndex);
    if (current > start) {
      // In the middle of a chapter: back to its own start.
      this.goToToc(currentChapter.blockIndex);
      return currentChapter.label;
    }
    // Already at the chapter start: go to the previous chapter.
    const idx = chapters.indexOf(currentChapter);
    const prev = chapters[idx - 1];
    if (!prev) return null;
    this.goToToc(prev.blockIndex);
    return prev.label;
  }

  // ---- TOC subheading listing ----

  chapterHasHeadings(chapterId: string): boolean {
    const cached = this.tocHasHeadingCache.get(chapterId);
    if (cached !== undefined) return cached;
    const has = hasDirectChildHeadings(this.book.toc, chapterId);
    this.tocHasHeadingCache.set(chapterId, has);
    return has;
  }

  chapterHeadings(chapterId: string): TocHeading[] {
    const cached = this.tocHeadingCache.get(chapterId);
    if (cached) return cached;
    const out = directChildHeadings(this.book.toc, chapterId);
    this.tocHeadingCache.set(chapterId, out);
    return out;
  }

  get currentLine(): number {
    return this.line;
  }

  get pageNumber(): number {
    return Math.floor(this.line / this.pageHeight());
  }

  totalPages(): number {
    const total = this.layout.estimateLineCount();
    return Math.max(1, Math.ceil(total / this.pageHeight()));
  }

  viewportLines(): TextLine[] {
    const start = this.line;
    const pageHeight = this.pageHeight();
    return this.layout.getRange(start, pageHeight);
  }

  charOffset(): number {
    return this.layout.charOffsetForLine(this.line);
  }

  percent(): number {
    if (this.layout.totalChars === 0) return 0;
    return Math.min(100, Math.round((this.charOffset() / this.layout.totalChars) * 100));
  }

  saveProgress(): void {
    if (this._bookId === null) return;
    this.db.setProgress(this._bookId, this.charOffset(), this.percent());
  }

  // ---- search ----

  setQuery(query: string): void {
    // Highlights are pulled lazily via getHighlights on the next layout pass;
    // invalidate only when the query actually changed.
    if (this.search.setQuery(query)) this.layout.invalidate();
  }

  searchState(): SearchState {
    return this.search.state();
  }

  nextMatch(): boolean {
    return this.search.next();
  }

  prevMatch(): boolean {
    return this.search.prev();
  }

  private jumpToMatch(match: SearchMatch): void {
    // match.start is block-local; goToCharOffset expects a book-wide offset.
    this.goToCharOffset(this.layout.blockCharStart(match.blockIndex) + match.start);
  }

  hasActiveQuery(): boolean {
    return this.search.hasActiveQuery();
  }

  // ---- bookmarks ----

  addBookmarkAtCurrent(label: string): number {
    return this.addBookmarkAt(this.charOffset(), label);
  }

  addBookmarkAt(offset: number, label: string): number {
    if (this._bookId === null) {
      throw new Error('Cannot add bookmark: book is not in the library');
    }
    return this.db.addBookmark(this._bookId, offset, label);
  }

  // ---- mouse selection ----

  // Book-wide character offset of the cell at (viewport line, rendered
  // column). The rendered column counts the leading indent/prefix spaces
  // that are not part of the book text, so the position maps onto the actual
  // content. Columns beyond the line clamp to the line's end.
  charOffsetAt(viewportLine: number, renderedCol: number): number {
    const lines = this.layout.getRange(this.line + viewportLine, 1);
    if (lines.length === 0) return this.layout.totalChars;
    const line = lines[0]!;
    const prefix = line.indent + line.prefix.length;
    return (
      this.layout.blockCharStart(line.blockIndex) +
      line.charOffset +
      Math.max(0, renderedCol - prefix)
    );
  }

  // The selected slice of a viewport line's rendered text, in RENDERED
  // coordinates (indent/prefix included). Empty lines or out-of-range lines
  // yield ''.
  selectionText(viewportLine: number, fromCol: number, toCol: number): string {
    const lines = this.layout.getRange(this.line + viewportLine, 1);
    if (lines.length === 0) return '';
    const line = lines[0]!;
    const prefix = line.indent + line.prefix.length;
    const text = line.spans.map((s) => s.text).join('');
    const a = Math.max(0, Math.min(text.length, fromCol - prefix));
    const b = Math.max(a, Math.min(text.length, toCol - prefix));
    return text.slice(a, b);
  }

  setBookId(id: number): void {
    this._bookId = id;
  }

  gotoBookmark(position: number): void {
    this.goToCharOffset(position);
  }

  textNear(position: number, length = 60): string {
    return this.layout.textNear(position, length);
  }
}
