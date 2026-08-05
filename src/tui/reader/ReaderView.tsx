import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { Box, Text, useInput } from 'ink';
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

  useInput(
    (input, key) => {
      if (mode !== 'reading') return;
      const keyName = resolveKeyName(input, key);
      if (keyName === null) return;
      const action = resolver.feed(keyName);
      handleAction(action);
    },
    { isActive: mode === 'reading' && !inputDisabled },
  );

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
    'j/k · space · n/N · ?',
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
          height={Math.min(10, height - 8)}
          footer="j/k move · enter jump · e edit · d delete · q close"
          onSelect={(item) => {
            const bm = bookmarks.find((b) => b.id === item.id);
            if (bm) {
              session.gotoBookmark(bm.position);
              notify(`Jumped to bookmark${bm.label ? ` "${bm.label}"` : ''}`);
            }
            setMode('reading');
          }}
          onEdit={(item) => {
            setEditBookmarkId(Number(item.id));
            setMode('bookmark-edit');
          }}
          onDelete={(item) => {
            db.deleteBookmark(Number(item.id));
            setBookmarks(loadBookmarks());
            notify('Bookmark deleted');
          }}
          onClose={() => setMode('reading')}
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
          height={Math.min(12, height - 8)}
          footer="j/k move · enter jump · / filter · q close"
          onSelect={(item) => {
            const entry = session.book.toc.find((e) => e.id === item.id);
            if (entry) {
              session.goToToc(entry.blockIndex);
              notify(`→ ${truncate(entry.label, 40)}`);
            }
            setTocFilter('');
            setMode('reading');
          }}
          onFilter={() => setMode('toc-filter')}
          onClose={() => {
            setTocFilter('');
            setMode('reading');
          }}
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

      {mode === 'info' ? (
        <InfoModal session={session} db={db} theme={theme} onClose={() => setMode('reading')} />
      ) : null}

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
  onClose: () => void;
}): React.JSX.Element {
  const { session, db, theme, onClose } = props;
  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'q' || keyName === 'escape') onClose();
  });
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
    <Modal theme={theme} title="Book Info" width={72} footer="q — close">
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
