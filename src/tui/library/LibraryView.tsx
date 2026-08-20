import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import type { BookRecord, LibraryDb, SortField } from '../../db/db.js';
import { createActionResolver, resolveKeyName, actionLabel, keyForAction } from '../keymap.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { BookDetail } from './BookDetail.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { forceRedraw } from '../screenRefresh.js';
import { useMouseClicks } from '../mouse.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { truncateW, wrapText } from '../../utils/text.js';
import { useImageLayer, type ImagePlacement } from '../imageLayer.js';
import {
  buildLineIndex,
  rowAtLine,
  visibleWindow,
  cursorForAction,
  CARD_ROWS,
  COVER_W,
} from '../listLayout.js';
import { extractCoverBytes } from '../../formats/cover.js';
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
  onOpenPalette?: () => void;
  runCommand: (text: string) => void;
  completeCommand?: (value: string) => string | null;
  validCommandPrefix?: (value: string) => number;
  inputDisabled?: boolean;
  message?: string;
}

type Mode = 'normal' | 'filter' | 'command' | 'detail' | 'confirm-delete';

interface Row {
  kind: 'header' | 'book';
  label?: string;
  book?: BookRecord;
}

const SORT_FIELDS: SortField[] = ['title', 'author', 'added', 'progress'];

// Book cards: each book occupies CARD_ROWS terminal lines so a cover
// thumbnail (COVER_W × CARD_ROWS) can be drawn next to it without covering
// neighboring rows. Group headers stay 1 line (handled by listLayout).

function rowHeight(row: Row): number {
  return row.kind === 'header' ? 1 : CARD_ROWS;
}

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
    onOpenPalette,
    runCommand,
    completeCommand,
    validCommandPrefix,
    inputDisabled = false,
    message,
  } = props;
  const imageLayer = useImageLayer();
  const [width, height] = useTerminalSize();
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [recentBooks, setRecentBooks] = useState<BookRecord[]>([]);
  const [continueBooks, setContinueBooks] = useState<BookRecord[]>([]);
  const [folderCount, setFolderCount] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [sortField, setSortField] = useState<SortField>('title');
  const [filter, setFilter] = useState('');
  // Live filter: TextPrompt reports every keystroke via onValueChange; we
  // debounce the application so big libraries don't re-filter+sort on every
  // keypress, and remember the pre-edit filter so Escape can restore it.
  const filterBaselineRef = useRef('');
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    };
  }, []);
  const [groupBySeries, setGroupBySeries] = useState(false);
  const [mode, setMode] = useState<Mode>('normal');
  const [view, setView] = useState<'all' | 'recent' | 'continue'>('all');
  const [detailBook, setDetailBook] = useState<BookRecord | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<BookRecord | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState(false);
  // Cover bytes by book id, lazily extracted for the visible window only and
  // cached so scrolling doesn't re-parse every file on every render. The
  // undefined case means "no cover / failed to extract" and is also cached
  // so a missing cover isn't re-read on every scroll frame.
  const [covers, setCovers] = useState<Map<number, Uint8Array | undefined>>(new Map());
  const coversRef = useRef(covers);
  coversRef.current = covers;
  const resolver = useMemo(() => createActionResolver(config), [config]);

  useEffect(() => {
    setBooks(db.listBooks());
    setRecentBooks(db.listRecentBooks());
    setContinueBooks(db.listContinueBooks());
    setFolderCount(db.listLibraryFolders().length);
  }, [db, refreshTrigger]);

  useEffect(() => {
    if (cmdBus.sort) setSortField(cmdBus.sort);
    if (cmdBus.group !== undefined) setGroupBySeries(cmdBus.group);
  }, [cmdVersion]);

  const bookList = useMemo(() => {
    const source = view === 'recent' ? recentBooks : view === 'continue' ? continueBooks : books;
    return filterAndSortBooks(source, filter, sortField, view === 'all');
  }, [books, recentBooks, continueBooks, view, filter, sortField]);

  const rows = useMemo(() => buildRows(bookList, groupBySeries), [bookList, groupBySeries]);

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

  // Position of the selected book within the (filtered) book list, 1-based.
  // Shown in the header as "X/Y" so the user knows where they are in a long
  // library. Undefined when nothing is selected (e.g. cursor on a header).
  const selectedIndex = selectedBook ? bookList.indexOf(selectedBook) : -1;
  const positionLabel = selectedIndex >= 0 ? `${selectedIndex + 1}/${bookList.length}` : undefined;

  const handleAction = (action: KeyAction | undefined): void => {
    dispatchLibraryAction(action, {
      rows,
      height,
      selectedBook,
      filter,
      filterBaselineRef,
      setCursor,
      setDetailBook,
      setConfirmTarget,
      setConfirmDeleteFile,
      setMode,
      setSortField,
      setView,
      setFilter,
      onOpenFile,
      onOpenPalette,
      onQuit,
      onHelp,
    });
  };

  // Stable handler backed by a ref — prevents Ink useInput re-subscribe race.
  // useInputDispatch registers one stable useInput (mouse-chunk filtering
  // included) and routes every keypress through dispatchRef.current, which we
  // overwrite each render with a fresh closure over the current state.
  const dispatchRef = useInputDispatch(mode === 'normal' && !inputDisabled);
  dispatchRef.current = (input: string, key: Key) => {
    if (mode !== 'normal') return;
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    const action = resolver.feed(keyName);
    handleAction(action);
  };

  // Reserve space for the annotation preview pane (header + up to 4 lines)
  // when the selected book has one, so the list doesn't overflow the screen.
  const annotationLines = selectedBook?.annotation
    ? Math.min(
        5,
        1 + Math.min(4, wrapText(selectedBook.annotation, Math.max(20, width - 4)).length),
      )
    : 0;
  // The list is a window of rows with non-uniform heights (1-line group
  // headers, CARD_ROWS-line book cards) fitted into `maxLines` terminal lines;
  // listLayout keeps cursor centering, slicing and mouse hit-testing in sync.
  const maxLines = Math.max(3, height - 5 - annotationLines);
  const listIndex = useMemo(() => buildLineIndex(rows, rowHeight), [rows]);
  const { start, end } = useMemo(
    () => visibleWindow(rows, listIndex, cursor, maxLines),
    [rows, listIndex, cursor, maxLines],
  );
  const visibleRows = rows.slice(start, end);

  // Mouse: a click moves the cursor to the row under it; a second click on
  // the same row within 350 ms opens it (like enter). The list starts one
  // row below the header, and terminal Y is 1-based; the click line is mapped
  // back to a row through the line index (cards are CARD_ROWS tall).
  // Lazy cover extraction: for the visible window only, read cover bytes for
  // books that have a coverKey and aren't cached yet. Runs when the window
  // shifts (scroll/cursor move), so covers appear as rows enter the screen.
  useEffect(() => {
    const next = new Map(coversRef.current);
    let changed = false;
    for (let i = start; i < end && i < rows.length; i++) {
      const row = rows[i];
      if (row?.kind !== 'book') continue;
      const book = row.book!;
      if (!book.coverKey || next.has(book.id)) continue;
      next.set(book.id, extractCoverBytes(book.path, book.format, book.coverKey));
      changed = true;
    }
    if (changed) {
      // LRU cap: evict oldest entries when the cache exceeds the limit.
      const CAP = 200;
      while (next.size > CAP) {
        const oldest = next.keys().next().value;
        if (oldest !== undefined) next.delete(oldest);
        else break;
      }
      setCovers(next);
    }
  }, [rows, start, end]);

  // Draw cover thumbnails next to the visible cards. The list starts one
  // row below the header (terminal row 1, 0-indexed); each card's cover box
  // is COVER_W wide and CARD_ROWS tall at the card's first line. Drop the
  // images only when something actually covers them: an App-level overlay
  // (inputDisabled) or a modal panel (detail / confirm-delete). Inline
  // prompts (filter / command) render below the list, so covers stay — and
  // the live filter re-draws them for the narrowed window as you type.
  // update() reconciles by identifier, so scrolled-out covers are removed
  // and unchanged ones aren't re-sent.
  useEffect(() => {
    if (inputDisabled || mode === 'detail' || mode === 'confirm-delete') {
      imageLayer.clear();
      return;
    }
    if (!imageLayer.start()) return;
    const placements: ImagePlacement[] = [];
    const resources = new Map<string, Uint8Array>();
    const listTop = listIndex.prefix[start] ?? 0;
    for (let i = start; i < end && i < rows.length; i++) {
      const row = rows[i];
      if (row?.kind !== 'book') continue;
      const book = row.book!;
      const bytes = covers.get(book.id);
      if (!bytes || bytes.length === 0) continue;
      const id = `lib-cover-${book.id}`;
      const line = (listIndex.prefix[i] ?? 0) - listTop;
      placements.push({
        identifier: id,
        x: 1, // list container has paddingX=1
        y: 1 + line,
        width: COVER_W,
        height: CARD_ROWS,
        src: id,
      });
      resources.set(id, bytes);
    }
    imageLayer.update(placements, resources);
  }, [rows, start, end, covers, listIndex, inputDisabled, mode]);

  useEffect(() => () => imageLayer.clear(), []);

  const clickStateRef = useRef({ row: -1, time: 0 });
  const mouseStateRef = useRef({ start, end, rows, listIndex, inputDisabled, mode });
  mouseStateRef.current = { start, end, rows, listIndex, inputDisabled, mode };
  useMouseClicks((click) => {
    if (click.button !== 'left' || !click.press) return;
    const s = mouseStateRef.current;
    if (s.mode !== 'normal' || s.inputDisabled) return;
    const line = click.y - 2;
    const windowLines = (s.listIndex.prefix[s.end] ?? 0) - (s.listIndex.prefix[s.start] ?? 0);
    if (line < 0 || line >= windowLines) return;
    const absolute = rowAtLine(s.rows, s.listIndex, (s.listIndex.prefix[s.start] ?? 0) + line);
    if (absolute < s.start || absolute >= s.end) return;
    const row = s.rows[absolute];
    if (row?.kind !== 'book') return; // group headers are not clickable
    const now = Date.now();
    const prev = clickStateRef.current;
    if (prev.row === absolute && now - prev.time < 350) {
      clickStateRef.current = { row: -1, time: 0 };
      setCursor(absolute);
      setDetailBook(row.book!);
      setMode('detail');
    } else {
      clickStateRef.current = { row: absolute, time: now };
      setCursor(absolute);
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text color={theme.colors.heading} bold>
            {view === 'recent' ? 'Recent' : view === 'continue' ? 'Continue reading' : 'Library'}
          </Text>
          <Text color={theme.colors.dim}>
            {' '}
            · {bookList.length} book{bookList.length === 1 ? '' : 's'}
          </Text>
          {positionLabel ? <Text color={theme.colors.dim}> · {positionLabel}</Text> : null}
          {view === 'all' ? <Text color={theme.colors.dim}> · sort: {sortField}</Text> : null}
          {folderCount > 0 ? (
            <Text color={theme.colors.dim}>
              {' '}
              · {folderCount} folder{folderCount === 1 ? '' : 's'}
            </Text>
          ) : null}
          {groupBySeries ? <Text color={theme.colors.dim}> · grouped by series</Text> : null}
          {filter ? <Text color={theme.colors.accent}> · filter: "{filter}"</Text> : null}
          <Text color={theme.colors.dim}>
            {' '}
            · {keyForAction(config, 'toggle_recent') ?? 'R'} recent ·{' '}
            {keyForAction(config, 'toggle_continue') ?? 'C'} continue
          </Text>
        </Box>
      </Box>

      {bookList.length === 0 ? (
        <Box flexDirection="column" paddingX={2} paddingY={2}>
          <Text color={theme.colors.text}>
            {books.length === 0
              ? 'Library is empty.'
              : view === 'continue'
                ? 'No books in progress yet — open one and read a bit to see it here.'
                : 'No books match the current filter.'}
          </Text>
          <Text color={theme.colors.dim} dimColor>
            {books.length === 0
              ? 'Attach a folder with :library add <path>, press o to open a book, or use :open <path>.'
              : view === 'continue'
                ? 'Progress updates as you read; books you finished are not listed here.'
                : 'Press / to clear the filter.'}
          </Text>
        </Box>
      ) : (
        <BookList rows={visibleRows} start={start} cursor={cursor} theme={theme} width={width} />
      )}

      {mode === 'filter' ? (
        <TextPrompt
          theme={theme}
          prefix="/"
          placeholder="filter by title, author, series or genre…"
          historyKey="filter"
          initialValue={filter}
          onValueChange={(value) => {
            // Debounce: typing "harry" fires onValueChange 5 times; only the
            // last settles. Live preview means the list narrows as you type;
            // Enter commits (and closes), Escape restores the old filter.
            if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
            filterTimerRef.current = setTimeout(() => {
              setFilter(value.trim());
              setCursor(0);
            }, 120);
          }}
          onSubmit={(value) => {
            if (filterTimerRef.current) {
              clearTimeout(filterTimerRef.current);
              filterTimerRef.current = null;
            }
            setFilter(value.trim());
            setCursor(0);
            setMode('normal');
          }}
          onCancel={() => {
            if (filterTimerRef.current) {
              clearTimeout(filterTimerRef.current);
              filterTimerRef.current = null;
            }
            // Restore the filter that was active before the prompt opened.
            setFilter(filterBaselineRef.current);
            setCursor(0);
            setMode('normal');
          }}
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
          config={config}
          theme={theme}
          onRead={() => onOpenBook(detailBook)}
          onHelp={onHelp}
          inputDisabled={inputDisabled}
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
            forceRedraw();
          }}
          onCancel={() => {
            setConfirmTarget(null);
            setConfirmDeleteFile(false);
            setMode('normal');
          }}
        />
      ) : null}

      {selectedBook?.annotation ? (
        <AnnotationPreview theme={theme} text={selectedBook.annotation} width={width} />
      ) : null}

      <StatusBar
        theme={theme}
        statusbar={config.statusbar}
        width={width}
        data={{
          title: `tabook · ${selectedBook ? truncateW(selectedBook.title, 30) : 'no selection'}`,
          hint: hintBar(config, 'library'),
          message,
        }}
      />
    </Box>
  );
}

// Filter by title/author/series/genre and sort. `sort` is false for the
// recent/continue views, which keep their natural (recency) order.
function filterAndSortBooks(
  source: BookRecord[],
  filter: string,
  sortField: SortField,
  sort: boolean,
): BookRecord[] {
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
  if (!sort) return filtered;
  return [...filtered].sort((a, b) => compareBooks(a, b, sortField));
}

// Build the display row list (group headers + book rows) from the filtered
// book list. Grouped view groups by series *name* — not seriesText, which
// embeds the volume number ('Trilogy #1'), so numbered volumes would each
// form their own single-book group instead of one 'Trilogy' group.
function buildRows(bookList: BookRecord[], groupBySeries: boolean): Row[] {
  if (!groupBySeries) {
    return bookList.map((book) => ({ kind: 'book', book }));
  }
  const groups = new Map<string, BookRecord[]>();
  const standalone: BookRecord[] = [];
  for (const book of bookList) {
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
}

// The visible window of rows (group headers + book cards) for the main list.
// Pure presentational — navigation and selection live in LibraryView.
function BookList(props: {
  rows: Row[];
  start: number;
  cursor: number;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const { rows, start, cursor, theme, width } = props;
  return (
    <Box flexDirection="column" paddingX={1}>
      {rows.map((row, i) => {
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
        const textW = Math.max(10, width - COVER_W - 40);
        const title = truncateW(book.title, textW);
        const sub = [
          book.authorsText,
          book.seriesText,
          book.progressPercent !== null ? `${book.progressPercent}%` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          // 3-line card: title, authors, series · progress. The text is
          // indented past the cover thumbnail column (COVER_W + 2) so the
          // image drawn by imageLayer doesn't overlap it.
          <Box key={`b-${absolute}`} flexDirection="column" paddingLeft={COVER_W + 2}>
            <Text
              color={selected ? theme.colors.background : theme.colors.text}
              backgroundColor={selected ? theme.colors.selection : undefined}
              bold={selected}
            >
              {selected ? '▸ ' : '  '}
              {title}
            </Text>
            <Text color={theme.colors.dim} dimColor>
              {truncateW(book.authorsText || 'Unknown author', textW)}
            </Text>
            <Text color={theme.colors.dim} dimColor>
              {sub ? truncateW(sub, textW) : ' '}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// Context for dispatchLibraryAction: everything the action switch needs.
// Built fresh on every render (handleAction is recreated each render anyway).
interface LibraryActionContext {
  rows: Row[];
  height: number;
  selectedBook: BookRecord | undefined;
  filter: string;
  filterBaselineRef: React.MutableRefObject<string>;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
  setDetailBook: (book: BookRecord | null) => void;
  setConfirmTarget: (book: BookRecord | null) => void;
  setConfirmDeleteFile: (v: boolean) => void;
  setMode: (m: Mode) => void;
  setSortField: React.Dispatch<React.SetStateAction<SortField>>;
  setView: React.Dispatch<React.SetStateAction<'all' | 'recent' | 'continue'>>;
  setFilter: (v: string) => void;
  onOpenFile: () => void;
  onOpenPalette?: () => void;
  onQuit: () => void;
  onHelp: () => void;
}

// Library-mode action handling, extracted from the component so it can be
// unit-tested without rendering the view. Cursor arithmetic (page/start/end)
// goes through the shared cursorForAction; directional moves keep the
// row-aware nextBook/prevBook (they skip group headers).
function dispatchLibraryAction(action: KeyAction | undefined, ctx: LibraryActionContext): void {
  const {
    rows,
    height,
    selectedBook,
    filter,
    filterBaselineRef,
    setCursor,
    setDetailBook,
    setConfirmTarget,
    setConfirmDeleteFile,
    setMode,
    setSortField,
    setView,
    setFilter,
    onOpenFile,
    onOpenPalette,
    onQuit,
    onHelp,
  } = ctx;
  switch (action) {
    case 'move_cursor_down':
      setCursor((c) => nextBook(rows, c));
      break;
    case 'move_cursor_up':
      setCursor((c) => prevBook(rows, c));
      break;
    case 'page_down':
      setCursor((c) => snapToBook(rows, cursorForAction(action, c, rows.length, height - 6)));
      break;
    case 'page_up':
      setCursor((c) => snapToBook(rows, cursorForAction(action, c, rows.length, height - 6)));
      break;
    case 'go_to_start':
      setCursor(snapToBook(rows, cursorForAction(action, 0, rows.length)));
      break;
    case 'go_to_end':
      setCursor(snapToBook(rows, cursorForAction(action, 0, rows.length)));
      break;
    case 'select':
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
      setSortField((field) => SORT_FIELDS[(SORT_FIELDS.indexOf(field) + 1) % SORT_FIELDS.length]!);
      break;
    case 'toggle_recent':
      setView((v) => (v === 'recent' ? 'all' : 'recent'));
      setCursor(0);
      setFilter('');
      break;
    case 'toggle_continue':
      setView((v) => (v === 'continue' ? 'all' : 'continue'));
      setCursor(0);
      setFilter('');
      break;
    case 'search':
      filterBaselineRef.current = filter;
      setMode('filter');
      break;
    case 'command':
      setMode('command');
      break;
    case 'command_palette':
      onOpenPalette?.();
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
      key('toggle_continue'),
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
  'toggle_continue',
  'delete_from_library',
  'delete_file',
  'help',
  'command',
  'quit',
];

// Annotation preview pane under the book list: shows the selected book's
// annotation, wrapped to the terminal width, capped at 3 lines with an
// ellipsis. Clicking into BookDetail still shows the full text.
function AnnotationPreview(props: {
  theme: Theme;
  text: string;
  width: number;
}): React.JSX.Element {
  const { theme, text, width } = props;
  const lines = wrapText(text, Math.max(20, width - 4));
  return (
    <Box flexDirection="column" paddingX={2}>
      <Text color={theme.colors.heading} bold>
        Annotation
      </Text>
      {lines.slice(0, 3).map((line, i) => (
        <Text key={i} color={theme.colors.dim} dimColor>
          {line || ' '}
        </Text>
      ))}
      {lines.length > 3 ? (
        <Text color={theme.colors.dim} dimColor>
          …
        </Text>
      ) : null}
    </Box>
  );
}

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
    <Box flexDirection="column" alignSelf="center">
      <Box borderStyle="round" borderColor={theme.colors.error} width={60}>
        <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
          <Text color={theme.colors.error} bold>
            {deleteFile ? 'Delete book' : 'Remove from library'}
          </Text>
          <Box marginY={1} flexDirection="column">
            <Text color={theme.colors.text}>
              {deleteFile
                ? `Delete file AND library record for "${truncateW(book.title, 50)}"?`
                : `Remove "${truncateW(book.title, 50)}" from the library?`}
            </Text>
            <Text color={theme.colors.dim} dimColor>
              {deleteFile
                ? 'This permanently deletes the file from disk. Cannot be undone.'
                : 'Only the database record is removed; the file on disk is untouched.'}
            </Text>
          </Box>
          <Text color={theme.colors.dim} dimColor>
            y confirm · esc cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
