import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import { KEY_ACTIONS } from '../../config/defaults.js';
import { resolveKeyName, actionLabel } from '../keymap.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { Modal } from '../components/Modal.js';

export interface HelpViewProps {
  config: Config;
  theme: Theme;
  onClose: () => void;
}

export function HelpView(props: HelpViewProps): React.JSX.Element {
  const { config, theme, onClose } = props;
  const [width] = useTerminalSize();

  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'escape') {
      onClose();
    }
  });

  const keysForAction = (action: KeyAction): string[] => {
    const keys: string[] = [];
    for (const [key, a] of Object.entries(config.keybindings)) {
      if (a === action) keys.push(key);
    }
    return keys.sort((x, y) => x.localeCompare(y));
  };

  const rows = KEY_ACTIONS.map((action) => ({
    action,
    label: actionLabel(action),
    keys: keysForAction(action),
  }));

  const colW = Math.max(30, Math.floor((width - 6) / 2));

  return (
    <Modal
      theme={theme}
      title="Help — Keybindings"
      width={Math.min(width - 2, 100)}
      footer="Esc — close"
    >
      <Text color={theme.colors.dim} dimColor>
        All keys can be remapped in config.toml via [keybindings]. Vim-like by default.
      </Text>
      <Box flexDirection="row" marginTop={1} alignItems="flex-start">
        <Box flexDirection="column" width={colW}>
          {rows.slice(0, Math.ceil(rows.length / 2)).map((row) => (
            <HelpRow key={row.action} theme={theme} label={row.label} keys={row.keys} />
          ))}
        </Box>
        <Box flexDirection="column" width={colW}>
          {rows.slice(Math.ceil(rows.length / 2)).map((row) => (
            <HelpRow key={row.action} theme={theme} label={row.label} keys={row.keys} />
          ))}
        </Box>
      </Box>
      <Text color={theme.colors.dim} dimColor>
        Tip: type : to open the command line (try :theme nord, :sort author, :goto 10, :open
        file.fb2).
      </Text>
    </Modal>
  );
}

function HelpRow(props: { theme: Theme; label: string; keys: string[] }): React.JSX.Element {
  const { theme, label, keys } = props;
  const keyText = keys.length > 0 ? keys.join(', ') : '(unbound)';
  return (
    <Box>
      <Box width={30}>
        <Text color={theme.colors.text}>{label}</Text>
      </Box>
      <Text color={theme.colors.accent}>{keyText}</Text>
    </Box>
  );
}
