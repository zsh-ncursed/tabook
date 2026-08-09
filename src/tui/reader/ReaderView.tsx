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
import { imageLayer, type ImagePlacement, IMAGE_ROWS } from '../imageLayer.js';
import { formatBytes, truncate } from '../../utils/text.js';
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
  | 'info';

interface BookmarkRow {
  id: number;
  position: number;
  label: string;
  preview: string;
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
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  // Ink's logUpdate suppresses a write when the closing frame is byte-identical
  // to the pre-modal one (in our reader the underlying page is unchanged, so the
  // modal stays on screen until the next keystroke). Pieces an explicit clear +
  // re-render so the closing frame always paints immediately.
  const closeModal = useCallback((next: Mode) => {
    setMode(next);
    forceRedraw();
  }, [setMode]);

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
      case 'add_bookmark':
        setMode('bookmark');
        break;
      case 'list_bookmarks':
        setBookmarks(loadBookmarks());
        setMode('bookmarks');
        break;
      case 'toc':
        setTocFilter('');
        setMode('toc');
        forceTick();
        break;
      case 'book_info':
        setMode('info');
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

    // Info modal: only Esc closes.
    if (currentMode === 'info') {
      if (keyName === 'escape') closeModal('reading');
      return;
    }

    // TOC / bookmarks list modal: dispatch navigation keys here.
    if (currentMode === 'toc' || currentMode === 'bookmarks') {
      const items =
        mode === 'toc'
          ? session.book.toc
              .filter(
                (entry) =>
                  tocFilter === '' || entry.label.toLowerCase().includes(tocFilter.toLowerCase()),
              )
              .map((entry) => ({
                id: entry.id,
                label: entry.label,
                detail: entry.level > 1 ? '·'.repeat(entry.level - 1) : undefined,
              }))
          : bookmarks.map((b) => ({
              id: b.id,
              label: b.label || b.preview || '(no label)',
              detail: b.label ? b.preview : undefined,
            }));
      const count = items.length;
      switch (keyName) {
        case 'escape':
          setListCursor(0);
          if (mode === 'toc') setTocFilter('');
          closeModal('reading');
          return;
        case 'j':
        case 'down':
          setListCursor((c) => Math.min(count - 1, c + 1));
          return;
        case 'k':
        case 'up':
          setListCursor((c) => Math.max(0, c - 1));
          return;
        case 'gg':
          setListCursor(0);
          return;
        case 'G':
          setListCursor(count - 1);
          return;
        case 'enter':
        case 'space':
          if (count > 0) {
            const item = items[listCursor]!;
            if (currentMode === 'toc') {
              const entry = session.book.toc.find((e) => e.id === item.id);
              if (entry) {
                session.goToToc(entry.blockIndex);
                notify(`→ ${truncate(entry.label, 40)}`);
              }
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
          }
          return;
        case 'd':
        case 'x':
          if (currentMode === 'bookmarks' && count > 0) {
            db.deleteBookmark(Number(items[listCursor]!.id));
            setBookmarks(loadBookmarks());
            notify('Bookmark deleted');
          }
          return;
        case 'e':
          if (currentMode === 'bookmarks' && count > 0) {
            setEditBookmarkId(Number(items[listCursor]!.id));
            setMode('bookmark-edit');
          }
          return;
        case '/':
          if (currentMode === 'toc') setMode('toc-filter');
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
    for (const ch of input.split('')) {
      dispatchRef.current(ch, charKey(ch));
    }
  };

  const handleMainInput = useCallback(
    (input: string, key: Key) => {
      if (input.length > 1 && !key.ctrl && !key.meta) {
        dispatchChunk(input);
        return;
      }
      dispatchRef.current(input, key);
    },
    [],
  );
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

  const statusLeft = truncate(metadata.title, 30);
  const statusRight = [
    config.display.showProgressBar ? '' : `${session.percent()}%`,
    `p.${session.pageNumber + 1}/${session.totalPages()}`,
    searchState.query ? `search "${truncate(searchState.query, 20)}"` : '',
    readerHint(mode),
  ]
    .filter(Boolean)
    .join(' · ');

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
          items={session.book.toc
            .filter(
              (entry) =>
                tocFilter === '' || entry.label.toLowerCase().includes(tocFilter.toLowerCase()),
            )
            .map((entry) => ({
              id: entry.id,
              label: entry.label,
              detail: entry.level > 1 ? '·'.repeat(entry.level - 1) : undefined,
            }))}
          cursor={listCursor}
          height={Math.min(12, height - 8)}
          footer="j/k move · enter jump · / filter · esc close"
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

      <StatusBar
        theme={theme}
        left={statusLeft}
        right={statusRight}
        progress={config.display.showProgressBar ? session.percent() : undefined}
      />
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
    if (stats.lastReadAt) lines.push(`Last read: ${stats.lastReadAt}`);
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
      return 'j/k · space · / · b · t · i · J · W · ? · q';
    case 'search':
      return 'type · enter search · esc cancel';
    case 'command':
      return 'type · enter run · esc cancel';
    case 'bookmark':
    case 'bookmark-edit':
      return 'type · enter save · esc cancel';
    case 'bookmarks':
      return 'j/k · enter · e · d · esc';
    case 'toc':
      return 'j/k · enter · / · esc';
    case 'toc-filter':
      return 'type · enter · esc';
    case 'info':
      return 'esc close';
    default:
      return '';
  }
}
