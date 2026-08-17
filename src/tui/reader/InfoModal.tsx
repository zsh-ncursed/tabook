import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { LibraryDb } from '../../db/db.js';
import type { ReaderSession } from './readerModel.js';
import { Modal } from '../components/Modal.js';
import { joinAuthors, formatSeries } from '../../formats/model.js';
import { formatBytes, formatLocalTimestamp } from '../../utils/text.js';

export function InfoModal(props: {
  session: ReaderSession;
  db: LibraryDb;
  theme: Theme;
}): React.JSX.Element {
  const { session, db, theme } = props;
  const m = session.book.metadata;
  const stats = session.bookId !== null ? db.getStats(session.bookId) : undefined;
  const lines: string[] = [
    `Title: ${m.title}`,
    `Authors: ${joinAuthors(m.authors) || '—'}`,
    m.series ? `Series: ${formatSeries(m.series)}` : null,
    `Genres: ${m.genres.length > 0 ? m.genres.join(', ') : '—'}`,
    `Language: ${m.lang ?? '—'}`,
    m.publisher ? `Publisher: ${m.publisher}` : null,
    m.isbn ? `ISBN: ${m.isbn}` : null,
    m.year ? `Year: ${m.year}` : null,
    `Format: ${session.book.format.toUpperCase()} · Size: ${formatBytes(session.book.size)}`,
    `Progress: ${session.percent()}%`,
  ].filter((l): l is string => l !== null);
  if (stats) {
    lines.push(
      `Reading time: ${formatDuration(stats.totalSeconds)} · Pages read: ${stats.totalPages} · Sessions: ${stats.sessionCount}`,
    );
    if (stats.lastReadAt) lines.push(`Last read: ${formatLocalTimestamp(stats.lastReadAt)}`);
  }
  const hasCover = !!m.coverKey && session.book.resources.has(m.coverKey);
  return (
    <Modal theme={theme} title="Book Info" width={80} footer="Esc — close">
      <Box flexDirection="row">
        {hasCover ? <Box width={27} /> : null}
        <Box flexDirection="column" flexGrow={1} paddingRight={1}>
          {lines.map((line, i) => (
            <Text key={i} color={theme.colors.text}>
              {line}
            </Text>
          ))}
          {m.annotation ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={theme.colors.heading} bold>
                Annotation
              </Text>
              <Text color={theme.colors.dim} dimColor>
                {m.annotation}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Modal>
  );
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
