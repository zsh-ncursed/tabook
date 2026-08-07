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
  const [mode, setMode] = useState<Mode>('reading');
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [editBookmarkId, setEditBookmarkId] = useState<number | null>(null);
  const [tocFilter, setTocFilter] = useState('');
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

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
          notify(`Match ${searchState.current + 1} of ${searchState.matches}`);
        } else {
          notify('No search results');
        }
        break;
      case 'search_prev':
        if (session.prevMatch()) {
          forceTick();
          notify(`Match ${searchState.current + 1} of ${searchState.matches}`);
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
        notify('Publisher CSS option saved to config; CSS engine lands in a later stage');
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

    // TextPrompt modes have their own useInput; skip to avoid double-dispatch.
    if (
      mode === 'search' ||
      mode === 'command' ||
      mode === 'bookmark' ||
      mode === 'bookmark-edit' ||
      mode === 'toc-filter'
    ) {
      return;
    }

    // Info modal: only Esc closes.
    if (mode === 'info') {
      if (keyName === 'escape') setMode('reading');
      return;
    }

    // TOC / bookmarks list modal: dispatch navigation keys here.
    if (mode === 'toc' || mode === 'bookmarks') {
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
          setMode('reading');
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
            if (mode === 'toc') {
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
          if (mode === 'bookmarks' && count > 0) {
            db.deleteBookmark(Number(items[listCursor]!.id));
            setBookmarks(loadBookmarks());
            notify('Bookmark deleted');
          }
          return;
        case 'e':
          if (mode === 'bookmarks' && count > 0) {
            setEditBookmarkId(Number(items[listCursor]!.id));
            setMode('bookmark-edit');
          }
          return;
        case '/':
          if (mode === 'toc') setMode('toc-filter');
          return;
        default:
          return;
      }
    }

    // Reading mode: dispatch via keymap resolver.
    const action = resolver.feed(keyName);
    handleAction(action);
  };

  const handleMainInput = useCallback(
    (input: string, key: Key) => dispatchRef.current(input, key),
    [],
  );
  useInput(handleMainInput, { isActive: !inputDisabled });

  const lines = session.viewportLines();

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
            setMode('reading');
          }}
          onCancel={() => {
            session.setQuery('');
            forceTick();
            setMode('reading');
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
            setMode('reading');
            runCommand(value);
          }}
          onCancel={() => setMode('reading')}
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
            setMode('reading');
          }}
          onCancel={() => setMode('reading')}
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
            setMode('bookmarks');
          }}
          onCancel={() => {
            setEditBookmarkId(null);
            setMode('bookmarks');
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
          onSubmit={() => setMode('toc')}
          onCancel={() => {
            setTocFilter('');
            setMode('toc');
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
  return (
    <Modal theme={theme} title="Book Info" width={72} footer="Esc — close">
      <Box flexDirection="column">
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
