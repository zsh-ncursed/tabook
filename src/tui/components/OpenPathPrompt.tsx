import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { TextPrompt } from './TextPrompt.js';

export interface OpenPathPromptProps {
  theme: Theme;
  onOpen: (path: string) => void;
  onCancel: () => void;
}

// Fallback path prompt shown when the file picker is unavailable: type a
// path to a .fb2 / .fb2.zip / .epub file.
export function OpenPathPrompt(props: OpenPathPromptProps): React.JSX.Element {
  const { theme, onOpen, onCancel } = props;
  return (
    <Box paddingX={1} flexDirection="column">
      <TextPrompt
        theme={theme}
        prefix="open: "
        placeholder="path to .fb2 / .fb2.zip / .epub file"
        historyKey="open"
        onSubmit={(value) => {
          const p = value.trim();
          if (p) onOpen(p);
          else onCancel();
        }}
        onCancel={onCancel}
      />
      <Text color={theme.colors.dim} dimColor>
        Ctrl+V — paste from clipboard · esc — cancel
      </Text>
    </Box>
  );
}
