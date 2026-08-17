import type { BookSearchIndex, SearchMatch } from '../../search/index.js';
import type { HighlightRange } from '../../renderer/layout.js';

export interface SearchState {
  query: string;
  matches: number;
  current: number;
}

// Search state machine for a ReaderSession: the query, the match list and
// the current-match cursor, kept in sync with the session's search index.
// The session owns the index lifecycle (it is rebuilt when the blocks/layout
// change) and the jump callback (which needs the layout); everything else
// about search — query normalization, match navigation, highlight lookup —
// lives here.
export class ReaderSearch {
  private query = '';
  private matches: SearchMatch[] = [];
  private currentMatch = -1;

  constructor(
    private index: BookSearchIndex,
    private readonly jump: (match: SearchMatch) => void,
  ) {}

  getQuery(): string {
    return this.query;
  }

  hasActiveQuery(): boolean {
    return this.query !== '';
  }

  state(): SearchState {
    return {
      query: this.query,
      matches: this.matches.length,
      current: this.matches.length > 0 ? Math.max(0, this.currentMatch) : -1,
    };
  }

  // Highlights for the layout's getHighlights callback. Returns undefined
  // when no query is active so the layout skips the highlight pass cheaply.
  blockHighlights(blockIndex: number): HighlightRange[] | undefined {
    if (this.query === '') return undefined;
    return this.index.blockHighlights(this.query, blockIndex);
  }

  // Replace the underlying index (blocks were rebuilt for simplified/justify
  // mode): re-run the active query against the fresh index.
  setIndex(index: BookSearchIndex): void {
    this.index = index;
    if (this.query !== '') {
      this.matches = this.index.search(this.query);
      this.currentMatch = -1;
    }
  }

  // Set the query. Returns true when the query actually changed; the caller
  // uses that to decide whether the layout needs re-invalidation.
  setQuery(query: string): boolean {
    const normalized = query.trim();
    if (normalized === this.query) return false;
    this.query = normalized;
    if (normalized === '') {
      this.matches = [];
      this.currentMatch = -1;
    } else {
      this.matches = this.index.search(normalized);
      this.currentMatch = -1;
    }
    return true;
  }

  next(): boolean {
    if (this.matches.length === 0) return false;
    this.currentMatch = (this.currentMatch + 1) % this.matches.length;
    this.jump(this.matches[this.currentMatch]!);
    return true;
  }

  prev(): boolean {
    if (this.matches.length === 0) return false;
    this.currentMatch = this.currentMatch <= 0 ? this.matches.length - 1 : this.currentMatch - 1;
    this.jump(this.matches[this.currentMatch]!);
    return true;
  }
}
