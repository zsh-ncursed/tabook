import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import type { Theme } from '../../themes/themes.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export function Spinner({
  label,
  theme,
}: {
  label: string;
  theme: Theme;
}): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <Text color={theme.colors.accent}>
      {FRAMES[frame]} {label}
    </Text>
  );
}