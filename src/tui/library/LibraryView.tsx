import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import type { BookRecord, LibraryDb, SortField } from '../../db/db.js';
import { createActionResolver, resolveKeyName, actionLabel } from '../keymap.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { BookDetail } from './BookDetail.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { displayWidth, formatBytes } from '../../utils/text.js';

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
  inputDisabled?: boolean;
}

type Mode = 'normal' | 'filter' | 'command' | 'detail' | 'confirm-delete';

interface Row {
  kind: 'header' | 'book';
  label?: string;
  book?: BookRecord;
  bookIdx?: number;
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
    inputDisabled = false,
  } = props;
  const [width, height] = useTerminalSize();
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [recentBooks, setRecentBooks] = useState<BookRecord[]>([]);
  const [cursor, setCursor] = useState(0);
  const [sortField, setSortField] = useState<SortField>('title');
  const [filter, setFilter] = useState('');
  const [groupBySeries, setGroupBySeries] = useState(false);
  const [mode, setMode] = useState<Mode>('normal');
  const [view, setView] = useState<'all' | 'recent'>('all');
  const [detailBook, setDetailBook] = useState<BookRecord | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<BookRecord | null>(null);
  const resolver = useMemo(() => createActionResolver(config), [config]);

  useEffect(() => {
    setBooks(db.listBooks());
    setRecentBooks(db.listRecentBooks());
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
    const sorted = view === 'recent' ? filtered : [...filtered].sort((a, b) => compareBooks(a, b, sortField));
    return sorted;
  }, [books, recentBooks, view, filter, sortField]);

  const rows = useMemo<Row[]>(() => {
    if (!groupBySeries) {
      return bookList.map((book, i) => ({ kind: 'book', book, bookIdx: i }));
    }
    const groups = new Map<string, BookRecord[]>();
    const standalone: BookRecord[] = [];
    for (const book of bookList) {
      if (book.seriesText) {
        const arr = groups.get(book.seriesText) ?? [];
        arr.push(book);
        groups.set(book.seriesText, arr);
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
        result.push({ kind: 'book', book, bookIdx: bookList.indexOf(book) });
      }
    }
    if (standalone.length > 0) {
      result.push({ kind: 'header', label: `Standalone (${standalone.length})` });
      for (const book of standalone) {
        result.push({ kind: 'book', book, bookIdx: bookList.indexOf(book) });
      }
    }
    return result;
  }, [bookList, groupBySeries]);

  useEffect(() => {
    if (cursor >= bookList.length) setCursor(Math.max(0, bookList.length - 1));
  }, [bookList.length, cursor]);

  const selectedBook = bookList[cursor];

  const handleAction = (action: KeyAction | undefined): void => {
    switch (action) {
      case 'move_cursor_down':
        setCursor((c) => Math.min(bookList.length - 1, c + 1));
        break;
      case 'move_cursor_up':
        setCursor((c) => Math.max(0, c - 1));
        break;
      case 'page_down':
        setCursor((c) => Math.min(bookList.length - 1, c + Math.max(1, height - 6)));
        break;
      case 'page_up':
        setCursor((c) => Math.max(0, c - Math.max(1, height - 6)));
        break;
      case 'go_to_start':
        setCursor(0);
        break;
      case 'go_to_end':
        setCursor(bookList.length - 1);
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

  useInput(
    (input, key) => {
      if (mode !== 'normal') return;
      const keyName = resolveKeyName(input, key);
      if (keyName === null) return;
      const action = resolver.feed(keyName);
      handleAction(action);
    },
    { isActive: mode === 'normal' && !inputDisabled },
  );

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
              ? 'Press o to open a book file, or use :open <path>.'
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
            const selected = row.bookIdx === cursor;
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
          onClose={() => {
            setDetailBook(null);
            setMode('normal');
          }}
        />
      ) : null}

      {mode === 'confirm-delete' && confirmTarget ? (
        <DeleteConfirm
          book={confirmTarget}
          theme={theme}
          onConfirm={() => {
            db.removeBook(confirmTarget.id);
            setBooks(db.listBooks());
            setCursor((c) => Math.min(Math.max(0, c), Math.max(0, books.length - 2)));
            notify(`Removed from library: ${confirmTarget.title}`);
            setConfirmTarget(null);
            setMode('normal');
          }}
          onCancel={() => {
            setConfirmTarget(null);
            setMode('normal');
          }}
        />
      ) : null}

      <StatusBar
        theme={theme}
        left={`tome · ${selectedBook ? truncateW(selectedBook.title, 30) : 'no selection'}`}
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

function truncateW(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
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
  'command',
  'quit',
];

function DeleteConfirm(props: {
  book: BookRecord;
  theme: Theme;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { book, theme, onConfirm, onCancel } = props;
  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'y' || keyName === 'enter') {
      onConfirm();
      return;
    }
    if (keyName === 'n' || keyName === 'escape' || keyName === 'q') {
      onCancel();
    }
  });
  return (
    <Box flexDirection="column">
      <Text color={theme.colors.error} bold>
        Remove "{truncateW(book.title, 40)}" from the library? (y/N)
      </Text>
      <Text color={theme.colors.dim} dimColor>
        Only the database record is removed; the file on disk is untouched.
      </Text>
    </Box>
  );
}

export function bytesText(size: number): string {
  return formatBytes(size);
}
