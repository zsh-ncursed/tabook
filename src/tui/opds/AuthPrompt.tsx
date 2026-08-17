import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { TextPrompt } from '../components/TextPrompt.js';

// Auth flow prompt (HTTP 401): username stage first, then the password stage.
// The submit handlers live in OpdsView; this component is purely presentational.
export function AuthPrompt(props: {
  stage: 'username' | 'password';
  catalogName: string;
  username: string;
  theme: Theme;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { stage, catalogName, username, theme, onUsername, onPassword, onCancel } = props;
  if (stage === 'username') {
    return (
      <Box paddingX={1} flexDirection="column">
        <Text color={theme.colors.accent} bold>
          Authentication required (HTTP 401)
        </Text>
        <Text color={theme.colors.dim}>Catalog: {catalogName}</Text>
        <TextPrompt
          theme={theme}
          prefix="username: "
          placeholder="username"
          initialValue={username}
          onSubmit={onUsername}
          onCancel={onCancel}
        />
      </Box>
    );
  }
  return (
    <Box paddingX={1} flexDirection="column">
      <Text color={theme.colors.accent} bold>
        Password for {username}
      </Text>
      <TextPrompt
        theme={theme}
        prefix="password: "
        placeholder="password (leave empty for none)"
        secret
        onSubmit={onPassword}
        onCancel={onCancel}
      />
    </Box>
  );
}
