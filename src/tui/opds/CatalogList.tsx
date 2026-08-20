import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { CatalogRecord } from '../../db/db.js';
import { truncateW } from '../../utils/text.js';

export function CatalogList(props: {
  catalogs: CatalogRecord[];
  cursor: number;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const { catalogs, cursor, theme, width } = props;
  if (catalogs.length === 0) {
    return (
      <Box paddingX={2} paddingY={2} flexDirection="column">
        <Text color={theme.colors.text}>No OPDS catalogs configured.</Text>
        <Text color={theme.colors.dim}>Add one via SQLite or a future :opds add command.</Text>
      </Box>
    );
  }
  const nameW = Math.max(10, width - 40);
  return (
    <Box flexDirection="column" paddingX={1}>
      {catalogs.map((cat, i) => {
        const selected = i === cursor;
        const name = truncateW(cat.name, nameW);
        const url = truncateW(cat.url, 35);
        return (
          <Box key={cat.id} flexDirection="row">
            <Text color={selected ? theme.colors.accent : theme.colors.text} bold={selected}>
              {selected ? '▸ ' : '  '}
            </Text>
            <Text color={selected ? theme.colors.accent : theme.colors.text} bold={selected}>
              {name}
            </Text>
            <Text color={theme.colors.dim}> — {url}</Text>
            {cat.username ? <Text color={theme.colors.dim}> · #</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
