import React, { useRef } from 'react';
import { Box, Text, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import { resolveKeyName } from '../keymap.js';
import { useInputDispatch } from '../useInputDispatch.js';

export interface FolderRemoveConfirmProps {
  theme: Theme;
  path: string;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  isActive: boolean;
}

// :library remove confirmation — y/enter detaches the folder and deletes
// its books (progress/bookmarks included), n/esc cancels. Mirrors the
// DeleteConfirm pattern used for single books in LibraryView.
export function FolderRemoveConfirm(props: FolderRemoveConfirmProps): React.JSX.Element {
  const { theme, path, count, onConfirm, onCancel, isActive } = props;
  const ref = useRef({ onConfirm, onCancel });
  ref.current = { onConfirm, onCancel };
  const dispatchRef = useInputDispatch(isActive);
  dispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'y' || keyName === 'enter') {
      ref.current.onConfirm();
      return;
    }
    if (keyName === 'n' || keyName === 'escape') {
      ref.current.onCancel();
    }
  };
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.colors.error} bold>
        Detach "{path}"? {count} book
        {count === 1 ? '' : 's'} with reading progress will be removed (y/N · esc cancel)
      </Text>
      <Text color={theme.colors.dim} dimColor>
        Files on disk are untouched; re-attaching the folder re-imports the books.
      </Text>
    </Box>
  );
}
