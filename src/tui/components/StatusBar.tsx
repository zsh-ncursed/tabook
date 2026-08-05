import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';

function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

export function StatusBar(props: {
  theme: Theme;
  left: string;
  right?: string;
  message?: string;
  progress?: number;
}): React.JSX.Element {
  const { theme, left, right, message, progress } = props;
  const hint = message ? message : (right ?? '');
  const showBar = progress !== undefined && progress >= 0;
  const barWidth = 10;
  return (
    <Box>
      <Text backgroundColor={theme.colors.statusBar} color={theme.colors.statusBarText}>
        {' '}
        {left}
        {hint ? (
          <Text color={message ? theme.colors.accent : theme.colors.dim}> · {hint}</Text>
        ) : null}{' '}
        {showBar ? (
          <Text color={theme.colors.accent}>
            {progressBar(progress ?? 0, barWidth)} {progress ?? 0}%
          </Text>
        ) : null}{' '}
      </Text>
    </Box>
  );
}
