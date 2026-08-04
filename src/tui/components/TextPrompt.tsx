import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { resolveKeyName } from '../keymap.js';

export interface TextPromptProps {
  theme: Theme;
  prefix: string;
  placeholder?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onValueChange?: (value: string) => void;
}

export function TextPrompt(props: TextPromptProps): React.JSX.Element {
  const {
    theme,
    prefix,
    placeholder,
    initialValue = '',
    onSubmit,
    onCancel,
    onValueChange,
  } = props;
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);
  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useEffect(() => {
    onValueChange?.(initialValue);
  }, [initialValue, onValueChange]);

  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    switch (keyName) {
      case 'escape':
        onCancel();
        return;
      case 'enter':
        onSubmit(valueRef.current);
        return;
      case 'backspace':
      case 'delete':
        if (cursorRef.current > 0) {
          const c = cursorRef.current;
          setValue((v) => v.slice(0, c - 1) + v.slice(c));
          setCursor(c - 1);
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
    if (input && input.length === 1 && !key.ctrl && !key.meta && keyName !== 'space') {
      const c = cursorRef.current;
      const next = valueRef.current.slice(0, c) + input + valueRef.current.slice(c);
      setValue(next);
      setCursor(c + 1);
    }
  });

  useEffect(() => {
    onValueChange?.(value);
  }, [value, onValueChange]);

  const before = value.slice(0, cursor);
  const atCursor = value[cursor] ?? ' ';
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="row">
      <Text color={theme.colors.accent} bold>
        {prefix}
      </Text>
      <Text color={theme.colors.text}>{before}</Text>
      <Text backgroundColor={theme.colors.accent} color={theme.colors.background}>
        {atCursor}
      </Text>
      <Text color={theme.colors.text}>{after}</Text>
      {placeholder && value === '' ? <Text dimColor>{placeholder}</Text> : null}
    </Box>
  );
}
