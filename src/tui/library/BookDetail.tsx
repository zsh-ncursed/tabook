import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { BookRecord } from '../../db/db.js';
import { Modal } from '../components/Modal.js';
import { formatBytes, truncate } from '../../utils/text.js';
import { imageLayer } from '../imageLayer.js';
import { forceRedraw } from '../screenRefresh.js';
import { parseBookFile } from '../../formats/index.js';

export interface BookDetailProps {
  book: BookRecord;
  theme: Theme;
  onRead: () => void;
  onClose: () => void;
}

// Modal chrome: border-top(1) + paddingY-top(1) + title(1) + marginY(1) +
// footer(1) + marginY(1) + paddingY-bottom(1) + border-bottom(1) = 8
const MODAL_CHROME = 8;
// Text column: modal 80 - border(2) - paddingX(2) - cover spacer(27) - right padding(1) = 48
const TEXT_WIDTH = 48;

function wrapText(text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (line === '') {
        line = word;
      } else if (line.length + 1 + word.length <= maxW) {
        line += ' ' + word;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function BookDetail(props: BookDetailProps): React.JSX.Element {
  const { book, theme, onRead, onClose } = props;
  const { stdout } = useStdout();
  const termHeight = stdout.rows ?? 24;
  const hasCover = !!book.coverKey;

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

  // Build all text lines: metadata + wrapped annotation.
  const metaLines: string[] = [];
  if (book.authorsText) metaLines.push(`Authors: ${book.authorsText}`);
  if (book.seriesText) metaLines.push(`Series: ${book.seriesText}`);
  if (book.genres.length > 0) metaLines.push(`Genres: ${book.genres.join(', ')}`);
  const extras: string[] = [];
  if (book.publisher) extras.push(`Publisher: ${book.publisher}`);
  if (book.year) extras.push(`Year: ${book.year}`);
  if (book.isbn) extras.push(`ISBN: ${book.isbn}`);
  if (book.lang) extras.push(`Language: ${book.lang}`);
  if (extras.length > 0) metaLines.push(extras.join(' · '));
  metaLines.push(
    `Format: ${book.format.toUpperCase()} · Size: ${formatBytes(book.size)} · Added: ${book.addedAt}`,
  );
  if (book.progressPercent !== null) {
    metaLines.push(`Progress: ${book.progressPercent}%`);
  }

  const allLines: string[] = [...metaLines];
  if (book.annotation) {
    allLines.push('');
    allLines.push('__annotation_header__');
    for (const line of wrapText(book.annotation, TEXT_WIDTH)) {
      allLines.push(line);
    }
  }

  const [scroll, setScroll] = useState(0);
  const maxVisible = Math.max(1, termHeight - MODAL_CHROME);
  const maxScroll = Math.max(0, allLines.length - maxVisible);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visibleLines = allLines.slice(clampedScroll, clampedScroll + maxVisible);

  useInput((input, key) => {
    if (key.return || input === 'o') {
      onRead();
      return;
    }
    if (key.escape) {
      onClose();
      forceRedraw();
      return;
    }
    if (input === 'j') {
      setScroll((s) => Math.min(s + 3, maxScroll));
      return;
    }
    if (input === 'k') {
      setScroll((s) => Math.max(0, s - 3));
      return;
    }
  });

  const showCoverColumn = hasCover && coverData && coverData.length > 0;

  return (
    <Modal
      theme={theme}
      title={truncate(book.title, 76)}
      width={80}
      footer="Enter — read · esc — back · j/k scroll"
    >
      <Box flexDirection="row" height={maxVisible}>
        {showCoverColumn ? <Box width={27} /> : null}
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
              <Text key={i} color={theme.colors.text}>
                {line}
              </Text>
            );
          })}
        </Box>
      </Box>
    </Modal>
  );
}
