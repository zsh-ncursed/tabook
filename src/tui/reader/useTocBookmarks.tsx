import React, { useCallback, useMemo, useReducer, useState } from 'react';
import type { Theme } from '../../themes/themes.js';
import type { LibraryDb } from '../../db/db.js';
import type { ReaderSession } from './readerModel.js';
import type { ActionResolver } from '../keymap.js';
import { ListModal } from '../components/ListModal.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { truncateW } from '../../utils/text.js';
import type { Mode } from './modes.js';

interface BookmarkRow {
  id: number;
  position: number;
  label: string;
  preview: string;
}

interface TocItem {
  id: string;
  label: string;
  blockIndex: number;
  indent: number;
  underline: boolean;
}

// TOC / bookmarks modal: owns the list cursor, TOC filter/expansion state,
// the bookmark list and bookmark-label editing, plus the key dispatch and
// render for the four modes it covers (toc, toc-filter, bookmarks,
// bookmark-edit). Keys are still dispatched by the reader's single always-on
// useInput (see ReaderView) — this hook only receives them via handleKey.
export function useTocBookmarks(params: {
  session: ReaderSession;
  db: LibraryDb;
  notify: (message: string) => void;
  onHelp: () => void;
  resolver: ActionResolver;
  setMode: (m: Mode) => void;
  closeModal: (m: Mode) => void;
}): {
  openBookmarks: () => void;
  openToc: () => void;
  handleKey: (currentMode: 'toc' | 'bookmarks', keyName: string) => boolean;
  render: (mode: Mode, theme: Theme, height: number) => React.JSX.Element | null;
} {
  const { session, db, notify, onHelp, resolver, setMode, closeModal } = params;
  const [listCursor, setListCursor] = useState(0);
  const [tocFilter, setTocFilter] = useState('');
  // Which chapters (by toc id) currently have their subheading list expanded
  // in the TOC modal. Empty set = the default chapters-only view.
  const [tocExpanded, setTocExpanded] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [editBookmarkId, setEditBookmarkId] = useState<number | null>(null);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  const loadBookmarks = useCallback((): BookmarkRow[] => {
    return db.listBookmarks(session.bookId ?? 0).map((r) => ({
      id: r.id,
      position: r.position,
      label: r.label,
      preview: r.label ? session.textNear(r.position, 50) : session.textNear(r.position, 60),
    }));
  }, [db, session]);

  // TOC modal rows. Default view: top-level entries (chapters) only, each
  // underlined when it contains at least one direct subheading; space expands
  // a chapter to list its subheadings below it. While a filter is active the
  // whole TOC (any level) is searched as a flat list — expansion is ignored.
  const tocItems = useMemo<TocItem[]>(() => {
    const toc = session.book.toc;
    if (toc.length === 0) return [];
    let minLevel = Infinity;
    for (const e of toc) if (e.level < minLevel) minLevel = e.level;
    const q = tocFilter.trim().toLowerCase();
    const out: TocItem[] = [];
    if (q !== '') {
      for (const e of toc) {
        if (!e.label.toLowerCase().includes(q)) continue;
        out.push({
          id: e.id,
          label: e.label,
          blockIndex: e.blockIndex,
          indent: Math.max(0, e.level - minLevel),
          underline: false,
        });
      }
      return out;
    }
    for (const ch of toc) {
      if (ch.level !== minLevel) continue;
      const hasHeadings = session.chapterHasHeadings(ch.id);
      out.push({
        id: ch.id,
        label: ch.label,
        blockIndex: ch.blockIndex,
        indent: 0,
        underline: hasHeadings,
      });
      if (tocExpanded.has(ch.id)) {
        for (const h of session.chapterHeadings(ch.id)) {
          out.push({
            id: `${ch.id}:h${h.blockIndex}`,
            label: h.label,
            blockIndex: h.blockIndex,
            indent: 1,
            underline: false,
          });
        }
      }
    }
    return out;
  }, [session, tocFilter, tocExpanded]);

  const openBookmarks = useCallback((): void => {
    setBookmarks(loadBookmarks());
    setMode('bookmarks');
  }, [loadBookmarks, setMode]);

  const openToc = useCallback((): void => {
    setTocFilter('');
    setTocExpanded(new Set());
    setMode('toc');
    forceTick();
  }, [setMode]);

  const jumpToItem = useCallback(
    (currentMode: 'toc' | 'bookmarks', item: { id: string | number; label: string }): void => {
      if (currentMode === 'toc') {
        // tocItems carries blockIndex for both chapters and their subheadings,
        // so the row under the cursor is used directly.
        const row = item as TocItem;
        session.goToToc(row.blockIndex);
        notify(`→ ${truncateW(row.label, 40)}`);
        setTocFilter('');
      } else {
        const bm = bookmarks.find((b) => b.id === item.id);
        if (bm) {
          session.gotoBookmark(bm.position);
          notify(`Jumped to bookmark${bm.label ? ` "${bm.label}"` : ''}`);
        }
      }
      setListCursor(0);
      setMode('reading');
    },
    [bookmarks, session, notify, setMode],
  );

  const closeToc = useCallback(
    (currentMode: 'toc' | 'bookmarks'): void => {
      setListCursor(0);
      if (currentMode === 'toc') setTocFilter('');
      closeModal('reading');
    },
    [closeModal],
  );

  // Returns true when the key was consumed by the modal (always — the modal
  // swallows every key it receives).
  const handleKey = useCallback(
    (currentMode: 'toc' | 'bookmarks', keyName: string): boolean => {
      const items =
        currentMode === 'toc'
          ? tocItems
          : bookmarks.map((b) => ({
              id: b.id,
              label: b.label || b.preview || '(no label)',
              detail: b.label ? b.preview : undefined,
            }));
      const count = items.length;
      // Modal verbs without a KeyAction (shown in the modal footer / Help):
      // d/x delete a bookmark, e edits its label. Everything else — cursor
      // moves, go_to_start/end, select, back, search, help — resolves through
      // the configurable keymap, so rebinds apply inside modals too.
      if (currentMode === 'bookmarks' && (keyName === 'd' || keyName === 'x') && count > 0) {
        db.deleteBookmark(Number(items[listCursor]!.id));
        setBookmarks(loadBookmarks());
        notify('Bookmark deleted');
        return true;
      }
      if (currentMode === 'bookmarks' && keyName === 'e' && count > 0) {
        setEditBookmarkId(Number(items[listCursor]!.id));
        setMode('bookmark-edit');
        return true;
      }
      const action = resolver.feed(keyName);
      switch (action) {
        case 'back':
          closeToc(currentMode);
          return true;
        case 'move_cursor_down':
          setListCursor((c) => Math.min(count - 1, c + 1));
          return true;
        case 'move_cursor_up':
          setListCursor((c) => Math.max(0, c - 1));
          return true;
        case 'go_to_start':
          setListCursor(0);
          return true;
        case 'go_to_end':
          setListCursor(count - 1);
          return true;
        case 'page_down':
          // space (the default page_down binding) on a chapter that contains
          // subheadings expands/collapses its subheading list; on any other
          // row (or in the bookmarks modal) it falls through to the jump.
          if (currentMode === 'toc' && count > 0) {
            const item = tocItems[listCursor];
            if (item && item.indent === 0 && item.underline) {
              setTocExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
              return true;
            }
          }
          if (count > 0) jumpToItem(currentMode, items[listCursor]!);
          return true;
        case 'select':
          if (count > 0) jumpToItem(currentMode, items[listCursor]!);
          return true;
        case 'search':
          if (currentMode === 'toc') setMode('toc-filter');
          return true;
        case 'help':
          onHelp();
          return true;
        case 'quit':
          // Vim-like: q closes the modal instead of quitting the app.
          closeToc(currentMode);
          return true;
        default:
          return true;
      }
    },
    [
      tocItems,
      bookmarks,
      listCursor,
      resolver,
      db,
      loadBookmarks,
      notify,
      onHelp,
      setMode,
      closeToc,
      jumpToItem,
    ],
  );

  const render = useCallback(
    (mode: Mode, theme: Theme, height: number): React.JSX.Element | null => {
      if (mode === 'bookmarks') {
        return (
          <ListModal
            theme={theme}
            title={`Bookmarks (${bookmarks.length})`}
            items={bookmarks.map((b) => ({
              id: b.id,
              label: b.label || b.preview || '(no label)',
              detail: b.label ? b.preview : undefined,
            }))}
            cursor={listCursor}
            height={Math.min(10, height - 8)}
            footer="j/k move · enter jump · e edit · d delete · esc close"
          />
        );
      }
      if (mode === 'bookmark-edit') {
        return (
          <TextPrompt
            theme={theme}
            prefix="e "
            placeholder="bookmark label…"
            initialValue={bookmarks.find((b) => b.id === editBookmarkId)?.label ?? ''}
            onSubmit={(value) => {
              if (editBookmarkId !== null) {
                db.updateBookmarkLabel(editBookmarkId, value);
                setBookmarks(loadBookmarks());
                notify('Bookmark updated');
              }
              setEditBookmarkId(null);
              closeModal('bookmarks');
            }}
            onCancel={() => {
              setEditBookmarkId(null);
              closeModal('bookmarks');
            }}
          />
        );
      }
      if (mode === 'toc') {
        return (
          <ListModal
            theme={theme}
            title="Table of Contents"
            items={tocItems.map((item) => ({
              id: item.id,
              label: item.label,
              underline: item.underline,
              indent: item.indent,
            }))}
            cursor={listCursor}
            height={Math.min(12, height - 8)}
            footer="j/k move · space expand/collapse · enter jump · / filter · esc close"
          />
        );
      }
      if (mode === 'toc-filter') {
        return (
          <TextPrompt
            theme={theme}
            prefix="/"
            placeholder="filter TOC entries…"
            initialValue={tocFilter}
            historyKey="toc-filter"
            onValueChange={(v) => setTocFilter(v)}
            onSubmit={() => closeModal('toc')}
            onCancel={() => {
              setTocFilter('');
              closeModal('toc');
            }}
          />
        );
      }
      return null;
    },
    [
      bookmarks,
      listCursor,
      tocItems,
      tocFilter,
      editBookmarkId,
      db,
      loadBookmarks,
      notify,
      closeModal,
    ],
  );

  return { openBookmarks, openToc, handleKey, render };
}
