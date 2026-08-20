import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useTerminalSize } from '../useTerminalSize.js';
import type { Theme } from '../../themes/themes.js';
import type { Config } from '../../config/defaults.js';
import type { BookRecord } from '../../db/db.js';
import { Modal } from '../components/Modal.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { formatBytes, truncateW, wrapText } from '../../utils/text.js';
import { useImageLayer } from '../imageLayer.js';
import { forceRedraw } from '../screenRefresh.js';
import { extractCoverBytes } from '../../formats/cover.js';

export interface BookDetailProps {
  book: BookRecord;
  config: Config;
  theme: Theme;
  onRead: () => void;
  onClose: () => void;
  onHelp?: () => void;
  /** True while an App-level overlay (help, palette, …) is open above the
   * modal; the cover image is dropped then so it can't cover the overlay. */
  inputDisabled?: boolean;
}

// Modal chrome: border-top(1) + paddingY-top(1) + title(1) + marginY(1) +
// footer(1) + marginY(1) + paddingY-bottom(1) + border-bottom(1) = 8
const MODAL_CHROME = 8;

export function BookDetail(props: BookDetailProps): React.JSX.Element {
  const { book, config, theme, onRead, onClose, onHelp, inputDisabled = false } = props;
  const { stdout } = useStdout();
  const [termWidth] = useTerminalSize();
  const modalWidth = Math.min(termWidth - 2, 80);
  const imageLayer = useImageLayer();
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const termHeight = stdout.rows ?? 24;
  const hasCover = !!book.coverKey;

  const [coverData, setCoverData] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!hasCover || !book.coverKey) {
      setCoverData(null);
      return;
    }
    const bytes = extractCoverBytes(book.path, book.format, book.coverKey);
    setCoverData(bytes ?? null);
  }, [book.path, book.format, book.coverKey, hasCover]);

  useEffect(() => {
    // An App-level overlay (help, …) renders above this modal; the cover
    // would cover it, so drop the image for the overlay's lifetime and
    // re-draw when it closes.
    if (inputDisabled) {
      imageLayer.clear();
      return;
    }
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
  }, [hasCover, coverData, book.coverKey, inputDisabled]);

  const showCoverColumn = hasCover && coverData && coverData.length > 0;
  // Text column: modal - border(2) - paddingX(2) - [cover spacer(27) if shown] - right padding(1)
  const textWidth = modalWidth - 5 - (showCoverColumn ? 28 : 0);

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
    for (const line of wrapText(book.annotation, textWidth)) {
      allLines.push(line);
    }
  }

  const [scroll, setScroll] = useState(0);
  const maxVisible = Math.max(1, termHeight - MODAL_CHROME);
  const maxScroll = Math.max(0, allLines.length - maxVisible);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visibleLines = allLines.slice(clampedScroll, clampedScroll + maxVisible);

  // Modal keys resolve through the configurable keymap like every other
  // view: select/open_file reads, back closes, cursor moves scroll (j/k and
  // the arrow keys are bound by default), help opens the keybindings help.
  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    const action = resolver.feed(keyName);
    switch (action) {
      case 'select':
      case 'open_file':
        onRead();
        return;
      case 'back':
        onClose();
        forceRedraw();
        return;
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
      case 'help':
        if (onHelp) onHelp();
        return;
      default:
        return;
    }
  });

  return (
    <Modal
      theme={theme}
      title={truncateW(book.title, Math.max(10, modalWidth - 4))}
      width={modalWidth}
      footer="Enter — read · ? help · esc — back · j/k scroll (rebindable)"
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
