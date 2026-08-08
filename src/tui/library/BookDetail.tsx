import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { BookRecord } from '../../db/db.js';
import { Modal } from '../components/Modal.js';
import { formatBytes } from '../../utils/text.js';
import { imageLayer } from '../imageLayer.js';
import { parseBookFile } from '../../formats/index.js';

export interface BookDetailProps {
  book: BookRecord;
  theme: Theme;
  onRead: () => void;
  onClose: () => void;
}

export function BookDetail(props: BookDetailProps): React.JSX.Element {
  const { book, theme, onRead, onClose } = props;
  const hasCover = !!book.coverKey;

  // Load cover bytes from the book file so ueberzugpp can draw it. parseBookFile
  // is synchronous and reads the whole file — acceptable here because it only
  // runs when the detail modal is open, not on every keystroke.
  const [coverData, setCoverData] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!hasCover || !book.coverKey) {
      setCoverData(null);
      return;
    }
    try {
      const parsed = parseBookFile(book.path);
      setCoverData(parsed.resources.get(book.coverKey) ?? null);
    } catch {
      setCoverData(null);
    }
  }, [book.path, book.coverKey, hasCover]);

  // Draw/clear the cover overlay while the modal is open.
  useEffect(() => {
    if (hasCover && coverData && coverData.length > 0 && book.coverKey) {
      if (!imageLayer.start()) return;
      const res = new Map<string, Uint8Array>();
      res.set(book.coverKey, coverData);
      imageLayer.update(
        [{ identifier: 'cover', x: 2, y: 5, width: 16, height: 14, src: book.coverKey }],
        res,
      );
    } else {
      imageLayer.clear();
    }
    return () => imageLayer.clear();
  }, [hasCover, coverData, book.coverKey]);

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

  const showCoverColumn = hasCover && coverData && coverData.length > 0;

  return (
    <Modal theme={theme} title={book.title} width={80} footer="Enter — read · q — close">
      <Box flexDirection="row">
        {showCoverColumn ? <Box width={27} /> : null}
        <Box flexDirection="column" flexGrow={1} paddingRight={1}>
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
      </Box>
    </Modal>
  );
}
