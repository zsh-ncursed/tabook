import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import type { LibraryDb } from '../../db/db.js';
import type { ReaderSession } from './readerModel.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { ListModal } from '../components/ListModal.js';
import { Modal } from '../components/Modal.js';
import { renderLine } from '../renderLines.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { forceRedraw } from '../screenRefresh.js';
import { imageLayer, type ImagePlacement, IMAGE_ROWS, zoomGeometry } from '../imageLayer.js';
import { formatBytes, truncate, splitChars, formatLocalTimestamp } from '../../utils/text.js';
import { joinAuthors, formatSeries } from '../../formats/model.js';

export interface ReaderViewProps {
  session: ReaderSession;
  config: Config;
  theme: Theme;
  db: LibraryDb;
  notify: (message: string) => void;
  onClose: () => void;
  onSave: () => number | null;
  onOpenFile: () => void;
  onHelp: () => void;
  runCommand: (text: string) => void;
  completeCommand?: (value: string) => string | null;
  validCommandPrefix?: (value: string) => number;
  inputDisabled?: boolean;
}

type Mode =
  | 'reading'
  | 'search'
  | 'command'
  | 'bookmark'
  | 'bookmark-edit'
  | 'bookmarks'
  | 'toc'
  | 'toc-filter'
  | 'info'
  | 'zoom';

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

export function ReaderView(props: ReaderViewProps): React.JSX.Element {
  const {
    session,
    config,
    theme,
    db,
    notify,
    onClose,
    onSave,
    onOpenFile,
    onHelp,
    runCommand,
    completeCommand,
    validCommandPrefix,
    inputDisabled = false,
  } = props;
  const [width, height] = useTerminalSize();
  const [mode, setModeState] = useState<Mode>('reading');
  // Mirrors `mode` but is updated synchronously so a multi-keypress chunk
  // (e.g. "t\u001b") that opens a modal and then presses Esc in the same
  // synchronous tick sees the just-transitioned mode instead of the stale
  // render closure.
  const modeRef = useRef<Mode>('reading');
  const setMode = useCallback((m: Mode): void => {
    modeRef.current = m;
    setModeState(m);
  }, []);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [editBookmarkId, setEditBookmarkId] = useState<number | null>(null);
  const [tocFilter, setTocFilter] = useState('');
  // Which chapters (by toc id) currently have their subheading list expanded
  // in the TOC modal. Empty set = the default chapters-only view.
  const [tocExpanded, setTocExpanded] = useState<Set<string>>(new Set());
  const resolver = useMemo(() => createActionResolver(config), [config]);

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
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  // Ink's logUpdate suppresses a write when the closing frame is byte-identical
  // to the pre-modal one (in our reader the underlying page is unchanged, so the
  // modal stays on screen until the next keystroke). Pieces an explicit clear +
  // re-render so the closing frame always paints immediately.
  const closeModal = useCallback(
    (next: Mode) => {
      setMode(next);
      forceRedraw();
    },
    [setMode],
  );

  useEffect(() => {
    session.setViewport(width, height);
  }, [session, width, height]);

  const metadata = session.book.metadata;
  const searchState = session.searchState();

  const handleAction = (action: KeyAction | undefined): void => {
    switch (action) {
      case 'move_cursor_down':
      case 'scroll_down':
        session.scrollDown(1);
        forceTick();
        break;
      case 'move_cursor_up':
      case 'scroll_up':
        session.scrollUp(1);
        forceTick();
        break;
      case 'page_down':
        session.pageDown();
        forceTick();
        break;
      case 'page_up':
        session.pageUp();
        forceTick();
        break;
      case 'go_to_start':
        session.goToStart();
        forceTick();
        break;
      case 'go_to_end':
        session.goToEnd();
        forceTick();
        break;
      case 'search':
        setMode('search');
        break;
      case 'search_next':
        if (session.nextMatch()) {
          forceTick();
          const st = session.searchState();
          notify(`Match ${st.current + 1} of ${st.matches}`);
        } else {
          notify('No search results');
        }
        break;
      case 'search_prev':
        if (session.prevMatch()) {
          forceTick();
          const st = session.searchState();
          notify(`Match ${st.current + 1} of ${st.matches}`);
        } else {
          notify('No search results');
        }
        break;
      case 'next_chapter':
      case 'prev_chapter': {
        const label = action === 'next_chapter' ? session.nextChapter() : session.prevChapter();
        if (label !== null) {
          forceTick();
          notify(`Chapter: ${truncate(label, 40)}`);
        } else {
          notify(
            action === 'next_chapter'
              ? 'Already at the last chapter'
              : 'Already at the first chapter',
          );
        }
        break;
      }
      case 'add_bookmark':
        setMode('bookmark');
        break;
      case 'list_bookmarks':
        setBookmarks(loadBookmarks());
        setMode('bookmarks');
        break;
      case 'toc':
        setTocFilter('');
        setTocExpanded(new Set());
        setMode('toc');
        forceTick();
        break;
      case 'book_info':
        setMode('info');
        break;
      case 'zoom_image':
        if (session.viewportLines().some((l) => l.role === 'image')) {
          setMode('zoom');
        } else {
          notify('No image on this page');
        }
        break;
      case 'command':
        setMode('command');
        break;
      case 'save_to_library':
        onSave();
        break;
      case 'open_file':
        onOpenFile();
        break;
      case 'quit':
      case 'back':
        onClose();
        break;
      case 'help':
        onHelp();
        break;
      case 'toggle_simplified':
        session.setSimplified(!session.isSimplified);
        forceTick();
        notify(`Simplified mode: ${session.isSimplified ? 'on' : 'off'}`);
        break;
      case 'toggle_respect_css':
        notify('Publisher CSS is not implemented yet; no setting was changed');
        break;
      case 'toggle_justify':
        session.setJustify(!session.isJustify);
        forceTick();
        notify(`Text justify: ${session.isJustify ? 'on' : 'off'}`);
        break;
      case 'toggle_wide':
        session.setWide(!session.isWide);
        forceTick();
        notify(`Wide screen: ${session.isWide ? 'on' : 'off'}`);
        break;
      case 'move_cursor_left':
      case 'move_cursor_right':
        // ponytail: horizontal scroll not implemented; no-op to keep keymap valid
        break;
      default:
        break;
    }
  };

  const loadBookmarks = (): BookmarkRow[] => {
    return db.listBookmarks(session.bookId ?? 0).map((r) => ({
      id: r.id,
      position: r.position,
      label: r.label,
      preview: r.label ? session.textNear(r.position, 50) : session.textNear(r.position, 60),
    }));
  };

  // Single useInput, always active (when not disabled by a parent overlay like
  // Help). Modals (InfoModal, ListModal) do NOT have their own useInput — keys
  // are dispatched here by mode. This avoids Ink's setRawMode reference-count
  // race: when multiple useInput hooks toggle isActive, the internal
  // EventEmitter unsubscribes/resubscribes and loses keypresses (notably Esc
  // on the second open of a modal). With one always-on useInput, setRawMode
  // is called exactly once and handleReadable is never detached.
  const [listCursor, setListCursor] = useState(0);

  // Ref holds the latest state/callbacks so the useInput handler can stay
  // referentially stable (no re-subscribe race).
  const dispatchRef = useRef<(input: string, key: Key) => void>(() => {});
  dispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    const currentMode = modeRef.current;
    // TextPrompt modes have their own useInput; skip to avoid double-dispatch.
    if (
      currentMode === 'search' ||
      currentMode === 'command' ||
      currentMode === 'bookmark' ||
      currentMode === 'bookmark-edit' ||
      currentMode === 'toc-filter'
    ) {
      return;
    }

    // Info modal: back closes, help opens — via the configurable keymap.
    if (currentMode === 'info') {
      const action = resolver.feed(keyName);
      if (action === 'back') closeModal('reading');
      else if (action === 'help') onHelp();
      return;
    }

    // Zoomed image: back (or the zoom key again) returns to reading; the
    // overlay re-renders the normal page placements in the reading-mode
    // effect. The toggle works under any binding.
    if (currentMode === 'zoom') {
      const action = resolver.feed(keyName);
      if (action === 'back' || action === 'zoom_image') closeModal('reading');
      return;
    }

    // TOC / bookmarks list modal: dispatch navigation keys here.
    if (currentMode === 'toc' || currentMode === 'bookmarks') {
      // currentMode (modeRef, updated synchronously) rather than the render
      // closure `mode`: when several keys arrive in one stdin chunk (e.g. fast
      // "t "), the closure still holds the previous mode and would build the
      // wrong item list for the already-open modal.
      const items =
        currentMode === 'toc'
          ? tocItems
          : bookmarks.map((b) => ({
              id: b.id,
              label: b.label || b.preview || '(no label)',
              detail: b.label ? b.preview : undefined,
            }));
      const count = items.length;
      const jumpToItem = (item: { id: string | number; label: string }): void => {
        if (currentMode === 'toc') {
          // tocItems carries blockIndex for both chapters and their subheadings,
          // so the row under the cursor is used directly.
          const row = item as TocItem;
          session.goToToc(row.blockIndex);
          notify(`→ ${truncate(row.label, 40)}`);
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
      };
      const closeToc = (): void => {
        setListCursor(0);
        if (currentMode === 'toc') setTocFilter('');
        closeModal('reading');
      };
      // Modal verbs without a KeyAction (shown in the modal footer / Help):
      // d/x delete a bookmark, e edits its label. Everything else — cursor
      // moves, go_to_start/end, select, back, search, help — resolves through
      // the configurable keymap, so rebinds apply inside modals too.
      if (currentMode === 'bookmarks' && (keyName === 'd' || keyName === 'x') && count > 0) {
        db.deleteBookmark(Number(items[listCursor]!.id));
        setBookmarks(loadBookmarks());
        notify('Bookmark deleted');
        return;
      }
      if (currentMode === 'bookmarks' && keyName === 'e' && count > 0) {
        setEditBookmarkId(Number(items[listCursor]!.id));
        setMode('bookmark-edit');
        return;
      }
      const action = resolver.feed(keyName);
      switch (action) {
        case 'back':
          closeToc();
          return;
        case 'move_cursor_down':
          setListCursor((c) => Math.min(count - 1, c + 1));
          return;
        case 'move_cursor_up':
          setListCursor((c) => Math.max(0, c - 1));
          return;
        case 'go_to_start':
          setListCursor(0);
          return;
        case 'go_to_end':
          setListCursor(count - 1);
          return;
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
              return;
            }
          }
          if (count > 0) jumpToItem(items[listCursor]!);
          return;
        case 'select':
          if (count > 0) jumpToItem(items[listCursor]!);
          return;
        case 'search':
          if (currentMode === 'toc') setMode('toc-filter');
          return;
        case 'help':
          onHelp();
          return;
        case 'quit':
          // Vim-like: q closes the modal instead of quitting the app.
          closeToc();
          return;
        default:
          return;
      }
    }

    // Reading mode: dispatch via keymap resolver.
    const action = resolver.feed(keyName);
    handleAction(action);
  };

  // Dispatch a single raw input chunk. When fast keypresses arrive in one
  // stdin chunk (e.g. "t\u001b"), ink parses only the first char into `key`,
  // so the rest would be dropped. Iterate char-by-char and dispatch each.
  const emptyKey = (): Key => ({
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
  });
  const charKey = (ch: string): Key => {
    const k = emptyKey();
    k.escape = ch === '\u001b';
    k.return = ch === '\r' || ch === '\n';
    k.tab = ch === '\t';
    k.backspace = ch === '\u007f' || ch === '\b';
    return k;
  };

  const dispatchChunk = (input: string): void => {
    // Iterate code points, not UTF-16 code units: split('') would tear CJK /
    // emoji surrogate pairs into lone halves and dispatch garbage keys.
    for (const ch of splitChars(input)) {
      dispatchRef.current(ch, charKey(ch));
    }
  };

  const handleMainInput = useCallback((input: string, key: Key) => {
    if (input.length > 1 && !key.ctrl && !key.meta) {
      dispatchChunk(input);
      return;
    }
    dispatchRef.current(input, key);
  }, []);
  useInput(handleMainInput, { isActive: !inputDisabled });

  const lines = session.viewportLines();

  // ponytail: ueberzugpp draws book images over the viewport's image
  // placeholders. Reconciled on every page/scroll change. In info mode the
  // book cover is drawn instead, so the overlay doesn't bleed over a modal.
  useEffect(() => {
    if (mode === 'info') {
      if (!imageLayer.start()) return;
      const coverSrc = session.book.metadata.coverKey;
      if (coverSrc) {
        imageLayer.update(
          [{ identifier: 'cover', x: 2, y: 5, width: 16, height: 14, src: coverSrc }],
          session.book.resources,
        );
      } else {
        imageLayer.clear();
      }
      return;
    }
    if (mode === 'zoom') {
      // Enlarge the first image on the page: same src, a bigger centered box
      // (zoomGeometry), sent under its own identifier so closing the zoom
      // re-renders the normal placements. On tiny pages there may be no room
      // for a meaningful zoom; the on-page placeholder still renders.
      if (!imageLayer.start()) return;
      const pageH = session.pageHeight();
      const contentW = session.contentWidth();
      const imgIdx = lines.findIndex((l) => l.role === 'image');
      const imgLine = imgIdx >= 0 ? lines[imgIdx] : undefined;
      const block = imgLine ? session.book.content[imgLine.blockIndex] : undefined;
      if (!imgLine || !block || block.type !== 'image') {
        imageLayer.clear();
        return;
      }
      const baseW = Math.max(8, (contentW - imgLine.indent) | 0);
      const baseH = Math.min(IMAGE_ROWS, pageH - imgIdx);
      const g = zoomGeometry({
        baseWidth: baseW,
        baseHeight: baseH,
        contentWidth: contentW,
        pageHeight: pageH,
      });
      imageLayer.update(
        [{ identifier: 'zoom', x: g.x, y: g.y, width: g.width, height: g.height, src: block.src }],
        session.book.resources,
      );
      return;
    }
    if (mode !== 'reading') {
      imageLayer.clear();
      return;
    }
    if (!imageLayer.start()) return;
    const pageH = session.pageHeight();
    const placements: ImagePlacement[] = [];
    lines.forEach((line, i) => {
      if (line.role !== 'image') return;
      const block = session.book.content[line.blockIndex];
      if (!block || block.type !== 'image') return;
      const y = 1 + i; // row 0 = title, viewport starts at row 1
      const maxH = pageH - i;
      if (maxH < 2) return; // not enough room; keep the text placeholder
      placements.push({
        identifier: `img${line.blockIndex}`,
        x: 1 + line.indent,
        y,
        width: Math.max(8, (session.contentWidth() - line.indent) | 0),
        height: Math.min(IMAGE_ROWS, maxH),
        src: block.src,
      });
    });
    imageLayer.update(placements, session.book.resources);
  }, [lines, mode, session]);

  useEffect(() => () => imageLayer.stop(), []);

  const headerMeta = [
    metadata.authors ? joinAuthors(metadata.authors) : '',
    formatSeries(metadata.series) ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  const statusData = {
    title: truncate(metadata.title, 30),
    page: session.pageNumber + 1,
    totalPages: session.totalPages(),
    percent: session.percent(),
    search: searchState.query ? `search "${truncate(searchState.query, 20)}"` : undefined,
    hint: readerHint(mode),
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box paddingX={1}>
        <Text color={theme.colors.heading} bold>
          {truncate(metadata.title, Math.max(10, width - 20))}
        </Text>
        {headerMeta ? (
          <Text color={theme.colors.dim} dimColor>
            {'  '}
            {truncate(headerMeta, Math.max(10, width - 40))}
          </Text>
        ) : null}
      </Box>

      <Box flexDirection="column" paddingX={1} height={session.pageHeight()}>
        {lines.map((line, i) => (
          <Box key={i} height={1}>
            {renderLine(line, theme)}
          </Box>
        ))}
      </Box>

      {mode === 'search' ? (
        <TextPrompt
          theme={theme}
          prefix="/"
          placeholder="search in book…"
          initialValue={session.searchState().query}
          historyKey="search"
          onSubmit={(value) => {
            session.setQuery(value);
            const st = session.searchState();
            if (st.matches > 0) {
              session.nextMatch();
              forceTick();
              notify(`${st.matches} match${st.matches === 1 ? '' : 'es'} · n/N to navigate`);
            } else if (value.trim() !== '') {
              forceTick();
              notify('No matches found');
            }
            closeModal('reading');
          }}
          onCancel={() => {
            session.setQuery('');
            forceTick();
            closeModal('reading');
          }}
        />
      ) : null}

      {mode === 'command' ? (
        <TextPrompt
          theme={theme}
          prefix=":"
          placeholder="e.g. :goto 42, :simplified, :open book.fb2, :theme nord, :q"
          historyKey="command"
          onTab={completeCommand}
          validPrefixLength={validCommandPrefix}
          onSubmit={(value) => {
            closeModal('reading');
            runCommand(value);
          }}
          onCancel={() => closeModal('reading')}
        />
      ) : null}

      {mode === 'bookmark' ? (
        <TextPrompt
          theme={theme}
          prefix="b "
          placeholder="bookmark label (optional)…"
          onSubmit={(value) => {
            let bookId = session.bookId;
            if (bookId === null) {
              bookId = onSave();
            }
            if (bookId === null) {
              notify('Cannot save bookmark: book not in library');
            } else {
              session.addBookmarkAtCurrent(value);
              notify('Bookmark added');
            }
            closeModal('reading');
          }}
          onCancel={() => closeModal('reading')}
        />
      ) : null}

      {mode === 'bookmarks' ? (
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
      ) : null}

      {mode === 'bookmark-edit' ? (
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
      ) : null}

      {mode === 'toc' ? (
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
      ) : null}

      {mode === 'toc-filter' ? (
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
      ) : null}

      {mode === 'info' ? <InfoModal session={session} db={db} theme={theme} /> : null}

      <StatusBar theme={theme} statusbar={config.statusbar} data={statusData} />
    </Box>
  );
}

function InfoModal(props: {
  session: ReaderSession;
  db: LibraryDb;
  theme: Theme;
}): React.JSX.Element {
  const { session, db, theme } = props;
  const m = session.book.metadata;
  const stats = session.bookId !== null ? db.getStats(session.bookId) : undefined;
  const lines: string[] = [
    `Title: ${m.title}`,
    `Authors: ${joinAuthors(m.authors) || '—'}`,
    m.series ? `Series: ${formatSeries(m.series)}` : null,
    `Genres: ${m.genres.length > 0 ? m.genres.join(', ') : '—'}`,
    `Language: ${m.lang ?? '—'}`,
    m.publisher ? `Publisher: ${m.publisher}` : null,
    m.isbn ? `ISBN: ${m.isbn}` : null,
    m.year ? `Year: ${m.year}` : null,
    `Format: ${session.book.format.toUpperCase()} · Size: ${formatBytes(session.book.size)}`,
    `Progress: ${session.percent()}%`,
  ].filter((l): l is string => l !== null);
  if (stats) {
    lines.push(
      `Reading time: ${formatDuration(stats.totalSeconds)} · Pages read: ${stats.totalPages} · Sessions: ${stats.sessionCount}`,
    );
    if (stats.lastReadAt) lines.push(`Last read: ${formatLocalTimestamp(stats.lastReadAt)}`);
  }
  const hasCover = !!m.coverKey && session.book.resources.has(m.coverKey);
  return (
    <Modal theme={theme} title="Book Info" width={80} footer="Esc — close">
      <Box flexDirection="row">
        {hasCover ? <Box width={27} /> : null}
        <Box flexDirection="column" flexGrow={1} paddingRight={1}>
          {lines.map((line, i) => (
            <Text key={i} color={theme.colors.text}>
              {line}
            </Text>
          ))}
          {m.annotation ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={theme.colors.heading} bold>
                Annotation
              </Text>
              <Text color={theme.colors.dim} dimColor>
                {m.annotation}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Modal>
  );
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Context-aware hint for the StatusBar right side, reflecting the keys that
// are actionable in the current reader mode. Kept compact (key-only, no
// labels) so it fits on narrow terminals; the full mapping lives in Help (?).
function readerHint(mode: Mode): string {
  switch (mode) {
    case 'reading':
      return 'j/k · space · [ ] · / · b · t · i · z · J · W · ? · q';
    case 'zoom':
      return 'esc close';
    case 'search':
      return 'type · enter search · esc cancel';
    case 'command':
      return 'type · enter run · esc cancel';
    case 'bookmark':
    case 'bookmark-edit':
      return 'type · enter save · esc cancel';
    case 'bookmarks':
      return 'j/k · enter · e · d · ? help · esc';
    case 'toc':
      return 'j/k · space expand · enter jump · / · ? help · esc';
    case 'toc-filter':
      return 'type · enter · esc';
    case 'info':
      return '? help · esc close';
    default:
      return '';
  }
}
