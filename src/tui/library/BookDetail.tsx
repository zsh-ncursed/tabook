import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { BookRecord } from '../../db/db.js';
import { Modal } from '../components/Modal.js';
import { formatBytes } from '../../utils/text.js';

export interface BookDetailProps {
  book: BookRecord;
  theme: Theme;
  onRead: () => void;
  onClose: () => void;
}

export function BookDetail(props: BookDetailProps): React.JSX.Element {
  const { book, theme, onRead, onClose } = props;

  useInput((input, key) => {
    if (key.return || input === 'o') {
      onRead();
      return;
    }
    if (input === 'q' || key.escape) {
      onClose();
      return;
    }
  });

  const lines: string[] = [];
  if (book.authorsText) lines.push(`Authors: ${book.authorsText}`);
  if (book.seriesText) lines.push(`Series: ${book.seriesText}`);
  if (book.genres.length > 0) lines.push(`Genres: ${book.genres.join(', ')}`);
  const extras: string[] = [];
  if (book.publisher) extras.push(`Publisher: ${book.publisher}`);
  if (book.year) extras.push(`Year: ${book.year}`);
  if (book.isbn) extras.push(`ISBN: ${book.isbn}`);
  if (book.lang) extras.push(`Language: ${book.lang}`);
  if (extras.length > 0) lines.push(extras.join(' · '));
  lines.push(
    `Format: ${book.format.toUpperCase()} · Size: ${formatBytes(book.size)} · Added: ${book.addedAt}`,
  );
  if (book.progressPercent !== null) {
    lines.push(`Progress: ${book.progressPercent}%`);
  }
  if (book.coverKey) {
    lines.push('Cover: available (image display requires a graphical terminal protocol)');
  }

  return (
    <Modal theme={theme} title={book.title} width={72} footer="Enter — read · q — close">
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={i} color={theme.colors.text}>
            {line}
          </Text>
        ))}
        {book.annotation ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.colors.heading} bold>
              Annotation
            </Text>
            <Text color={theme.colors.dim} dimColor>
              {book.annotation}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Modal>
  );
}
