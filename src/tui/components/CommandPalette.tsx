import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { CommandScreen } from '../commands.js';
import {
  commandExecutable,
  fuzzyMatchCommands,
  fuzzyMatchBooks,
  type BookMatch,
  type CommandDef,
} from '../commands.js';
import { resolveKeyName } from '../keymap.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { centeredWindow } from '../listLayout.js';
import { truncateW } from '../../utils/text.js';
import type { BookRecord } from '../../db/db.js';

export interface CommandPaletteProps {
  theme: Theme;
  /** Which screen is active; only commands valid there are offered. */
  screen: CommandScreen;
  /** Run a command line, e.g. ':theme nord' (the : prefix is included). */
  onRun: (text: string) => void;
  onClose: () => void;
  /** Library books offered alongside commands; empty/absent disables them. */
  books?: BookRecord[];
  /** Open a book selected from the library matches. */
  onOpenBook?: (record: BookRecord) => void;
}

// One palette row: a command or a library book. Commands and books share the
// fuzzy-matching engine and are merged into a single score-ordered list.
type PaletteEntry =
  | { kind: 'command'; def: CommandDef; score: number; indices: number[] }
  | { kind: 'book'; book: BookRecord; score: number; indices: number[] };

// Command palette overlay (Ctrl+P): type to fuzzy-filter the command registry
// and the library (books by title/authors/series/genres), ↑/↓ (or Ctrl+N/P)
// move, enter runs the highlighted command or opens the book, esc closes.
// j/k deliberately type into the query — descriptions contain those letters
// (e.g. ":goto — Jump to a page"), so navigation stays on the arrows.
export function CommandPalette(props: CommandPaletteProps): React.JSX.Element {
  const { theme, screen, onRun, onClose, books, onOpenBook } = props;
  const [termWidth, height] = useTerminalSize();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const callbacksRef = useRef({ onRun, onClose, onOpenBook });
  callbacksRef.current = { onRun, onClose, onOpenBook };

  const entries = useMemo<PaletteEntry[]>(() => {
    const cmds: PaletteEntry[] = fuzzyMatchCommands(query, screen).map((m) => ({
      kind: 'command',
      def: m.def,
      score: m.score,
      indices: m.indices,
    }));
    if (query.trim() === '' || !books || books.length === 0) return cmds;
    const bookMatches = fuzzyMatchBooks(query, books);
    if (bookMatches.length === 0) return cmds;
    // Merge and sort by fuzzy score; commands win ties so the familiar
    // command-first order survives when a book ties with a command.
    return [...cmds, ...bookMatches.map(toBookEntry)].sort(
      (a, b) => a.score - b.score || a.kind.localeCompare(b.kind),
    );
  }, [query, screen, books]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Keep the cursor inside the (possibly shrinking) match list.
  useEffect(() => {
    if (cursor >= entries.length) setCursor(Math.max(0, entries.length - 1));
  }, [entries.length, cursor]);

  const dispatchRef = useInputDispatch(true);
  dispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'escape') {
      callbacksRef.current.onClose();
      return;
    }
    if (keyName === 'enter') {
      const entry = entriesRef.current[cursorRef.current];
      if (entry) {
        if (entry.kind === 'command') callbacksRef.current.onRun(commandExecutable(entry.def));
        else callbacksRef.current.onOpenBook?.(entry.book);
      }
      callbacksRef.current.onClose();
      return;
    }
    if (keyName === 'backspace' || keyName === 'delete') {
      setQuery((q) => q.slice(0, -1));
      setCursor(0);
      return;
    }
    if (keyName === 'ctrl+u') {
      setQuery('');
      setCursor(0);
      return;
    }
    // Navigation: arrows + Ctrl+N/P. Everything else (j/k included) types.
    if (keyName === 'up' || keyName === 'ctrl+p') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (keyName === 'down' || keyName === 'ctrl+n') {
      setCursor((c) => Math.min(Math.max(0, entriesRef.current.length - 1), c + 1));
      return;
    }
    if (input && input.length > 0 && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setCursor(0);
    }
  };

  const visibleCount = Math.min(12, Math.max(3, height - 8));
  const { start, end } = centeredWindow(entries.length, cursor, visibleCount);
  const visible = entries.slice(start, end);

  return (
    <Box flexDirection="column" alignSelf="center">
      <Box
        borderStyle="round"
        borderColor={theme.colors.panelBorder}
        width={Math.min(termWidth - 2, 60)}
      >
        <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
          <Text color={theme.colors.heading} bold>
            Command palette
          </Text>
          <Box marginY={1} flexDirection="column">
            <Box flexDirection="row">
              <Text color={theme.colors.accent} bold>
                &gt;{' '}
              </Text>
              {query ? (
                <Text color={theme.colors.text}>
                  {truncateW(query, Math.max(10, Math.min(termWidth - 2, 60) - 16))}
                </Text>
              ) : (
                <Text color={theme.colors.dim} dimColor>
                  type to filter… (commands & books)
                </Text>
              )}
              <Text color={theme.colors.dim} dimColor>
                {' '}
                ({entries.length})
              </Text>
            </Box>
            <Box marginY={1} flexDirection="column">
              {visible.length === 0 ? (
                <Text color={theme.colors.dim} dimColor>
                  no matching commands or books
                </Text>
              ) : (
                visible.map((entry, i) => (
                  <PaletteRow
                    key={`${entry.kind}-${entry.kind === 'command' ? entry.def.usage : entry.book.id}-${start + i}`}
                    entry={entry}
                    selected={start + i === cursor}
                    theme={theme}
                    width={58}
                  />
                ))
              )}
            </Box>
          </Box>
          <Text color={theme.colors.dim} dimColor>
            type to filter · ↑/↓ move · enter run/open · esc close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function toBookEntry(m: BookMatch): PaletteEntry {
  return { kind: 'book', book: m.book, score: m.score, indices: m.indices };
}

function PaletteRow(props: {
  entry: PaletteEntry;
  selected: boolean;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const { entry, selected, theme, width } = props;
  if (entry.kind === 'command') {
    const { def, indices } = entry;
    const usage = def.usage;
    // Query hits inside the usage string get the accent color; hits in the
    // description are not highlighted (they're still used for ranking).
    const hit = new Set(indices.filter((i) => i < usage.length));
    const label = truncateW(usage, Math.max(10, width - 4));
    const desc = truncateW(def.desc, Math.max(10, width - label.length - 6));
    return (
      <Box flexDirection="row">
        <Marker selected={selected} theme={theme} />
        <Text
          color={selected ? theme.colors.background : theme.colors.text}
          backgroundColor={selected ? theme.colors.selection : undefined}
          bold={selected}
        >
          {label.split('').map((ch, i) => (
            <Text
              key={i}
              color={
                selected
                  ? theme.colors.background
                  : hit.has(i)
                    ? theme.colors.accent
                    : theme.colors.text
              }
              bold={selected || hit.has(i)}
            >
              {ch}
            </Text>
          ))}
        </Text>
        <Text color={theme.colors.dim} dimColor>
          {'  '}
          {desc}
        </Text>
      </Box>
    );
  }
  const { book, indices } = entry;
  // Query hits inside the title get the accent color; hits in the author or
  // genres are not highlighted (still used for ranking), mirroring commands.
  const hit = new Set(indices.filter((i) => i < book.title.length));
  const label = truncateW(book.title, Math.max(10, width - 4));
  const desc = truncateW(
    [book.authorsText || 'Unknown author', book.seriesText].filter(Boolean).join(' · '),
    Math.max(10, width - label.length - 6),
  );
  return (
    <Box flexDirection="row">
      <Marker selected={selected} theme={theme} />
      <Text
        color={selected ? theme.colors.background : theme.colors.text}
        backgroundColor={selected ? theme.colors.selection : undefined}
        bold={selected}
      >
        {label.split('').map((ch, i) => (
          <Text
            key={i}
            color={
              selected
                ? theme.colors.background
                : hit.has(i)
                  ? theme.colors.accent
                  : theme.colors.text
            }
            bold={selected || hit.has(i)}
          >
            {ch}
          </Text>
        ))}
      </Text>
      <Text color={theme.colors.dim} dimColor>
        {'  '}
        {desc}
      </Text>
    </Box>
  );
}

function Marker(props: { selected: boolean; theme: Theme }): React.JSX.Element {
  const { selected, theme } = props;
  return (
    <Text
      color={selected ? theme.colors.background : theme.colors.accent}
      backgroundColor={selected ? theme.colors.accent : undefined}
      bold={selected}
    >
      {' '}
      {selected ? '>' : ' '}{' '}
    </Text>
  );
}
