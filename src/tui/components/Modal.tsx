import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';

export function Modal(props: {
  theme: Theme;
  title: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.JSX.Element {
  const { theme, title, children, footer } = props;
  return (
    <Box flexDirection="column" alignSelf="center">
      <Box borderStyle="round" borderColor={theme.colors.panelBorder} width={props.width ?? 60}>
        <Box flexDirection="column" width="100%" paddingX={1} paddingY={1}>
          <Text color={theme.colors.heading} bold>
            {title}
          </Text>
          <Box marginY={1} flexDirection="column">
            {children}
          </Box>
          {footer ? (
            <Text color={theme.colors.dim} dimColor>
              {footer}
            </Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
