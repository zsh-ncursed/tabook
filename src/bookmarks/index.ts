import type { LibraryDb } from '../db/db.js';
import type { BookLayout } from '../renderer/layout.js';

export interface BookmarkView {
  id: number;
  position: number;
  label: string;
  createdAt: string;
  preview: string;
}

export interface BookmarkDraft {
  bookId: number;
  position: number;
  label?: string;
}

export class BookmarksManager {
  private readonly db: LibraryDb;
  private readonly layout: BookLayout | null;

  constructor(db: LibraryDb, layout: BookLayout | null = null) {
    this.db = db;
    this.layout = layout;
  }

  add(draft: BookmarkDraft): number {
    return this.db.addBookmark(draft.bookId, draft.position, (draft.label ?? '').trim());
  }

  list(bookId: number): BookmarkView[] {
    return this.db.listBookmarks(bookId).map((record) => ({
      id: record.id,
      position: record.position,
      label: record.label,
      createdAt: record.createdAt,
      preview: this.previewFor(record.position),
    }));
  }

  get(id: number): BookmarkView | undefined {
    const record = this.db.getBookmark(id);
    if (!record) return undefined;
    return {
      id: record.id,
      position: record.position,
      label: record.label,
      createdAt: record.createdAt,
      preview: this.previewFor(record.position),
    };
  }

  remove(id: number): boolean {
    return this.db.deleteBookmark(id);
  }

  private previewFor(position: number): string {
    if (!this.layout) return '';
    return this.layout.textNear(position, 60);
  }
}
