import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';

export function StatusBar(props: {
  theme: Theme;
  left: string;
  right?: string;
  message?: string;
}): React.JSX.Element {
  const { theme, left, right, message } = props;
  const hint = message ? message : (right ?? '');
  return (
    <Box>
      <Text backgroundColor={theme.colors.statusBar} color={theme.colors.statusBarText}>
        {' '}
        {left}
        {hint ? (
          <Text color={message ? theme.colors.accent : theme.colors.dim}> · {hint}</Text>
        ) : null}{' '}
      </Text>
    </Box>
  );
}
