import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, type Key } from 'ink';
import type { LibraryDb, BookRecord, SortField } from '../db/db.js';
import type { Config } from '../config/defaults.js';
import { THEMES, themeNames } from '../themes/themes.js';
import { openBook, parseBookFile } from '../formats/index.js';
import type { ParsedBook } from '../formats/model.js';
import { ReaderSession } from './reader/readerModel.js';
import { LibraryView } from './library/LibraryView.js';
import { ReaderView } from './reader/ReaderView.js';
import { HelpView } from './help/HelpView.js';
import { TextPrompt } from './components/TextPrompt.js';
import { ListModal } from './components/ListModal.js';
import { useTerminalSize } from './useTerminalSize.js';
import { useInputDispatch } from './useInputDispatch.js';
import { resolveKeyName } from './keymap.js';
import { pickBookFile } from '../utils/open.js';
import { shellSplit } from '../utils/text.js';
import { loadConfig, serializeConfig } from '../config/config.js';
import { defaultConfig } from '../config/defaults.js';
import { defaultConfigPath } from '../utils/paths.js';
import { forceRedraw } from './screenRefresh.js';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

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
  const configPathRef = useRef(props.configPath);
  const { exit } = useApp();
  // Live copy of the config so :config edit can reload the file without a
  // restart. The prop is only the initial value.
  const [liveConfig, setLiveConfig] = useState<Config>(config);
  const [width, height] = useTerminalSize();
  const [screen, setScreen] = useState<'library' | 'reader'>('library');
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
  const [themeCursor, setThemeCursor] = useState(0);
  const prePickThemeRef = useRef<string | null>(null);

  const theme = useMemo(() => {
    const t = THEMES[themeName];
    return t ?? THEMES[defaultConfig().theme]!;
  }, [themeName]);

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

  const handleCommand = useCallback(
    (text: string): void => {
      const parts = shellSplit(text.trim());
      const rawCmd = parts[0] ?? '';
      const cmd = rawCmd.replace(/^:/, '').toLowerCase();
      const args = parts.slice(1);
      switch (cmd) {
        case 'q':
        case 'quit':
        case 'exit':
          if (screen === 'reader') closeReader();
          else exit();
          break;
        case 'open':
        case 'o':
          if (args[0]) void openBookPath(args[0]);
          else openFileDialog();
          break;
        case 'theme':
          if (args[0]) {
            if (THEMES[args[0]]) {
              setThemeName(args[0]);
              persistConfig(args[0]);
              notify(`Theme: ${args[0]}`);
            } else {
              notify(`Unknown theme: ${args[0]}. Available: ${themeNames().join(', ')}`);
            }
          } else {
            prePickThemeRef.current = themeName;
            setThemePickerOpen(true);
          }
          break;
        case 'themes':
          notify(themeNames().join(', '));
          break;
        case 'sort':
          if (screen === 'library' && args[0]) {
            if (['title', 'author', 'added', 'progress'].includes(args[0])) {
              libraryCmdRef.current.sort = args[0] as SortField;
              setCmdVersion((v) => v + 1);
            } else {
              notify('Sort field must be one of: title, author, added, progress');
            }
          }
          break;
        case 'group':
          if (screen === 'library') {
            const next = libraryCmdRef.current.group !== true;
            libraryCmdRef.current.group = next;
            setCmdVersion((v) => v + 1);
            notify(`Group by series: ${next ? 'on' : 'off'}`);
          }
          break;
        case 'goto':
          if (screen === 'reader' && session) {
            const arg = args[0] ?? '';
            if (arg.endsWith('%')) {
              const pct = Number(arg.slice(0, -1));
              if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
                session.goToPercent(pct);
                notify(`${pct}%`);
              } else {
                notify('Usage: :goto <page> | :goto <N>%');
              }
            } else {
              const page = Number(arg);
              if (Number.isFinite(page) && page > 0) {
                session.goToPage(page - 1);
                notify(`Page ${page}`);
              } else {
                notify('Usage: :goto <page> | :goto <N>%');
              }
            }
          }
          break;
        case 'simplified':
          if (session) {
            session.setSimplified(!session.isSimplified);
            notify(`Simplified mode: ${session.isSimplified ? 'on' : 'off'}`);
          }
          break;
        case 'css':
          notify(
            'Respect publisher CSS is stored in config; the CSS engine arrives in a later stage',
          );
          break;
        case 'search':
          if (session) {
            const query = args.join(' ');
            session.setQuery(query);
            const st = session.searchState();
            if (st.matches > 0) {
              session.nextMatch();
              notify(`${st.matches} match${st.matches === 1 ? '' : 'es'}`);
            } else {
              notify('No matches');
            }
          }
          break;
        case 'help':
        case '?':
          setHelpOpen(true);
          break;
        case 'config':
          if (args[0] === 'init') {
            const p = configPathRef.current || defaultConfigPath();
            try {
              const dir = p.substring(0, p.lastIndexOf('/'));
              if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(p, serializeConfig(defaultConfig()), 'utf8');
              notify(`Config written to ${p}`);
            } catch (err) {
              notify(`Cannot write config: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else if (args[0] === 'edit') {
            const p = configPathRef.current || defaultConfigPath();
            const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
            try {
              // Ink holds the terminal in raw mode while rendering; a TUI
              // editor needs a cooked terminal. Pause stdin and drop raw
              // mode for the duration of the editor, then restore.
              process.stdin.pause();
              process.stdin.setRawMode(false);
              const result = spawnSync(editor, [p], { stdio: 'inherit' });
              process.stdin.setRawMode(true);
              process.stdin.resume();
              forceRedraw();
              if (result.error) {
                notify(`Cannot open editor: ${result.error.message}`);
                break;
              }
              if (result.status !== 0) {
                notify(`Editor exited with status ${result.status ?? 'unknown'}`);
                break;
              }
              // Reload the config so edits apply immediately, without a
              // restart. Also sync the theme when the file changed it.
              try {
                const loaded = loadConfig(p);
                setLiveConfig(loaded.config);
                if (!props.themeOverride && loaded.config.theme !== themeName) {
                  setThemeName(loaded.config.theme);
                }
                notify('Config reloaded');
              } catch (reloadErr) {
                notify(
                  `Cannot reload config: ${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}`,
                );
              }
            } catch (err) {
              try {
                process.stdin.setRawMode(true);
                process.stdin.resume();
              } catch {
                // stdin may already be restored; best-effort
              }
              notify(`Cannot open editor: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            notify('Usage: :config init | :config edit');
          }
          break;
        default:
          notify(`Unknown command: ${rawCmd} (try :help)`);
      }
    },
    [
      screen,
      session,
      closeReader,
      exit,
      openBookPath,
      openFileDialog,
      notify,
      themeName,
      persistConfig,
      props.themeOverride,
    ],
  );

  const completeCommand = useCallback((value: string): string | null => {
    const trimmed = value.replace(/^:/, '').trim();
    if (!trimmed) return null;
    const parts = shellSplit(trimmed);
    const cmd = (parts[0] ?? '').toLowerCase();
    const commands = [
      'q',
      'quit',
      'exit',
      'open',
      'o',
      'theme',
      'themes',
      'sort',
      'group',
      'goto',
      'simplified',
      'css',
      'search',
      'help',
      'config',
    ];
    if (parts.length <= 1 && !trimmed.includes(' ')) {
      const matches = commands.filter((c) => c.startsWith(cmd));
      if (matches.length === 1) return `:${matches[0]} `;
    }
    if (cmd === 'theme' && parts.length === 2) {
      const prefix = (parts[1] ?? '').toLowerCase();
      const matches = themeNames().filter((t) => t.startsWith(prefix));
      if (matches.length === 1) return `:theme ${matches[0]}`;
    }
    return null;
  }, []);

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
  // session so no row is left dangling without ended_at. Ink's exit() path
  // is not guaranteed to run before the process dies on SIGHUP (e.g. ssh
  // closed), so the synchronous better-sqlite3 writes happen here. SIGINT is
  // included too: Ctrl+C is the most common way to quit a TUI.
  //
  // Registering a listener suppresses Node's default termination, so the
  // handler must exit explicitly — otherwise `kill -INT` (or SIGTERM from a
  // script) would flush and then hang forever.
  useEffect(() => {
    if (!session) return undefined;
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
  }, [session, flushSession, exit]);

  // Theme picker input dispatch. Single useInput, active only when picker is
  // open — but since the picker is the only overlay that needs keys here and
  // it opens/closes rarely, the setRawMode race doesn't bite (unlike TOC which
  // reopens frequently during a reading session).
  const themeItems = themeNames();
  const themeDispatchRef = useInputDispatch(themePickerOpen);
  themeDispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    const count = themeItems.length;
    switch (keyName) {
      case 'escape': {
        const prev = prePickThemeRef.current;
        if (prev && THEMES[prev]) setThemeName(prev);
        setThemePickerOpen(false);
        setThemeCursor(0);
        prePickThemeRef.current = null;
        return;
      }
      case 'j':
      case 'down':
        setThemeCursor((c) => Math.min(count - 1, c + 1));
        return;
      case 'k':
      case 'up':
        setThemeCursor((c) => Math.max(0, c - 1));
        return;
      case 'enter':
      case 'space': {
        const name = themeItems[themeCursor];
        if (name && THEMES[name]) {
          setThemeName(name);
          persistConfig(name);
          notify(`Theme: ${name}`);
        }
        setThemePickerOpen(false);
        setThemeCursor(0);
        prePickThemeRef.current = null;
        return;
      }
      default:
        return;
    }
  };

  // Help overlay: Esc closes. Single useInput, active only when help is open.
  const helpDispatchRef = useInputDispatch(helpOpen);
  helpDispatchRef.current = (input: string, key: Key) => {
    if (resolveKeyName(input, key) === 'escape') setHelpOpen(false);
  };

  // Navigate (preview) on cursor change.
  useEffect(() => {
    if (!themePickerOpen) return;
    const name = themeItems[themeCursor];
    if (name && THEMES[name]) {
      if (prePickThemeRef.current === null) prePickThemeRef.current = themeName;
      setThemeName(name);
    }
  }, [themePickerOpen, themeCursor, themeItems, themeName]);

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
          runCommand={handleCommand}
          completeCommand={completeCommand}
          inputDisabled={promptOpenPath || helpOpen || themePickerOpen}
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
          runCommand={handleCommand}
          completeCommand={completeCommand}
          inputDisabled={promptOpenPath || helpOpen || themePickerOpen}
        />
      ) : null}
      {helpOpen ? <HelpView config={liveConfig} theme={theme} /> : null}
      {themePickerOpen ? (
        <ListModal
          theme={theme}
          title="Theme picker"
          items={themeNames().map((n) => ({ id: n, label: n, accent: n === themeName }))}
          cursor={themeCursor}
          height={Math.min(14, themeNames().length)}
          footer="j/k preview · enter apply · esc cancel"
        />
      ) : null}
      {promptOpenPath ? (
        <Box paddingX={1} flexDirection="column">
          <TextPrompt
            theme={theme}
            prefix="open: "
            placeholder="path to .fb2 / .fb2.zip / .epub file"
            historyKey="open"
            onSubmit={(value) => {
              setPromptOpenPath(false);
              const p = value.trim();
              if (p) void openBookPath(p);
            }}
            onCancel={() => setPromptOpenPath(false)}
          />
          <Text color={theme.colors.dim} dimColor>
            Ctrl+V — paste from clipboard · esc — cancel
          </Text>
        </Box>
      ) : null}
      {message ? (
        <Box paddingX={1}>
          <Text color={theme.colors.accent}>{message.text}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
