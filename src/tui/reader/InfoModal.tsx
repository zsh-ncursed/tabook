import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTerminalSize } from '../useTerminalSize.js';
import type { Theme } from '../../themes/themes.js';
import type { LibraryDb } from '../../db/db.js';
import type { ReaderSession } from './readerModel.js';
import { Modal } from '../components/Modal.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import type { Config } from '../../config/defaults.js';
import { joinAuthors, formatSeries } from '../../formats/model.js';
import { formatBytes, formatDuration, formatLocalTimestamp, wrapText } from '../../utils/text.js';

export function InfoModal(props: {
  session: ReaderSession;
  db: LibraryDb;
  config: Config;
  theme: Theme;
}): React.JSX.Element {
  const { session, db, config, theme } = props;
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const [termWidth, termHeight] = useTerminalSize();
  const modalWidth = Math.min(termWidth - 2, 80);
  const m = session.book.metadata;
  const stats = session.bookId !== null ? db.getStats(session.bookId) : undefined;
  const hasCover = !!m.coverKey && session.book.resources.has(m.coverKey);
  const textWidth = modalWidth - 5 - (hasCover ? 28 : 0);

  const metaLines: string[] = [
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
    metaLines.push(
      `Reading time: ${formatDuration(stats.totalSeconds)} · Pages read: ${stats.totalPages} · Sessions: ${stats.sessionCount}`,
    );
    if (stats.lastReadAt) metaLines.push(`Last read: ${formatLocalTimestamp(stats.lastReadAt)}`);
  }

  const allLines: string[] = [...metaLines];
  if (m.annotation) {
    allLines.push('');
    allLines.push('__annotation_header__');
    for (const line of wrapText(m.annotation, textWidth)) {
      allLines.push(line);
    }
  }

  const MODAL_CHROME = 8;
  const maxVisible = Math.max(1, termHeight - MODAL_CHROME);
  const maxScroll = Math.max(0, allLines.length - maxVisible);
  const [scroll, setScroll] = useState(0);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visibleLines = allLines.slice(clampedScroll, clampedScroll + maxVisible);

  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    // Scroll through the configurable keymap (j/k, arrows, gg/G, page keys),
    // so rebinds apply here too — same as BookDetail.
    const action = resolver.feed(keyName);
    switch (action) {
      case 'move_cursor_down':
        setScroll((s) => Math.min(s + 3, maxScroll));
        return;
      case 'move_cursor_up':
        setScroll((s) => Math.max(0, s - 3));
        return;
      case 'go_to_start':
        setScroll(0);
        return;
      case 'go_to_end':
        setScroll(maxScroll);
        return;
      case 'page_down':
        setScroll((s) => Math.min(maxScroll, s + Math.max(1, maxVisible - 2)));
        return;
      case 'page_up':
        setScroll((s) => Math.max(0, s - Math.max(1, maxVisible - 2)));
        return;
      default:
        return;
    }
  });

  return (
    <Modal theme={theme} title="Book Info" width={modalWidth} footer="j/k scroll · Esc close">
      <Box flexDirection="row" height={maxVisible}>
        {hasCover ? <Box width={27} /> : null}
        <Box flexDirection="column" flexGrow={1} paddingRight={1}>
          {visibleLines.map((line, i) => {
            if (line === '__annotation_header__') {
              return (
                <Text key={i} color={theme.colors.heading} bold>
                  Annotation
                </Text>
              );
            }
            if (line === '') {
              return <Box key={i} height={1} />;
            }
            return (
              <Text key={i} color={theme.colors.dim} dimColor>
                {line}
              </Text>
            );
          })}
        </Box>
      </Box>
    </Modal>
  );
}
