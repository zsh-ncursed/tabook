import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import type { BookRecord, LibraryDb, SortField } from '../../db/db.js';
import { createActionResolver, resolveKeyName, actionLabel } from '../keymap.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { BookDetail } from './BookDetail.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { forceRedraw } from '../screenRefresh.js';
import { truncateW } from '../../utils/text.js';
import { existsSync, unlinkSync } from 'node:fs';

interface LibraryCommandBus {
  sort?: SortField;
  group?: boolean;
}

export interface LibraryViewProps {
  db: LibraryDb;
  config: Config;
  theme: Theme;
  refreshTrigger: number;
  cmdBus: LibraryCommandBus;
  cmdVersion: number;
  notify: (message: string) => void;
  onOpenBook: (record: BookRecord) => void;
  onOpenFile: () => void;
  onQuit: () => void;
  onHelp: () => void;
  runCommand: (text: string) => void;
  completeCommand?: (value: string) => string | null;
  validCommandPrefix?: (value: string) => number;
  inputDisabled?: boolean;
}

type Mode = 'normal' | 'filter' | 'command' | 'detail' | 'confirm-delete';

interface Row {
  kind: 'header' | 'book';
  label?: string;
  book?: BookRecord;
}

const SORT_FIELDS: SortField[] = ['title', 'author', 'added', 'progress'];

export function LibraryView(props: LibraryViewProps): React.JSX.Element {
  const {
    db,
    config,
    theme,
    refreshTrigger,
    cmdBus,
    cmdVersion,
    notify,
    onOpenBook,
    onOpenFile,
    onQuit,
    onHelp,
    runCommand,
    completeCommand,
    validCommandPrefix,
    inputDisabled = false,
  } = props;
  const [width, height] = useTerminalSize();
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [recentBooks, setRecentBooks] = useState<BookRecord[]>([]);
  const [folderCount, setFolderCount] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [sortField, setSortField] = useState<SortField>('title');
  const [filter, setFilter] = useState('');
  const [groupBySeries, setGroupBySeries] = useState(false);
  const [mode, setMode] = useState<Mode>('normal');
  const [view, setView] = useState<'all' | 'recent'>('all');
  const [detailBook, setDetailBook] = useState<BookRecord | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<BookRecord | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState(false);
  const resolver = useMemo(() => createActionResolver(config), [config]);

  useEffect(() => {
    setBooks(db.listBooks());
    setRecentBooks(db.listRecentBooks());
    setFolderCount(db.listLibraryFolders().length);
  }, [db, refreshTrigger]);

  useEffect(() => {
    if (cmdBus.sort) setSortField(cmdBus.sort);
    if (cmdBus.group !== undefined) setGroupBySeries(cmdBus.group);
  }, [cmdVersion]);

  const bookList = useMemo(() => {
    const source = view === 'recent' ? recentBooks : books;
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? source.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.authorsText.toLowerCase().includes(q) ||
            (b.seriesText ?? '').toLowerCase().includes(q) ||
            b.genres.some((g) => g.toLowerCase().includes(q)),
        )
      : source;
    const sorted =
      view === 'recent' ? filtered : [...filtered].sort((a, b) => compareBooks(a, b, sortField));
    return sorted;
  }, [books, recentBooks, view, filter, sortField]);

  const rows = useMemo<Row[]>(() => {
    if (!groupBySeries) {
      return bookList.map((book) => ({ kind: 'book', book }));
    }
    const groups = new Map<string, BookRecord[]>();
    const standalone: BookRecord[] = [];
    for (const book of bookList) {
      // Group by the series *name* — not seriesText, which embeds the volume
      // number ('Trilogy #1'), so numbered volumes would each form their own
      // single-book group instead of one 'Trilogy' group.
      const groupKey = book.series?.name || book.seriesText;
      if (groupKey) {
        const arr = groups.get(groupKey) ?? [];
        arr.push(book);
        groups.set(groupKey, arr);
      } else {
        standalone.push(book);
      }
    }
    const result: Row[] = [];
    const groupNames = [...groups.keys()].sort((a, b) => a.localeCompare(b));
    for (const name of groupNames) {
      const arr = groups.get(name)!;
      arr.sort((a, b) => {
        const na = a.series?.number ?? Infinity;
        const nb = b.series?.number ?? Infinity;
        if (na !== nb) return na - nb;
        return a.title.localeCompare(b.title);
      });
      result.push({ kind: 'header', label: `${name} (${arr.length})` });
      for (const book of arr) {
        result.push({ kind: 'book', book });
      }
    }
    if (standalone.length > 0) {
      result.push({ kind: 'header', label: `Standalone (${standalone.length})` });
      for (const book of standalone) {
        result.push({ kind: 'book', book });
      }
    }
    return result;
  }, [bookList, groupBySeries]);

  useEffect(() => {
    if (cursor >= rows.length) setCursor(Math.max(0, rows.length - 1));
  }, [rows.length, cursor]);

  // Keep the cursor on a book row. In grouped view the first/last rows may be
  // group headers; when the list shrinks (filter, delete) the cursor can end up
  // pointing at a header, which has no selectable book.
  useEffect(() => {
    if (rows.length === 0) return;
    const row = rows[cursor];
    if (!row || row.kind !== 'book') {
      setCursor(snapToBook(rows, cursor >= rows.length ? rows.length - 1 : cursor));
    }
  }, [rows, cursor]);

  const selectedBook = (() => {
    const row = rows[cursor];
    return row && row.kind === 'book' ? row.book : undefined;
  })();

  const handleAction = (action: KeyAction | undefined): void => {
    switch (action) {
      case 'move_cursor_down':
        setCursor((c) => nextBook(rows, c));
        break;
      case 'move_cursor_up':
        setCursor((c) => prevBook(rows, c));
        break;
      case 'page_down':
        setCursor((c) => snapToBook(rows, Math.min(c + Math.max(1, height - 6), rows.length - 1)));
        break;
      case 'page_up':
        setCursor((c) => snapToBook(rows, Math.max(0, c - Math.max(1, height - 6))));
        break;
      case 'go_to_start':
        setCursor(snapToBook(rows, 0));
        break;
      case 'go_to_end':
        setCursor(snapToBook(rows, rows.length - 1));
        break;
      case 'select':
        if (selectedBook) {
          setDetailBook(selectedBook);
          setMode('detail');
        }
        break;
      case 'book_info':
        if (selectedBook) {
          setDetailBook(selectedBook);
          setMode('detail');
        }
        break;
      case 'open_file':
        onOpenFile();
        break;
      case 'delete_from_library':
        if (selectedBook) {
          setConfirmTarget(selectedBook);
          setConfirmDeleteFile(false);
          setMode('confirm-delete');
        }
        break;
      case 'delete_file':
        if (selectedBook) {
          setConfirmTarget(selectedBook);
          setConfirmDeleteFile(true);
          setMode('confirm-delete');
        }
        break;
      case 'sort_cycle':
        setSortField(
          (field) => SORT_FIELDS[(SORT_FIELDS.indexOf(field) + 1) % SORT_FIELDS.length]!,
        );
        break;
      case 'toggle_recent':
        setView((v) => (v === 'recent' ? 'all' : 'recent'));
        setCursor(0);
        setFilter('');
        break;
      case 'search':
        setMode('filter');
        break;
      case 'command':
        setMode('command');
        break;
      case 'quit':
        onQuit();
        break;
      case 'help':
        onHelp();
        break;
      default:
        break;
    }
  };

  // Stable handler backed by a ref — prevents Ink useInput re-subscribe race.
  const libInputRef = useRef({ mode, resolver, handleAction });
  libInputRef.current = { mode, resolver, handleAction };
  const handleLibInput = useCallback((input: string, key: Key) => {
    const s = libInputRef.current;
    if (s.mode !== 'normal') return;
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    const action = s.resolver.feed(keyName);
    s.handleAction(action);
  }, []);
  useInput(handleLibInput, { isActive: mode === 'normal' && !inputDisabled });

  const visibleCount = Math.max(3, height - 5);
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleCount / 2), Math.max(0, rows.length - visibleCount)),
  );
  const visibleRows = rows.slice(start, start + visibleCount);

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text color={theme.colors.heading} bold>
            {view === 'recent' ? 'Recent' : 'Library'}
          </Text>
          <Text color={theme.colors.dim}>
            {' '}
            · {bookList.length} book{bookList.length === 1 ? '' : 's'}
          </Text>
          {view === 'all' ? <Text color={theme.colors.dim}> · sort: {sortField}</Text> : null}
          {folderCount > 0 ? (
            <Text color={theme.colors.dim}>
              {' '}
              · {folderCount} folder{folderCount === 1 ? '' : 's'}
            </Text>
          ) : null}
          {groupBySeries ? <Text color={theme.colors.dim}> · grouped by series</Text> : null}
          {filter ? <Text color={theme.colors.accent}> · filter: "{filter}"</Text> : null}
          <Text color={theme.colors.dim}> · R recent</Text>
        </Box>
      </Box>

      {bookList.length === 0 ? (
        <Box flexDirection="column" paddingX={2} paddingY={2}>
          <Text color={theme.colors.text}>
            {books.length === 0 ? 'Library is empty.' : 'No books match the current filter.'}
          </Text>
          <Text color={theme.colors.dim} dimColor>
            {books.length === 0
              ? 'Attach a folder with :library add <path>, press o to open a book, or use :open <path>.'
              : 'Press / to clear the filter.'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          {visibleRows.map((row, i) => {
            const absolute = start + i;
            if (row.kind === 'header') {
              return (
                <Text key={`h-${absolute}`} color={theme.colors.accent} bold>
                  {' '}
                  {row.label}
                </Text>
              );
            }
            const book = row.book!;
            const selected = absolute === cursor;
            const titleW = Math.max(10, width - 46);
            const title = truncateW(book.title, titleW);
            const meta = [
              book.authorsText,
              book.seriesText,
              book.progressPercent !== null ? `${book.progressPercent}%` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Box key={`b-${absolute}`}>
                <Text
                  color={selected ? theme.colors.background : theme.colors.text}
                  backgroundColor={selected ? theme.colors.accent : undefined}
                  bold={selected}
                >
                  {' '}
                  {selected ? '▶' : ' '} {title}
                </Text>
                {meta ? (
                  <Text color={theme.colors.dim} dimColor>
                    {'  '}
                    {truncateW(meta, Math.max(10, width - 40))}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}

      {mode === 'filter' ? (
        <TextPrompt
          theme={theme}
          prefix="/"
          placeholder="filter by title, author, series or genre…"
          historyKey="filter"
          onSubmit={(value) => {
            setFilter(value.trim());
            setCursor(0);
            setMode('normal');
          }}
          onCancel={() => setMode('normal')}
        />
      ) : null}

      {mode === 'command' ? (
        <TextPrompt
          theme={theme}
          prefix=":"
          placeholder="type a command, e.g. :open book.fb2, :sort author, :group, :theme dracula"
          historyKey="command"
          onTab={completeCommand}
          validPrefixLength={validCommandPrefix}
          onSubmit={(value) => {
            setMode('normal');
            runCommand(value);
          }}
          onCancel={() => setMode('normal')}
        />
      ) : null}

      {mode === 'detail' && detailBook ? (
        <BookDetail
          book={detailBook}
          theme={theme}
          onRead={() => onOpenBook(detailBook)}
          onHelp={onHelp}
          onClose={() => {
            setDetailBook(null);
            setMode('normal');
            forceRedraw();
          }}
        />
      ) : null}

      {mode === 'confirm-delete' && confirmTarget ? (
        <DeleteConfirm
          book={confirmTarget}
          deleteFile={confirmDeleteFile}
          theme={theme}
          onConfirm={() => {
            const filePath = confirmTarget.path;
            db.removeBook(confirmTarget.id);
            if (confirmDeleteFile) {
              try {
                if (existsSync(filePath)) unlinkSync(filePath);
                notify(`Deleted file and library record: ${confirmTarget.title}`);
              } catch (err) {
                notify(
                  `Removed from library, but file delete failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            } else {
              notify(`Removed from library: ${confirmTarget.title}`);
            }
            const next = db.listBooks();
            setBooks(next);
            setCursor((c) => Math.min(Math.max(0, c), Math.max(0, next.length - 1)));
            setConfirmTarget(null);
            setConfirmDeleteFile(false);
            setMode('normal');
          }}
          onCancel={() => {
            setConfirmTarget(null);
            setConfirmDeleteFile(false);
            setMode('normal');
          }}
        />
      ) : null}

      <StatusBar
        theme={theme}
        left={`tabook · ${selectedBook ? truncateW(selectedBook.title, 30) : 'no selection'}`}
        right={hintBar(config, 'library')}
        message={''}
      />
    </Box>
  );
}

function compareBooks(a: BookRecord, b: BookRecord, field: SortField): number {
  switch (field) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'author':
      return a.authorsText.localeCompare(b.authorsText) || a.title.localeCompare(b.title);
    case 'added':
      return b.addedAt.localeCompare(a.addedAt);
    case 'progress': {
      const pa = a.progressPercent ?? -1;
      const pb = b.progressPercent ?? -1;
      return pb - pa;
    }
  }
}

// Cursor navigation operates on the full row list (group headers + book rows).
// Headers are not selectable, so directional moves skip over them.
function nextBook(rows: Row[], from: number): number {
  for (let i = from + 1; i < rows.length; i++) {
    if (rows[i]!.kind === 'book') return i;
  }
  return from;
}

function prevBook(rows: Row[], from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (rows[i]!.kind === 'book') return i;
  }
  return from;
}

// Snap an arbitrary row index to the nearest selectable book row. Used by
// page/start/end moves where the target may land on a header.
function snapToBook(rows: Row[], idx: number): number {
  const clamped = Math.max(0, Math.min(idx, rows.length - 1));
  const down = nextBook(rows, clamped - 1);
  if (down > clamped) return down;
  const up = prevBook(rows, clamped + 1);
  if (up < clamped) return up;
  return rows[clamped]!.kind === 'book' ? clamped : Math.max(0, clamped - 1);
}

function hintBar(config: Config, view: string): string {
  const key = (action: KeyAction): string | undefined => {
    for (const [k, a] of Object.entries(config.keybindings)) {
      if (a === action) return k;
    }
    return undefined;
  };
  if (view === 'library') {
    const items = [
      key('move_cursor_down'),
      key('select'),
      key('open_file'),
      key('search'),
      key('sort_cycle'),
      key('toggle_recent'),
      key('delete_from_library'),
      key('delete_file'),
      key('help'),
      key('command'),
      key('quit'),
    ];
    return items
      .map((k, i) => (k ? `${actionLabel(actionsList[i]!)} ${k}`.trim() : null))
      .filter((s): s is string => s !== null)
      .join(' · ');
  }
  return '';
}

const actionsList: KeyAction[] = [
  'move_cursor_down',
  'select',
  'open_file',
  'search',
  'sort_cycle',
  'toggle_recent',
  'delete_from_library',
  'delete_file',
  'help',
  'command',
  'quit',
];

function DeleteConfirm(props: {
  book: BookRecord;
  deleteFile: boolean;
  theme: Theme;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { book, deleteFile, theme, onConfirm, onCancel } = props;
  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'y' || keyName === 'enter') {
      onConfirm();
      return;
    }
    if (keyName === 'n' || keyName === 'escape') {
      onCancel();
    }
  });
  return (
    <Box flexDirection="column">
      <Text color={theme.colors.error} bold>
        {deleteFile
          ? `Delete file AND library record for "${truncateW(book.title, 40)}"? (y/N · esc cancel)`
          : `Remove "${truncateW(book.title, 40)}" from the library? (y/N · esc cancel)`}
      </Text>
      <Text color={theme.colors.dim} dimColor>
        {deleteFile
          ? 'This permanently deletes the file from disk. Cannot be undone.'
          : 'Only the database record is removed; the file on disk is untouched.'}
      </Text>
    </Box>
  );
}
