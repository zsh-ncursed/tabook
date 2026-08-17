import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { CommandScreen } from '../commands.js';
import { commandExecutable, fuzzyMatchCommands, type CommandMatch } from '../commands.js';
import { resolveKeyName } from '../keymap.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { centeredWindow } from '../listLayout.js';
import { truncateW } from '../../utils/text.js';

export interface CommandPaletteProps {
  theme: Theme;
  /** Which screen is active; only commands valid there are offered. */
  screen: CommandScreen;
  /** Run a command line, e.g. ':theme nord' (the : prefix is included). */
  onRun: (text: string) => void;
  onClose: () => void;
}

// Command palette overlay (Ctrl+P): type to fuzzy-filter the command registry,
// ↑/↓ (or Ctrl+N/P) move, enter runs the highlighted command, esc closes.
// j/k deliberately type into the query — descriptions contain those letters
// (e.g. ":goto — Jump to a page"), so navigation stays on the arrows.
export function CommandPalette(props: CommandPaletteProps): React.JSX.Element {
  const { theme, screen, onRun, onClose } = props;
  const [, height] = useTerminalSize();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const callbacksRef = useRef({ onRun, onClose });
  callbacksRef.current = { onRun, onClose };

  const matches = useMemo(() => fuzzyMatchCommands(query, screen), [query, screen]);
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  // Keep the cursor inside the (possibly shrinking) match list.
  useEffect(() => {
    if (cursor >= matches.length) setCursor(Math.max(0, matches.length - 1));
  }, [matches.length, cursor]);

  const dispatchRef = useInputDispatch(true);
  dispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'escape') {
      callbacksRef.current.onClose();
      return;
    }
    if (keyName === 'enter') {
      const m = matchesRef.current[cursorRef.current];
      if (m) callbacksRef.current.onRun(commandExecutable(m.def));
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
      setCursor((c) => Math.min(Math.max(0, matchesRef.current.length - 1), c + 1));
      return;
    }
    if (input && input.length > 0 && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setCursor(0);
    }
  };

  const visibleCount = Math.min(12, Math.max(3, height - 8));
  const { start, end } = centeredWindow(matches.length, cursor, visibleCount);
  const visible = matches.slice(start, end);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={theme.colors.panelBorder} width={60}>
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
                <Text color={theme.colors.text}>{truncateW(query, 44)}</Text>
              ) : (
                <Text color={theme.colors.dim} dimColor>
                  type to filter…
                </Text>
              )}
              <Text color={theme.colors.dim} dimColor>
                {' '}
                ({matches.length})
              </Text>
            </Box>
            <Box marginY={1} flexDirection="column">
              {visible.length === 0 ? (
                <Text color={theme.colors.dim} dimColor>
                  no matching commands
                </Text>
              ) : (
                visible.map((m, i) => (
                  <PaletteRow
                    key={`${m.def.usage}-${start + i}`}
                    match={m}
                    selected={start + i === cursor}
                    theme={theme}
                    width={58}
                  />
                ))
              )}
            </Box>
          </Box>
          <Text color={theme.colors.dim} dimColor>
            type to filter · ↑/↓ move · enter run · esc close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function PaletteRow(props: {
  match: CommandMatch;
  selected: boolean;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const { match, selected, theme, width } = props;
  const { def, indices } = match;
  const usage = def.usage;
  // Query hits inside the usage string get the accent color; hits in the
  // description are not highlighted (they're still used for ranking).
  const hit = new Set(indices.filter((i) => i < usage.length));
  const label = truncateW(usage, Math.max(10, width - 4));
  const desc = truncateW(def.desc, Math.max(10, width - label.length - 6));
  return (
    <Box flexDirection="row">
      <Text
        color={selected ? theme.colors.background : theme.colors.accent}
        backgroundColor={selected ? theme.colors.accent : undefined}
        bold={selected}
      >
        {' '}
        {selected ? '>' : ' '}{' '}
      </Text>
      <Text
        color={selected ? theme.colors.background : theme.colors.text}
        backgroundColor={selected ? theme.colors.accent : undefined}
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
