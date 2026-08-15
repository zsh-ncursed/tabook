import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { StatusBarConfig, StatusBarSection } from '../../config/defaults.js';

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
}): React.JSX.Element {
  const { theme, statusbar, data } = props;
  const showBar = statusbar.showProgressBar && data.percent !== undefined && data.percent >= 0;
  const left = statusbar.left
    .map((s) => renderSection(s, data, showBar))
    .filter((s): s is string => s !== null);
  const right = statusbar.right
    .map((s) => renderSection(s, data, showBar))
    .filter((s): s is string => s !== null);
  const hint = right.join(' · ');
  const barWidth = 10;
  return (
    <Box>
      <Text backgroundColor={theme.colors.statusBar} color={theme.colors.statusBarText}>
        {' '}
        {left.join(' · ')}
        {hint ? <Text color={theme.colors.dim}> · {hint}</Text> : null}{' '}
        {showBar ? (
          <Text color={theme.colors.accent}>
            {progressBar(data.percent ?? 0, barWidth)} {data.percent}%
          </Text>
        ) : null}{' '}
      </Text>
    </Box>
  );
}
