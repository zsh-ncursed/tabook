import type { Block, ParsedBook } from '../../formats/model.js';
import type { LibraryDb } from '../../db/db.js';
import { BookLayout, type HighlightRange, type TextLine } from '../../renderer/layout.js';
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
  readonly search: BookSearchIndex;
  readonly bookId: number | null;
  private readonly db: LibraryDb;
  private blocks: Block[];
  private layout: BookLayout;
  private simplified: boolean;
  private typo: TypographyConfig;
  private width: number;
  private height: number;
  private line = 0;
  private highlights = new Map<number, HighlightRange[]>();
  private matches: SearchMatch[] = [];
  private currentMatch = -1;
  private query = '';
  private exactTotalLines: number | null = null;

  constructor(book: ParsedBook, opts: ReaderOptions) {
    this.book = book;
    this.db = opts.db;
    this.bookId = opts.bookId;
    this.simplified = opts.simplified;
    this.typo = opts.typo;
    this.width = opts.width;
    this.height = opts.height;
    this.blocks = opts.simplified ? simplifyBlocks(book.content) : book.content;
    this.layout = this.buildLayout();
    this.search = new BookSearchIndex(this.blocks);
    this.scheduleTotalLines();
  }

  private buildLayout(): BookLayout {
    return new BookLayout(this.blocks, {
      typo: this.typo,
      width: this.contentWidth(),
      getHighlights: (blockIndex) => this.highlights.get(blockIndex),
    });
  }

  private scheduleTotalLines(): void {
    setTimeout(() => {
      this.exactTotalLines = this.layout.lineCount();
    }, 50);
  }

  contentWidth(): number {
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
    this.layout = this.buildLayout();
    this.line = this.layout.lineForCharOffset(offset);
    this.exactTotalLines = null;
    this.scheduleTotalLines();
  }

  setSimplified(value: boolean): void {
    if (value === this.simplified) return;
    this.simplified = value;
    this.rebuild();
  }

  get isSimplified(): boolean {
    return this.simplified;
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
    this.exactTotalLines = this.layout.lineCount();
    this.line = Math.max(0, this.exactTotalLines - this.pageHeight());
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
    const total = this.exactTotalLines ?? this.layout.estimateLineCount();
    this.line = this.clampLine(Math.floor((total - 1) * (clamped / 100)));
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
    const total = this.exactTotalLines ?? this.layout.estimateLineCount();
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
    if (this.bookId === null) return;
    this.db.setProgress(this.bookId, this.charOffset(), this.percent());
  }

  // ---- search ----

  setQuery(query: string): void {
    const normalized = query.trim();
    if (normalized === this.query) return;
    this.query = normalized;
    if (normalized === '') {
      this.matches = [];
      this.highlights = new Map();
      this.currentMatch = -1;
    } else {
      this.matches = this.search.search(normalized);
      this.highlights = this.search.highlightRanges(normalized);
      this.currentMatch = -1;
    }
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
    return this.db.addBookmark(this.bookId ?? 0, this.charOffset(), label);
  }

  setBookId(id: number): void {
    (this as { bookId: number | null }).bookId = id;
  }

  gotoBookmark(position: number): void {
    this.goToCharOffset(position);
  }

  textNear(position: number, length = 60): string {
    return this.layout.textNear(position, length);
  }
}
