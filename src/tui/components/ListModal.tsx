import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
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
  cursor: number;
  width?: number;
  height?: number;
  footer?: string;
  onNavigate?: (item: ListModalItem) => void;
}

// Presentational-only modal. Input dispatch is owned by the parent
// (ReaderView's single useInput) to avoid Ink's setRawMode reference-count
// race that swallowed Esc on reopen. cursor is passed in as a prop.
export function ListModal(props: ListModalProps): React.JSX.Element {
  const { theme, title, items, cursor, footer } = props;
  const width = props.width ?? 70;
  const height = Math.min(props.height ?? items.length, Math.max(6, items.length));

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
