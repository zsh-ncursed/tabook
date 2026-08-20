import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { StatusBarConfig, StatusBarSection } from '../../config/defaults.js';
import { truncateW } from '../../utils/text.js';

function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

// Structured data a view supplies for the status bar. Which sections actually
// render — and on which side — is decided by the [statusbar] config.
export interface StatusBarData {
  title?: string;
  page?: number; // 1-based current page
  totalPages?: number;
  percent?: number; // reading progress 0-100
  search?: string; // active search query
  hint?: string; // context-aware key hints
  downloads?: string; // active OPDS download status (e.g. "↓ 45% Title")
  /** Temporary notification — shown in place of the hint while active. */
  message?: string;
}

function renderSection(
  section: StatusBarSection,
  data: StatusBarData,
  showBar: boolean,
): string | null {
  switch (section) {
    case 'title':
      return data.title ?? null;
    case 'page':
      if (data.page === undefined) return null;
      return data.totalPages !== undefined ? `p.${data.page}/${data.totalPages}` : `p.${data.page}`;
    case 'percent':
      // The progress bar already shows the percentage — don't duplicate it.
      return showBar ? null : data.percent !== undefined ? `${data.percent}%` : null;
    case 'search':
      return data.search ?? null;
    case 'hint':
      return data.hint ?? null;
    case 'downloads':
      return data.downloads ?? null;
  }
}

export function StatusBar(props: {
  theme: Theme;
  statusbar: StatusBarConfig;
  data: StatusBarData;
  /** Terminal width; when provided the hint is truncated to prevent wrap. */
  width?: number;
}): React.JSX.Element {
  const { theme, statusbar, data, width: termWidth } = props;
  const showBar = statusbar.showProgressBar && data.percent !== undefined && data.percent >= 0;
  const left = statusbar.left
    .map((s) => renderSection(s, data, showBar))
    .filter((s): s is string => s !== null);
  // Core sections (page/percent/search/downloads) always render; the hint is
  // the only section that yields to a transient message, so a notification
  // never hides the reading position.
  const rightCore = statusbar.right
    .filter((s) => s !== 'hint')
    .map((s) => renderSection(s, data, showBar))
    .filter((s): s is string => s !== null);
  const hintRaw = data.message ?? (statusbar.right.includes('hint') ? data.hint : null);
  const barWidth = 10;
  // Padding: 2 spaces (lead + trail) + optional progress bar + percentage
  const barSpace = showBar ? barWidth + 6 : 0; // '█░...' + ' XX%'
  const leftStr = left.join(' · ');
  const coreStr = rightCore.join(' · ');
  // Available width for hint = total - left - core - separators - bar - padding
  const separatorWidth = (leftStr.length > 0 ? 3 : 0) + (coreStr.length > 0 ? 3 : 0);
  const hintMax = termWidth
    ? Math.max(0, termWidth - 2 - leftStr.length - coreStr.length - separatorWidth - barSpace)
    : undefined;
  const hint =
    hintMax !== undefined && hintRaw && hintRaw.length > hintMax
      ? truncateW(hintRaw, Math.max(0, hintMax))
      : hintRaw;
  return (
    <Box>
      <Text backgroundColor={theme.colors.statusBar} color={theme.colors.statusBarText}>
        {' '}
        {leftStr}
        {coreStr ? <Text color={theme.colors.dim}> · {coreStr}</Text> : null}
        {hint ? (
          <Text color={data.message ? theme.colors.accent : theme.colors.dim}> · {hint}</Text>
        ) : null}{' '}
        {showBar ? (
          <Text color={theme.colors.accent}>
            {progressBar(data.percent ?? 0, barWidth)} {data.percent}%
          </Text>
        ) : null}{' '}
      </Text>
    </Box>
  );
}
