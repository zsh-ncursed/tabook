import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { TtsStatus } from '../../tts/types.js';

// Брайль-символы для каждого состояния и направления.
const PLAY_FRAMES = ['⠸', '⠴', '⠦', '⠧', '⠇', '⠏', '⠋', '⠙'];
const INTERVAL_MS = 80;

interface TtsIndicatorProps {
  status: TtsStatus;
  theme: Theme;
}

/** Компактный индикатор TTS-состояния: брайль-спиннер + позиция/ошибка. */
export function TtsIndicator({ status, theme }: TtsIndicatorProps): React.JSX.Element | null {
  const [frame, setFrame] = useState(0);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (status.state === 'idle') return;
    const id = setInterval(() => setFrame((f) => (f + 1) % PLAY_FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [status.state]);

  // Blink для ошибок
  useEffect(() => {
    if (status.state !== 'error') {
      setBlink(false);
      return;
    }
    const id = setInterval(() => setBlink((b) => !b), 400);
    return () => clearInterval(id);
  }, [status.state]);

  if (status.state === 'idle') return <Text color={theme.colors.dim}>  </Text>;

  const icon = PLAY_FRAMES[frame];
  const accentColor = status.state === 'error' ? theme.colors.accent : theme.colors.accent;
  const text = status.state === 'playing'
    ? `${icon} ${status.chunkIndex + 1}/${status.total}`
    : status.state === 'paused'
    ? `‖ ${status.currentChar > 0 ? status.currentChar : ''}`
    : status.state === 'error'
    ? blink ? `⏻ ${status.message}` : `  ${status.message}`
    : icon;

  return <Text color={accentColor}>{text}</Text>;
}