import type { Block, ParsedBook } from '../../formats/model.js';
import type { LibraryDb } from '../../db/db.js';
import { BookLayout, type TextLine } from '../../renderer/layout.js';
import { simplifyBlocks } from '../../renderer/simplify.js';
import { BookSearchIndex, type SearchMatch } from '../../search/index.js';
import type { TypographyConfig } from '../../config/defaults.js';

export interface ReaderOptions {
  typo: TypographyConfig;
  simplified: boolean;
  width: number;
  height: number;
  db: LibraryDb;
  bookId: number | null;
}

export interface SearchState {
  query: string;
  matches: number;
  current: number;
}

export class ReaderSession {
  readonly book: ParsedBook;
  search: BookSearchIndex;
  private _bookId: number | null;
  private readonly db: LibraryDb;

  get bookId(): number | null {
    return this._bookId;
  }
  private blocks: Block[];
  private layout: BookLayout;
  private simplified: boolean;
  private justify: boolean;
  private wide: boolean;
  private typo: TypographyConfig;
  private width: number;
  private height: number;
  private line = 0;
  private matches: SearchMatch[] = [];
  private currentMatch = -1;
  private query = '';

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
    this.blocks = opts.simplified ? simplifyBlocks(book.content) : book.content;
    this.search = new BookSearchIndex(this.blocks);
    this.layout = this.buildLayout();
  }

  private buildLayout(): BookLayout {
    return new BookLayout(this.blocks, {
      typo: this.typo,
      width: this.contentWidth(),
      // Highlights are computed lazily per block — the layout only requests
      // them for blocks it actually renders, so a book-wide scan is avoided.
      getHighlights: (blockIndex) =>
        this.query === '' ? undefined : this.search.blockHighlights(this.query, blockIndex),
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
    this.blocks = this.simplified ? simplifyBlocks(this.book.content) : this.book.content;
    this.search = new BookSearchIndex(this.blocks);
    this.layout = this.buildLayout();
    if (this.query !== '') {
      this.matches = this.search.search(this.query);
      this.currentMatch = -1;
    }
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
    this.line = this.clampLine(this.layout.lineForBlock(blockIndex));
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
    const normalized = query.trim();
    if (normalized === this.query) return;
    this.query = normalized;
    if (normalized === '') {
      this.matches = [];
      this.currentMatch = -1;
    } else {
      this.matches = this.search.search(normalized);
      this.currentMatch = -1;
    }
    // Highlights are pulled lazily via getHighlights on the next layout pass.
    this.layout.invalidate();
  }

  searchState(): SearchState {
    return {
      query: this.query,
      matches: this.matches.length,
      current: this.matches.length > 0 ? Math.max(0, this.currentMatch) : -1,
    };
  }

  nextMatch(): boolean {
    if (this.matches.length === 0) return false;
    this.currentMatch = (this.currentMatch + 1) % this.matches.length;
    this.jumpToMatch(this.matches[this.currentMatch]!);
    return true;
  }

  prevMatch(): boolean {
    if (this.matches.length === 0) return false;
    this.currentMatch = this.currentMatch <= 0 ? this.matches.length - 1 : this.currentMatch - 1;
    this.jumpToMatch(this.matches[this.currentMatch]!);
    return true;
  }

  private jumpToMatch(match: SearchMatch): void {
    this.goToCharOffset(match.start);
  }

  hasActiveQuery(): boolean {
    return this.query !== '';
  }

  // ---- bookmarks ----

  addBookmarkAtCurrent(label: string): number {
    if (this._bookId === null) {
      throw new Error('Cannot add bookmark: book is not in the library');
    }
    return this.db.addBookmark(this._bookId, this.charOffset(), label);
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
