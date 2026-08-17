import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { truncateW } from '../../utils/text.js';
import { COVER_W } from '../listLayout.js';
import type { BrowsingRow } from './feedRows.js';

export function BrowsingFeedList(props: {
  rows: BrowsingRow[];
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
        const selected = absolute === cursor;
        if (row.kind === 'facet-group') {
          return (
            <Text key={`fg-${absolute}`} color={theme.colors.accent} bold>
              {' '}
              {row.label}
            </Text>
          );
        }
        if (row.kind === 'facet') {
          const label = `${row.facet.active ? '● ' : '  '}${row.facet.title}${row.facet.count ? ` (${row.facet.count})` : ''}`;
          return (
            <Text
              key={`f-${absolute}`}
              color={selected ? theme.colors.accent : theme.colors.dim}
              bold={selected}
            >
              {selected ? '▸ ' : '  '}
              {label}
            </Text>
          );
        }
        const entry = row.entry;
        const textW = Math.max(10, width - COVER_W - 40);
        const title = truncateW(entry.title, textW);
        const author = truncateW(entry.authors[0]?.name ?? 'Unknown author', textW);
        const marker = entry.isAcquisition ? '📚' : '📁';
        const sub = [entry.language, entry.issued, entry.publisher].filter(Boolean).join(' · ');
        return (
          // 3-line card: title, author, language · year · publisher. The
          // text is indented past the cover thumbnail column so the image
          // drawn by imageLayer doesn't overlap it.
          <Box key={`e-${absolute}`} flexDirection="column" paddingLeft={COVER_W + 2}>
            <Text color={selected ? theme.colors.accent : theme.colors.text} bold={selected}>
              {selected ? '▸ ' : '  '}
              {marker} {title}
            </Text>
            <Text color={theme.colors.dim} dimColor>
              {author}
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
