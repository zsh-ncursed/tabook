import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import type { LibraryDb } from '../../db/db.js';
import type { ReaderSession } from './readerModel.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { renderLine } from '../renderLines.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { forceRedraw } from '../screenRefresh.js';
import { useMouseClicks } from '../mouse.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { copyToClipboard } from '../../utils/clipboard.js';
import { useImageLayer, type ImagePlacement, IMAGE_ROWS, zoomGeometry } from '../imageLayer.js';
import { truncateW } from '../../utils/text.js';
import { joinAuthors, formatSeries } from '../../formats/model.js';
import type { Mode } from './modes.js';
import {
  selectionText,
  selectionStartOffset,
  selectionCharCount,
  selectionRangeForLine,
  type TextSelection,
  type SelCell,
} from './readerSelection.js';
import { dispatchReaderAction, readerHint } from './readerActions.js';
import { useTocBookmarks } from './useTocBookmarks.js';
import { InfoModal } from './InfoModal.js';

export interface ReaderViewProps {
  session: ReaderSession;
  config: Config;
  theme: Theme;
  db: LibraryDb;
  notify: (message: string) => void;
  onClose: () => void;
  onSave: () => number | null;
  onOpenFile: () => void;
  onHelp: () => void;
  onOpenPalette?: () => void;
  runCommand: (text: string) => void;
  completeCommand?: (value: string) => string | null;
  validCommandPrefix?: (value: string) => number;
  inputDisabled?: boolean;
  message?: string;
}

export function ReaderView(props: ReaderViewProps): React.JSX.Element {
  const {
    session,
    config,
    theme,
    db,
    notify,
    onClose,
    onSave,
    onOpenFile,
    onHelp,
    onOpenPalette,
    runCommand,
    completeCommand,
    validCommandPrefix,
    inputDisabled = false,
    message,
  } = props;
  const imageLayer = useImageLayer();
  const [width, height] = useTerminalSize();
  const [mode, setModeState] = useState<Mode>('reading');
  // Mirrors `mode` but is updated synchronously so a multi-keypress chunk
  // (e.g. "t\u001b") that opens a modal and then presses Esc in the same
  // synchronous tick sees the just-transitioned mode instead of the stale
  // render closure.
  const modeRef = useRef<Mode>('reading');
  const setMode = useCallback((m: Mode): void => {
    modeRef.current = m;
    setModeState(m);
  }, []);
  // Mouse text selection: a drag spans viewport (line, rendered column)
  // cells. Mirrored in a ref so the mouse handler and key dispatch read the
  // latest value synchronously (state updates are async).
  const [selection, setSelectionState] = useState<TextSelection | null>(null);
  const selectionRef = useRef<TextSelection | null>(null);
  const setSelection = useCallback((sel: TextSelection | null) => {
    selectionRef.current = sel;
    setSelectionState(sel);
  }, []);
  const clearSelection = useCallback(() => setSelection(null), [setSelection]);
  const resolver = useMemo(() => createActionResolver(config), [config]);

  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  // Ink's logUpdate suppresses a write when the closing frame is byte-identical
  // to the pre-modal one (in our reader the underlying page is unchanged, so the
  // modal stays on screen until the next keystroke). Pieces an explicit clear +
  // re-render so the closing frame always paints immediately.
  const closeModal = useCallback(
    (next: Mode) => {
      setMode(next);
      forceRedraw();
    },
    [setMode],
  );

  // TOC / bookmarks modal: state (items, cursor, filter, expansion, bookmark
  // editing), key dispatch and render live in useTocBookmarks so the reader
  // component stays focused on reading-mode concerns.
  const tocBm = useTocBookmarks({ session, db, notify, onHelp, resolver, setMode, closeModal });

  useEffect(() => {
    session.setViewport(width, height);
  }, [session, width, height]);

  const metadata = session.book.metadata;
  const searchState = session.searchState();

  const handleAction = (action: KeyAction | undefined): void => {
    dispatchReaderAction(action, {
      session,
      notify,
      onSave,
      onOpenFile,
      onClose,
      onHelp,
      onOpenPalette,
      setMode,
      clearSelection,
      forceTick,
      openBookmarks: tocBm.openBookmarks,
      openToc: tocBm.openToc,
    });
  };

  // Single useInput, always active (when not disabled by a parent overlay like
  // Help). Modals (InfoModal, ListModal) do NOT have their own useInput — keys
  // are dispatched here by mode. This avoids Ink's setRawMode reference-count
  // race: when multiple useInput hooks toggle isActive, the internal
  // EventEmitter unsubscribes/resubscribes and loses keypresses (notably Esc
  // on the second open of a modal). With one always-on useInput, setRawMode
  // is called exactly once and handleReadable is never detached.

  // Ref holds the latest state/callbacks so the useInput handler can stay
  // referentially stable (no re-subscribe race). useInputDispatch registers
  // the stable handler (mouse-chunk filtering and multi-char chunk splitting
  // included) and routes every keypress through dispatchRef.current, which we
  // overwrite each render with a fresh closure over the current state.
  const dispatchRef = useInputDispatch(!inputDisabled, { splitChunks: true });
  dispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    const currentMode = modeRef.current;
    // TextPrompt modes have their own useInput; skip to avoid double-dispatch.
    if (
      currentMode === 'search' ||
      currentMode === 'command' ||
      currentMode === 'bookmark' ||
      currentMode === 'bookmark-edit' ||
      currentMode === 'toc-filter'
    ) {
      return;
    }

    // Info modal: back closes, help opens — via the configurable keymap.
    if (currentMode === 'info') {
      const action = resolver.feed(keyName);
      if (action === 'back') closeModal('reading');
      else if (action === 'help') onHelp();
      return;
    }

    // Zoomed image: back (or the zoom key again) returns to reading; the
    // overlay re-renders the normal page placements in the reading-mode
    // effect. The toggle works under any binding.
    if (currentMode === 'zoom') {
      const action = resolver.feed(keyName);
      if (action === 'back' || action === 'zoom_image') closeModal('reading');
      return;
    }

    // TOC / bookmarks list modal: dispatch navigation keys here. All state
    // (items, cursor, filters, bookmark editing) lives in useTocBookmarks;
    // every keypress is consumed, so the modal swallows its own keys.
    if (currentMode === 'toc' || currentMode === 'bookmarks') {
      tocBm.handleKey(currentMode, keyName);
      return;
    }

    // Reading mode: dispatch via keymap resolver.
    // Vim-like yank: with a mouse selection active, 'y' copies it to the
    // terminal clipboard (OSC 52) instead of falling through to the keymap.
    if (keyName === 'y' && selectionRef.current) {
      const text = selectionText(session, selectionRef.current);
      if (text) {
        copyToClipboard(text);
        notify(`Copied ${text.length} chars to clipboard`);
      } else {
        notify('Selection is empty');
      }
      return;
    }
    const action = resolver.feed(keyName);
    handleAction(action);
  };

  const lines = session.viewportLines();

  // Mouse text selection: press anchors, motion extends, release keeps the
  // range (with a hint). The reader content box has paddingX=1 and starts one
  // row below the title, so terminal cell (x, y) maps to viewport line
  // y - 2 and rendered column x - 2.
  const mouseStateRef = useRef({ mode, lines, session, inputDisabled });
  mouseStateRef.current = { mode, lines, session, inputDisabled };
  useMouseClicks((click) => {
    const s = mouseStateRef.current;
    if (click.button !== 'left' || s.mode !== 'reading' || s.inputDisabled) return;
    const lineIdx = click.y - 2;
    if (lineIdx < 0 || lineIdx >= s.lines.length) return;
    const line = s.lines[lineIdx]!;
    const renderedLen =
      line.indent + line.prefix.length + line.spans.reduce((n, sp) => n + sp.text.length, 0);
    if (renderedLen <= 0) return;
    const col = Math.max(0, Math.min(renderedLen - 1, click.x - 2));
    const cell: SelCell = { line: lineIdx, col };
    // SGR motion events arrive as "press" (M) with the motion bit set, so
    // motion must be checked before press: motion extends, press anchors.
    if (click.motion) {
      const prev = selectionRef.current;
      if (prev) setSelection({ ...prev, end: cell });
    } else if (click.press) {
      setSelection({ start: cell, end: cell });
    } else {
      const sel = selectionRef.current;
      if (sel) {
        const n = selectionCharCount(s.session, sel);
        notify(
          `Selection: ${n} char${n === 1 ? '' : 's'} · b — bookmark · y — copy · scroll clears`,
        );
      }
    }
  });

  // ponytail: ueberzugpp/kitty draws book images over the viewport's image
  // placeholders. Reconciled on every page/scroll change. In info mode the
  // book cover is drawn instead, so the overlay doesn't bleed over a modal.
  //
  // App-level overlays (command palette, help, theme picker, folder-remove
  // confirm, path prompt) are rendered ABOVE the reader while mode stays
  // 'reading', so the page images would cover the modal. When any of them is
  // open (inputDisabled), drop the images; when it closes, the effect re-runs
  // and re-draws them.
  useEffect(() => {
    if (inputDisabled) {
      imageLayer.clear();
      return;
    }
    if (mode === 'info') {
      if (!imageLayer.start()) return;
      const coverSrc = session.book.metadata.coverKey;
      if (coverSrc) {
        imageLayer.update(
          [{ identifier: 'cover', x: 2, y: 5, width: 16, height: 14, src: coverSrc }],
          session.book.resources,
        );
      } else {
        imageLayer.clear();
      }
      return;
    }
    if (mode === 'zoom') {
      // Enlarge the first image on the page: same src, a bigger centered box
      // (zoomGeometry), sent under its own identifier so closing the zoom
      // re-renders the normal placements. On tiny pages there may be no room
      // for a meaningful zoom; the on-page placeholder still renders.
      if (!imageLayer.start()) return;
      const pageH = session.pageHeight();
      const contentW = session.contentWidth();
      const imgIdx = lines.findIndex((l) => l.role === 'image');
      const imgLine = imgIdx >= 0 ? lines[imgIdx] : undefined;
      const block = imgLine ? session.book.content[imgLine.blockIndex] : undefined;
      if (!imgLine || !block || block.type !== 'image') {
        imageLayer.clear();
        return;
      }
      const baseW = Math.max(8, (contentW - imgLine.indent) | 0);
      const baseH = Math.min(IMAGE_ROWS, pageH - imgIdx);
      const g = zoomGeometry({
        baseWidth: baseW,
        baseHeight: baseH,
        contentWidth: contentW,
        pageHeight: pageH,
      });
      imageLayer.update(
        [{ identifier: 'zoom', x: g.x, y: g.y, width: g.width, height: g.height, src: block.src }],
        session.book.resources,
      );
      return;
    }
    if (mode !== 'reading') {
      imageLayer.clear();
      return;
    }
    if (!imageLayer.start()) return;
    const pageH = session.pageHeight();
    const placements: ImagePlacement[] = [];
    lines.forEach((line, i) => {
      if (line.role !== 'image') return;
      const block = session.book.content[line.blockIndex];
      if (!block || block.type !== 'image') return;
      const y = 1 + i; // row 0 = title, viewport starts at row 1
      const maxH = pageH - i;
      if (maxH < 2) return; // not enough room; keep the text placeholder
      placements.push({
        identifier: `img${line.blockIndex}`,
        x: 1 + line.indent,
        y,
        width: Math.max(8, (session.contentWidth() - line.indent) | 0),
        height: Math.min(IMAGE_ROWS, maxH),
        src: block.src,
      });
    });
    imageLayer.update(placements, session.book.resources);
  }, [lines, mode, session, inputDisabled]);

  useEffect(() => () => imageLayer.stop(), []);

  const headerMeta = [
    metadata.authors ? joinAuthors(metadata.authors) : '',
    formatSeries(metadata.series) ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  const statusData = {
    title: truncateW(metadata.title, 30),
    page: session.pageNumber + 1,
    totalPages: session.totalPages(),
    percent: session.percent(),
    search: searchState.query ? `search "${truncateW(searchState.query, 20)}"` : undefined,
    hint: readerHint(mode, config),
    message,
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box paddingX={1}>
        <Text color={theme.colors.heading} bold>
          {truncateW(metadata.title, Math.max(10, width - 20))}
        </Text>
        {headerMeta ? (
          <Text color={theme.colors.dim} dimColor>
            {'  '}
            {truncateW(headerMeta, Math.max(10, width - 40))}
          </Text>
        ) : null}
      </Box>

      <Box flexDirection="column" paddingX={1} height={session.pageHeight()}>
        {lines.map((line, i) => (
          <Box key={i} height={1}>
            {renderLine(line, theme, selectionRangeForLine(selection, i))}
          </Box>
        ))}
      </Box>

      {mode === 'search' ? (
        <TextPrompt
          theme={theme}
          prefix="/"
          placeholder="search in book…"
          initialValue={session.searchState().query}
          historyKey="search"
          onSubmit={(value) => {
            session.setQuery(value);
            const st = session.searchState();
            if (st.matches > 0) {
              session.nextMatch();
              forceTick();
              notify(`${st.matches} match${st.matches === 1 ? '' : 'es'} · n/N to navigate`);
            } else if (value.trim() !== '') {
              forceTick();
              notify('No matches found');
            }
            closeModal('reading');
          }}
          onCancel={() => {
            session.setQuery('');
            forceTick();
            closeModal('reading');
          }}
        />
      ) : null}

      {mode === 'command' ? (
        <TextPrompt
          theme={theme}
          prefix=":"
          placeholder="e.g. :goto 42, :simplified, :open book.fb2, :theme nord, :q"
          historyKey="command"
          onTab={completeCommand}
          validPrefixLength={validCommandPrefix}
          onSubmit={(value) => {
            closeModal('reading');
            runCommand(value);
          }}
          onCancel={() => closeModal('reading')}
        />
      ) : null}

      {mode === 'bookmark' ? (
        <TextPrompt
          theme={theme}
          prefix="b "
          placeholder="bookmark label (optional)…"
          initialValue={selection ? truncateW(selectionText(session, selection), 60) : ''}
          onSubmit={(value) => {
            let bookId = session.bookId;
            if (bookId === null) {
              bookId = onSave();
            }
            if (bookId === null) {
              notify('Cannot save bookmark: book not in library');
            } else {
              const sel = selectionRef.current;
              if (sel) {
                // Bookmark a mouse selection at its leading edge.
                session.addBookmarkAt(selectionStartOffset(session, sel), value);
              } else {
                session.addBookmarkAtCurrent(value);
              }
              notify('Bookmark added');
            }
            clearSelection();
            closeModal('reading');
          }}
          onCancel={() => {
            clearSelection();
            closeModal('reading');
          }}
        />
      ) : null}

      {tocBm.render(mode, theme, height)}

      {mode === 'info' ? (
        <InfoModal session={session} db={db} config={config} theme={theme} />
      ) : null}

      <StatusBar theme={theme} statusbar={config.statusbar} data={statusData} width={width} />
    </Box>
  );
}
