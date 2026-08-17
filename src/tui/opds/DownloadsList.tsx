import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { DownloadJob } from '../../opds/downloadQueue.js';
import { jobPercent } from '../../opds/downloadQueue.js';
import { centeredWindow } from '../listLayout.js';
import { truncateW } from '../../utils/text.js';

export function DownloadsList(props: {
  theme: Theme;
  width: number;
  height: number;
  jobs: DownloadJob[];
  cursor: number;
}): React.JSX.Element {
  const { theme, width, height, jobs, cursor } = props;
  if (jobs.length === 0) {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column">
        <Text color={theme.colors.text}>No downloads.</Text>
        <Text color={theme.colors.dim}>Press d on a book to queue it. esc — close</Text>
      </Box>
    );
  }
  const visibleCount = Math.max(3, height - 6);
  const { start, end } = centeredWindow(jobs.length, cursor, visibleCount);
  const visible = jobs.slice(start, end);
  const titleW = Math.max(10, width - 40);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((job, i) => {
        const absolute = start + i;
        const selected = absolute === cursor;
        const color = selected ? theme.colors.accent : theme.colors.text;
        const status = jobStatusText(job);
        const statusColor =
          job.status === 'done'
            ? theme.colors.link
            : job.status === 'failed'
              ? (theme.colors.error ?? theme.colors.dim)
              : theme.colors.dim;
        return (
          <Box key={job.id} flexDirection="row">
            <Text color={color} bold={selected}>
              {selected ? '▸ ' : '  '}
            </Text>
            <Text color={color} bold={selected}>
              {truncateW(job.title, titleW)}
            </Text>
            <Text color={statusColor}> — {status}</Text>
            {job.error ? <Text color={theme.colors.dim}> ({truncateW(job.error, 30)})</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

function jobStatusText(job: DownloadJob): string {
  switch (job.status) {
    case 'queued':
      return 'queued';
    case 'downloading': {
      const pct = jobPercent(job);
      return pct !== null ? `${pct}%` : 'downloading…';
    }
    case 'done':
      return '✓ done';
    case 'failed':
      return '✗ failed';
    case 'cancelled':
      return 'cancelled';
  }
}
