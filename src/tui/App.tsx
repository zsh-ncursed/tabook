import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useApp } from 'ink';
import type { LibraryDb, BookRecord, SortField } from '../db/db.js';
import type { Config } from '../config/defaults.js';
import { THEMES } from '../themes/themes.js';
import { openBook, parseBookFile } from '../formats/index.js';
import type { ParsedBook } from '../formats/model.js';
import { ReaderSession } from './reader/readerModel.js';
import { LibraryView } from './library/LibraryView.js';
import { ReaderView } from './reader/ReaderView.js';
import { OpdsView } from './opds/OpdsView.js';
import { AppOverlays } from './components/AppOverlays.js';
import { useTerminalSize } from './useTerminalSize.js';
import { useAppCommands } from './useAppCommands.js';
import { pickBookFile } from '../utils/open.js';
import { serializeConfig } from '../config/config.js';
import { defaultConfig } from '../config/defaults.js';
import type { AppScreen } from './runCommand.js';
import { useLibraryScanner } from './useLibraryScanner.js';
import { enableMouseReporting, disableMouseReporting } from './mouse.js';
import { useImageLayer } from './imageLayer.js';
import * as fs from 'node:fs';

export interface AppProps {
  db: LibraryDb;
  config: Config;
  configPath?: string;
  initialPath?: string;
  themeOverride?: string;
}

// How often reading position is flushed to the database while a book is open.
// Writing on every keystroke is wasteful; this bound caps the worst-case loss
// after a crash or SIGKILL to a few seconds of reading.
const AUTO_SAVE_INTERVAL_MS = 5000;

export function App(props: AppProps): React.JSX.Element {
  const { db, config } = props;
  const imageLayer = useImageLayer();
  const configPathRef = useRef(props.configPath);
  const { exit } = useApp();
  // Live copy of the config so :config edit can reload the file without a
  // restart. The prop is only the initial value.
  const [liveConfig, setLiveConfig] = useState<Config>(config);
  const [width, height] = useTerminalSize();
  const [screen, setScreen] = useState<AppScreen>('library');
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [themeName, setThemeName] = useState(props.themeOverride ?? config.theme);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [message, setMessage] = useState<{ text: string; key: number } | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const startPageRef = useRef(0);
  const libraryCmdRef = useRef<{ sort?: SortField; group?: boolean }>({});
  const [cmdVersion, setCmdVersion] = useState(0);
  const [promptOpenPath, setPromptOpenPath] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [folderRemoveConfirm, setFolderRemoveConfirm] = useState<{
    path: string;
    count: number;
  } | null>(null);

  const theme = useMemo(() => {
    const t = THEMES[themeName];
    return t ?? THEMES[defaultConfig().theme]!;
  }, [themeName]);

  // SGR mouse reporting. Click mode (button events only) in lists lets the
  // terminal keep its native text selection; the reader switches to drag
  // mode (adds motion events while a button is held) so text ranges can be
  // selected with the mouse and bookmarked. Enabled while the app runs
  // unless the user disabled it in the config; terminals without mouse
  // support just ignore the enable sequence.
  useEffect(() => {
    if (!liveConfig.mouse) return;
    enableMouseReporting(screen === 'reader' && session ? 'drag' : 'click');
    return () => disableMouseReporting();
  }, [liveConfig.mouse, screen, session]);

  // Kill the overlay process when the app itself unmounts (quit from the
  // library, Ctrl+C/SIGTERM/SIGHUP via the handlers above). The reader stops
  // the layer in its own cleanup; the library only clears it, and view
  // switches must NOT kill it (the next view reuses the process). App
  // unmount fires exactly once, at exit. Without this, a live ueberzugpp
  // child keeps the event loop alive after Ink's exit() (which unmounts but
  // never calls process.exit), so the app hangs with the covers frozen on
  // screen — the "artifacts after closing" bug.
  //
  // Also leave the alternate screen buffer (main.ts entered it on start) so
  // the terminal restores the shell's original content instead of the app's
  // last frame. Written after the overlay is torn down so no cover window is
  // left dangling over the restored screen.
  useEffect(
    () => () => {
      imageLayer.stop();
      try {
        // TTY writes are synchronous; a queued write would be dropped when
        // the event loop drains after Ink's exit() (which never calls
        // process.exit).
        if (process.stdout.isTTY) {
          process.stdout.write('\x1b[?1049l');
        }
      } catch {
        // stdout already closed — nothing to restore into
      }
    },
    [],
  );

  // ueberzugpp measures the terminal's font metrics and padding once at
  // process start and caches them for the session. If it spawned while the
  // window was still being tiled by the WM (alacritty's config size before
  // i3 places it), the cached values are wrong and every cover lands offset
  // — typically up over the "Library" header. Once the terminal size has
  // settled after a change (and never right after mount, when the size is
  // usually already final), restart the overlay so the fresh process
  // re-measures at the settled geometry and re-draws the current images.
  const firstSizeRef = useRef(true);
  useEffect(() => {
    if (firstSizeRef.current) {
      firstSizeRef.current = false;
      return;
    }
    const timer = setTimeout(() => imageLayer.restart(), 300);
    return () => clearTimeout(timer);
  }, [width, height]);

  const notify = useCallback((text: string): void => {
    setMessage({ text, key: Date.now() });
  }, []);

  const persistConfig = useCallback(
    (newTheme: string): void => {
      const p = configPathRef.current;
      if (!p) return;
      try {
        const updated = { ...liveConfig, theme: newTheme };
        fs.writeFileSync(p, serializeConfig(updated), 'utf8');
      } catch {
        // ponytail: persist is best-effort; if file isn't writable, skip silently
      }
    },
    [liveConfig],
  );

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  const openParsedBook = useCallback(
    (book: ParsedBook, bookId: number | null): void => {
      const progress = bookId !== null ? db.getProgress(bookId) : undefined;
      const readerSession = new ReaderSession(book, {
        typo: liveConfig.typography,
        simplified: liveConfig.display.simplifiedMode,
        width,
        height,
        db,
        bookId,
      });
      if (progress) readerSession.goToCharOffset(progress.position);
      if (bookId !== null) {
        db.recordOpen(bookId);
        sessionStartRef.current = db.startSession(bookId);
        startPageRef.current = readerSession.pageNumber;
      }
      setSession(readerSession);
      setScreen('reader');
    },
    [db, liveConfig, width, height],
  );

  const openBookPath = useCallback(
    async (filePath: string): Promise<void> => {
      try {
        const book = await openBook(filePath);
        const record = db.getBookByPath(filePath);
        openParsedBook(book, record?.id ?? null);
      } catch (err) {
        notify(`Cannot open ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [db, openParsedBook, notify],
  );

  const openBookRecord = useCallback(
    (record: BookRecord): void => {
      try {
        const book = parseBookFile(record.path);
        openParsedBook(book, record.id);
      } catch (err) {
        notify(`Cannot open ${record.title}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [openParsedBook, notify],
  );

  // Save progress and close the reading-session row (so it is not left
  // without ended_at, which would permanently exclude it from stats). Shared
  // by the normal close path and the SIGTERM/SIGHUP handlers.
  const flushSession = useCallback((): void => {
    if (!session) return;
    session.saveProgress();
    if (session.bookId !== null && sessionStartRef.current !== null) {
      const pages = Math.abs(session.pageNumber - startPageRef.current);
      db.endSession(sessionStartRef.current, pages);
      sessionStartRef.current = null;
    }
  }, [session, db]);

  const closeReader = useCallback((): void => {
    flushSession();
    setSession(null);
    setScreen('library');
    setLibraryRefresh((c) => c + 1);
  }, [flushSession]);

  const saveToLibrary = useCallback((): number | null => {
    if (!session) return null;
    const book = session.book;
    // addBook already returns the row id (existing.id on conflict,
    // lastInsertRowid on insert). Re-querying via getBookByPath risks a race
    // when another process inserted the same path between the two calls.
    const id = db.addBook({
      path: book.path,
      filename: book.filename,
      format: book.format,
      size: book.size,
      metadata: book.metadata,
    });
    session.setBookId(id);
    notify(`Saved to library: ${book.metadata.title}`);
    setLibraryRefresh((c) => c + 1);
    return id;
  }, [session, db, notify]);

  const openFileDialog = useCallback((): void => {
    void (async () => {
      notify('Selecting file…');
      const file = await pickBookFile();
      if (file) {
        await openBookPath(file);
      } else {
        setPromptOpenPath(true);
      }
    })();
  }, [openBookPath, notify]);

  const { runLibraryScan, attachLibraryFolder } = useLibraryScanner({
    db,
    notify,
    screen,
    setLibraryRefresh,
  });

  const { runCommand, completeCommand, validCommandPrefix } = useAppCommands({
    db,
    screen,
    session,
    themeName,
    themeOverride: props.themeOverride,
    configPath: configPathRef.current ?? null,
    notify,
    exit,
    openBookPath,
    openFileDialog,
    closeReader,
    attachLibraryFolder,
    runLibraryScan,
    persistConfig,
    setScreen,
    setHelpOpen,
    setThemeName,
    setThemePickerOpen,
    setFolderRemoveConfirm,
    setLibraryRefresh,
    setCmdVersion,
    setLiveConfig,
    libraryCmdRef,
  });

  // :library remove confirmation — detach the folder and delete its books
  // (progress and bookmarks included); files on disk are untouched.
  const confirmFolderRemove = useCallback((): void => {
    const target = folderRemoveConfirm;
    if (!target) return;
    const folder = db.getLibraryFolderByPath(target.path);
    const removedBooks = db.removeBooksByLibraryRoot(target.path);
    if (folder) db.removeLibraryFolder(folder.id);
    notify(`Detached ${target.path}; removed ${removedBooks} book${removedBooks === 1 ? '' : 's'}`);
    setFolderRemoveConfirm(null);
    setLibraryRefresh((c) => c + 1);
  }, [db, folderRemoveConfirm, notify]);

  useEffect(() => {
    if (props.initialPath) {
      void openBookPath(props.initialPath);
    }
  }, [props.initialPath]);

  useEffect(() => {
    return () => {
      if (session) session.saveProgress();
    };
  }, [session]);

  // Periodic auto-save so an abrupt exit (SIGKILL, terminal close, power loss)
  // doesn't discard an entire reading session. The cleanup above only fires on
  // a normal unmount, which the process may never reach.
  useEffect(() => {
    if (!session) return undefined;
    const timer = setInterval(() => session.saveProgress(), AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [session]);

  // On graceful termination signals, flush progress AND end the reading
  // session so no row is left dangling without ended_at, then exit through
  // Ink so the unmount cleanups run (image overlays are cleared/killed,
  // mouse reporting and raw mode are restored) and the process 'exit'
  // handlers fire. Registered unconditionally — SIGINT/SIGTERM/SIGHUP in the
  // LIBRARY (no session) previously skipped this and left the ueberzugpp
  // overlay process orphaned with its windows still on screen (artifacts
  // after closing the app), and kitty images uncleared.
  //
  // Registering a listener suppresses Node's default termination, so the
  // handler must exit explicitly — otherwise `kill -INT` (or SIGTERM from a
  // script) would flush and then hang forever.
  useEffect(() => {
    const flushAndExit = (): void => {
      flushSession();
      exit();
    };
    process.on('SIGTERM', flushAndExit);
    process.on('SIGHUP', flushAndExit);
    process.on('SIGINT', flushAndExit);
    return () => {
      process.off('SIGTERM', flushAndExit);
      process.off('SIGHUP', flushAndExit);
      process.off('SIGINT', flushAndExit);
    };
  }, [flushSession, exit]);

  const openDownloadedBook = useCallback(
    (bookId: number, filePath: string) => {
      try {
        const book = parseBookFile(filePath);
        openParsedBook(book, bookId);
      } catch (err) {
        notify(`Cannot open downloaded book: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [openParsedBook, notify],
  );

  const inputDisabled =
    promptOpenPath ||
    helpOpen ||
    themePickerOpen ||
    commandPaletteOpen ||
    folderRemoveConfirm !== null;

  const openCommandPalette = useCallback((): void => {
    setCommandPaletteOpen(true);
  }, []);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {screen === 'library' ? (
        <LibraryView
          db={db}
          config={liveConfig}
          theme={theme}
          refreshTrigger={libraryRefresh}
          cmdBus={libraryCmdRef.current}
          cmdVersion={cmdVersion}
          notify={notify}
          onOpenBook={openBookRecord}
          onOpenFile={openFileDialog}
          onQuit={() => exit()}
          onHelp={() => setHelpOpen(true)}
          onOpenPalette={openCommandPalette}
          runCommand={runCommand}
          completeCommand={completeCommand}
          validCommandPrefix={validCommandPrefix}
          inputDisabled={inputDisabled}
        />
      ) : screen === 'opds' ? (
        <OpdsView
          db={db}
          config={liveConfig}
          theme={theme}
          notify={notify}
          onExit={() => {
            setScreen('library');
            setLibraryRefresh((c) => c + 1);
          }}
          onHelp={() => setHelpOpen(true)}
          onOpenDownloaded={openDownloadedBook}
          onOpenPalette={openCommandPalette}
          inputDisabled={inputDisabled}
        />
      ) : session ? (
        <ReaderView
          session={session}
          config={liveConfig}
          theme={theme}
          db={db}
          notify={notify}
          onClose={closeReader}
          onSave={saveToLibrary}
          onOpenFile={openFileDialog}
          onHelp={() => setHelpOpen(true)}
          onOpenPalette={openCommandPalette}
          runCommand={runCommand}
          completeCommand={completeCommand}
          validCommandPrefix={validCommandPrefix}
          inputDisabled={inputDisabled}
        />
      ) : null}
      <AppOverlays
        theme={theme}
        screen={screen}
        config={liveConfig}
        themeName={themeName}
        folderRemoveConfirm={folderRemoveConfirm}
        helpOpen={helpOpen}
        commandPaletteOpen={commandPaletteOpen}
        themePickerOpen={themePickerOpen}
        promptOpenPath={promptOpenPath}
        message={message}
        onRunCommand={runCommand}
        onConfirmFolderRemove={confirmFolderRemove}
        onCancelFolderRemove={() => setFolderRemoveConfirm(null)}
        onCloseHelp={() => setHelpOpen(false)}
        onClosePalette={() => setCommandPaletteOpen(false)}
        onThemePreview={(name) => setThemeName(name)}
        onThemeApply={(name) => {
          setThemeName(name);
          persistConfig(name);
          notify(`Theme: ${name}`);
        }}
        onThemeClose={(apply, previousTheme) => {
          if (!apply && previousTheme && THEMES[previousTheme]) {
            setThemeName(previousTheme);
          }
          setThemePickerOpen(false);
        }}
        onOpenPath={(p) => {
          setPromptOpenPath(false);
          void openBookPath(p);
        }}
        onCancelPath={() => setPromptOpenPath(false)}
      />
    </Box>
  );
}
