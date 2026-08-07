import React, { useCallback, useRef, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { resolveKeyName } from '../keymap.js';
import { truncateW } from '../../utils/text.js';

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
  isActive?: boolean;
  onSelect: (item: ListModalItem) => void;
  onClose: () => void;
  onDelete?: (item: ListModalItem) => void;
  onEdit?: (item: ListModalItem) => void;
  onFilter?: () => void;
  onNavigate?: (item: ListModalItem) => void;
}

export function ListModal(props: ListModalProps): React.JSX.Element {
  const {
    theme,
    title,
    items,
    onSelect,
    onClose,
    onDelete,
    onEdit,
    onFilter,
    onNavigate,
    footer,
    isActive = true,
  } = props;
  const [cursor, setCursor] = useState(0);
  const width = props.width ?? 70;
  const height = Math.min(props.height ?? items.length, Math.max(6, items.length));

  const moveCursor = useCallback(
    (next: number): void => {
      setCursor(next);
      if (onNavigate && items[next]) onNavigate(items[next]!);
    },
    [items, onNavigate],
  );

  // Keep the latest props/state in a ref so the useInput handler can stay
  // referentially stable. Ink's useInput re-subscribes on every handler
  // identity change (useEffect deps include inputHandler), and an inline
  // arrow function causes an unsubscribe/resubscribe on every cursor move —
  // which races with Esc delivery and loses the keypress. A stable handler
  // backed by a ref avoids that race entirely.
  const stateRef = useRef({
    cursor,
    items,
    onClose,
    onSelect,
    onDelete,
    onEdit,
    onFilter,
    moveCursor,
  });
  stateRef.current = { cursor, items, onClose, onSelect, onDelete, onEdit, onFilter, moveCursor };

  const handleInput = useCallback((input: string, key: Key) => {
    const s = stateRef.current;
    const keyName = resolveKeyName(input, key);
    switch (keyName) {
      case 'escape':
        s.onClose();
        return;
      case 'j':
      case 'down':
        s.moveCursor(Math.min(s.items.length - 1, s.cursor + 1));
        return;
      case 'k':
      case 'up':
        s.moveCursor(Math.max(0, s.cursor - 1));
        return;
      case 'gg':
        s.moveCursor(0);
        return;
      case 'G':
        s.moveCursor(s.items.length - 1);
        return;
      case 'enter':
      case 'space':
        if (s.items.length > 0) s.onSelect(s.items[s.cursor]!);
        return;
      case 'd':
      case 'x':
        if (s.onDelete && s.items.length > 0) s.onDelete(s.items[s.cursor]!);
        return;
      case 'e':
        if (s.onEdit && s.items.length > 0) s.onEdit(s.items[s.cursor]!);
        return;
      case '/':
        if (s.onFilter) s.onFilter();
        return;
      default:
        break;
    }
  }, []);

  useInput(handleInput, { isActive });

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
            {footer ?? 'j/k move · enter select · esc close'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
