import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { resolveKeyName } from '../keymap.js';
import { displayWidth } from '../../utils/text.js';

export interface ListModalItem {
  id: string | number;
  label: string;
  detail?: string;
  accent?: boolean;
}

export interface ListModalProps {
  theme: Theme;
  title: string;
  items: ListModalItem[];
  width?: number;
  height?: number;
  footer?: string;
  onSelect: (item: ListModalItem) => void;
  onClose: () => void;
  onDelete?: (item: ListModalItem) => void;
  onEdit?: (item: ListModalItem) => void;
  onFilter?: () => void;
  onNavigate?: (item: ListModalItem) => void;
}

export function ListModal(props: ListModalProps): React.JSX.Element {
  const { theme, title, items, onSelect, onClose, onDelete, onEdit, onFilter, onNavigate, footer } = props;
  const [cursor, setCursor] = useState(0);
  const width = props.width ?? 70;
  const height = Math.min(props.height ?? items.length, Math.max(6, items.length));

  const moveCursor = useCallback((next: number): void => {
    setCursor(next);
    if (onNavigate && items[next]) onNavigate(items[next]!);
  }, [items, onNavigate]);

  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    switch (keyName) {
      case 'q':
      case 'escape':
        onClose();
        return;
      case 'j':
      case 'down':
        moveCursor(Math.min(items.length - 1, cursor + 1));
        return;
      case 'k':
      case 'up':
        moveCursor(Math.max(0, cursor - 1));
        return;
      case 'gg':
        moveCursor(0);
        return;
      case 'G':
        moveCursor(items.length - 1);
        return;
      case 'enter':
      case 'space':
        if (items.length > 0) onSelect(items[cursor]!);
        return;
      case 'd':
      case 'x':
        if (onDelete && items.length > 0) onDelete(items[cursor]!);
        return;
      case 'e':
        if (onEdit && items.length > 0) onEdit(items[cursor]!);
        return;
      case '/':
        if (onFilter) onFilter();
        return;
      default:
        break;
    }
  });

  const visible = items.slice(
    Math.max(0, Math.min(cursor - Math.floor(height / 2), items.length - height)),
    Math.max(0, Math.min(cursor - Math.floor(height / 2), items.length - height)) + height,
  );
  const startIdx = Math.max(0, Math.min(cursor - Math.floor(height / 2), items.length - height));

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={theme.colors.panelBorder} width={width}>
        <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
          <Text color={theme.colors.heading} bold>
            {title}
          </Text>
          <Box marginY={1} flexDirection="column" width={width - 6}>
            {visible.map((item, i) => {
              const idx = startIdx + i;
              const selected = idx === cursor;
              const label = truncateW(item.label, width - 10);
              const detail = item.detail ? truncateW(item.detail, Math.max(10, width - 30)) : '';
              return (
                <Box key={item.id}>
                  <Text
                    color={selected ? theme.colors.background : theme.colors.text}
                    backgroundColor={selected ? theme.colors.accent : undefined}
                    bold={item.accent && !selected}
                  >
                    {' '}
                    {selected ? '>' : ' '} {label}
                  </Text>
                  {detail ? (
                    <Text color={theme.colors.dim} dimColor>
                      {'  '}
                      {detail}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
          <Text color={theme.colors.dim} dimColor>
            {footer ?? 'j/k move · enter select · q close'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
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
