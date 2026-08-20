import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { resolveKeyName } from '../keymap.js';
import { wasMouseChunkRecent } from '../mouse.js';
import { splitChars } from '../../utils/text.js';
import { execSync } from 'node:child_process';

export interface TextPromptProps {
  theme: Theme;
  prefix: string;
  placeholder?: string;
  initialValue?: string;
  /** When true the typed value is rendered as dots (for passwords). */
  secret?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onValueChange?: (value: string) => void;
  historyKey?: string;
  onTab?: (currentValue: string) => string | null;
  /** Returns the length of the typed value prefix that is "valid" (e.g.
   * matches a known command name). The valid prefix is rendered with the
   * accent color, the invalid tail with the normal text color. */
  validPrefixLength?: (value: string) => number;
}

const HISTORY_MAX = 50;
const histories = new Map<string, string[]>();

function readClipboard(): string {
  try {
    if (process.env.WAYLAND_DISPLAY) {
      return execSync('wl-paste --no-newline 2>/dev/null || wl-paste 2>/dev/null', {
        encoding: 'utf8',
      }).trimEnd();
    }
    if (process.env.DISPLAY) {
      return execSync(
        'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null',
        { encoding: 'utf8' },
      ).trimEnd();
    }
  } catch {
    // clipboard tool not available
  }
  return '';
}

function getHistory(key: string): string[] {
  return histories.get(key) ?? [];
}

function pushHistory(key: string, value: string): void {
  const arr = getHistory(key);
  if (arr[arr.length - 1] !== value) {
    arr.push(value);
    if (arr.length > HISTORY_MAX) arr.shift();
  }
  histories.set(key, arr);
}

export function TextPrompt(props: TextPromptProps): React.JSX.Element {
  const {
    theme,
    prefix,
    placeholder,
    initialValue = '',
    secret = false,
    onSubmit,
    onCancel,
    onValueChange,
    historyKey,
    onTab,
    validPrefixLength,
  } = props;
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);
  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const historyIdxRef = useRef<number>(-1);

  useEffect(() => {
    historyIdxRef.current = -1;
  }, [historyKey]);

  useInput((input, key) => {
    // A mouse click while the prompt is open would otherwise type the bogus
    // '[' keypress Ink derives from the SGR chunk (see mouse.ts).
    if (wasMouseChunkRecent()) return;
    const keyName = resolveKeyName(input, key);
    switch (keyName) {
      case 'escape':
        onCancel();
        return;
      case 'enter':
        if (historyKey && valueRef.current.trim() !== '') {
          pushHistory(historyKey, valueRef.current);
        }
        onSubmit(valueRef.current);
        return;
      case 'up':
        if (historyKey) {
          const hist = getHistory(historyKey);
          if (hist.length > 0) {
            const nextIdx =
              historyIdxRef.current === -1
                ? hist.length - 1
                : Math.max(0, historyIdxRef.current - 1);
            historyIdxRef.current = nextIdx;
            setValue(hist[nextIdx]!);
            setCursor(hist[nextIdx]!.length);
          }
        }
        return;
      case 'down':
        if (historyKey) {
          const hist = getHistory(historyKey);
          if (hist.length > 0 && historyIdxRef.current !== -1) {
            const nextIdx = historyIdxRef.current + 1;
            if (nextIdx >= hist.length) {
              historyIdxRef.current = -1;
              setValue('');
              setCursor(0);
            } else {
              historyIdxRef.current = nextIdx;
              setValue(hist[nextIdx]!);
              setCursor(hist[nextIdx]!.length);
            }
          }
        }
        return;
      case 'backspace':
      case 'delete':
        if (cursorRef.current > 0) {
          const c = cursorRef.current;
          setValue((v) => v.slice(0, c - 1) + v.slice(c));
          setCursor(c - 1);
        }
        return;
      case 'tab':
        if (onTab) {
          const completed = onTab(valueRef.current);
          if (completed !== null) {
            setValue(completed);
            setCursor(completed.length);
          }
        }
        return;
      case 'left':
        setCursor((c) => Math.max(0, c - 1));
        return;
      case 'right':
        setCursor((c) => Math.min(valueRef.current.length, c + 1));
        return;
      case 'home':
      case 'ctrl+a':
        setCursor(0);
        return;
      case 'end':
      case 'ctrl+e':
        setCursor(valueRef.current.length);
        return;
      case 'ctrl+v': {
        // Read clipboard via system tool — terminal raw mode intercepts
        // Ctrl+Shift+V, so we read the clipboard directly.
        const clip = readClipboard();
        if (clip) {
          const c = cursorRef.current;
          const next = valueRef.current.slice(0, c) + clip + valueRef.current.slice(c);
          setValue(next);
          setCursor(c + clip.length);
        }
        return;
      }
      case 'ctrl+u':
        setValue('');
        setCursor(0);
        return;
      case 'ctrl+w': {
        const c = cursorRef.current;
        const before = valueRef.current.slice(0, c);
        const trimmed = before.replace(/\s*\S*$/, '');
        const newValue = trimmed + valueRef.current.slice(c);
        setValue(newValue);
        setCursor(trimmed.length);
        return;
      }
      default:
        break;
    }
    // Multi-char input = terminal paste (bracketed paste or clipboard).
    // Insert the whole block at the cursor so paths from the clipboard work.
    if (input && input.length > 1 && !key.ctrl && !key.meta) {
      const c = cursorRef.current;
      const next = valueRef.current.slice(0, c) + input + valueRef.current.slice(c);
      setValue(next);
      setCursor(c + input.length);
      return;
    }
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      const c = cursorRef.current;
      const next = valueRef.current.slice(0, c) + input + valueRef.current.slice(c);
      setValue(next);
      setCursor(c + 1);
    }
  });

  // Notify the parent of value changes, but skip the initial mount so a
  // freshly-opened prompt doesn't double-fire onValueChange (once from the
  // initialValue effect, once from the value effect). The parent's debounce
  // handles the rest.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    onValueChange?.(value);
  }, [value, onValueChange]);

  const rendered = secret ? '\u2022'.repeat(value.length) : value;
  const validLen = validPrefixLength && !secret ? validPrefixLength(value) : 0;
  const chars = splitChars(rendered);
  const atCursor = chars[cursor] ?? ' ';
  const before = chars.slice(0, cursor).join('');
  const after = chars.slice(cursor + 1).join('');
  const colorAt = (index: number): string =>
    index < validLen ? theme.colors.accent : theme.colors.text;

  return (
    <Box flexDirection="row">
      <Text color={theme.colors.accent} bold>
        {prefix}
      </Text>
      {before.length > 0 ? (
        <Text>
          {splitChars(before).map((ch, i) => (
            <Text key={i} color={colorAt(i)}>
              {ch}
            </Text>
          ))}
        </Text>
      ) : null}
      <Text backgroundColor={theme.colors.accent} color={theme.colors.background}>
        {atCursor}
      </Text>
      {after.length > 0 ? (
        <Text>
          {splitChars(after).map((ch, i) => (
            <Text key={i} color={colorAt(cursor + 1 + i)}>
              {ch}
            </Text>
          ))}
        </Text>
      ) : null}
      {placeholder && value === '' ? <Text dimColor>{placeholder}</Text> : null}
    </Box>
  );
}
