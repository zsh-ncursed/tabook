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

  if (status.state === 'idle') return <Text color={theme.colors.dim}> </Text>;

  const icon = PLAY_FRAMES[frame];
  const accentColor = status.state === 'error' ? theme.colors.accent : theme.colors.accent;
  // Сообщение ошибки приходит из stderr дочернего процесса: ANSI-коды и
  // переводы строк разрывают экран TUI (raw mode), поэтому берём только
  // первую строку без escape-последовательностей.
  const safeMessage = status.state === 'error' ? sanitizeForTerminal(status.message) : '';
  const text =
    status.state === 'playing'
      ? `${icon} ${status.chunkIndex + 1}/${status.total}`
      : status.state === 'paused'
        ? `‖ ${status.currentChar > 0 ? status.currentChar : ''}`
        : status.state === 'error'
          ? blink
            ? `⏻ ${safeMessage}`
            : `  ${safeMessage}`
          : icon;

  return <Text color={accentColor}>{text}</Text>;
}

/** Вырезать ANSI-коды, control-символы и оставить только первую строку. */
function sanitizeForTerminal(msg: string | undefined): string {
  if (!msg) return '';
  return msg
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // CSI-последовательности
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '') // control chars, кроме \n/\t
    .split('\n')[0]!
    .trim()
    .slice(0, 120);
}
