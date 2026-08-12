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
import { OpdsView } from './opds/OpdsView.js';
import { HelpView } from './help/HelpView.js';
import { TextPrompt } from './components/TextPrompt.js';
import { ListModal } from './components/ListModal.js';
import { useTerminalSize } from './useTerminalSize.js';
import { useInputDispatch } from './useInputDispatch.js';
import { resolveKeyName } from './keymap.js';
import { pickBookFile } from '../utils/open.js';
import { shellSplit } from '../utils/text.js';
import { validCommandPrefixLength } from './commands.js';
import { loadConfig, serializeConfig } from '../config/config.js';
import { defaultConfig } from '../config/defaults.js';
import { defaultConfigPath } from '../utils/paths.js';
import { forceRedraw } from './screenRefresh.js';
import { resolveFolderPath, scanLibraryFolder, folderNeedsRescan } from '../db/scan.js';
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
  const [screen, setScreen] = useState<'library' | 'reader' | 'opds'>('library');
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
  // Pending :library remove confirmation (folder + books with progress).
  const [folderRemoveConfirm, setFolderRemoveConfirm] = useState<{
    path: string;
    count: number;
  } | null>(null);
  // Guards against overlapping scans (auto-scan on startup + manual :library
  // scan + :library add can otherwise race on the same folder). Requests that
  // arrive mid-scan are accumulated and re-run after the current one
  // finishes: explicit folder scans accumulate their paths, and an explicit
  // full rescan (:library scan) supersedes them.
  const scanBusyRef = useRef(false);
  const pendingScanRef = useRef<{ all: boolean; folders: Set<string> } | null>(null);

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

  // Scan attached library folders, optionally just one. Progress is surfaced
  // via notify(); the library view is refreshed when done. Serialized through
  // scanBusyRef so concurrent triggers (startup + command) don't overlap.
  const runLibraryScan = useCallback(
    (folderOnly?: string | string[], silentWhenEmpty = false): Promise<void> => {
      if (scanBusyRef.current) {
        const pending = pendingScanRef.current ?? { all: false, folders: new Set<string>() };
        if (folderOnly === undefined) {
          pending.all = true;
          pending.folders.clear();
        } else if (!pending.all) {
          for (const p of Array.isArray(folderOnly) ? folderOnly : [folderOnly]) {
            pending.folders.add(p);
          }
        }
        pendingScanRef.current = pending;
        notify('A library scan is already running; queued');
        return Promise.resolve();
      }
      scanBusyRef.current = true;
      const folderList =
        folderOnly === undefined
          ? db.listLibraryFolders().map((f) => f.path)
          : Array.isArray(folderOnly)
            ? folderOnly
            : [folderOnly];
      const targets = folderList.map((p) => ({ path: p }));
      return (async () => {
        if (targets.length === 0) {
          // The startup auto-scan is silent when nothing is attached yet;
          // the hint belongs in the empty library view instead.
          if (!silentWhenEmpty) {
            notify('No folders attached. Add one with :library add <path>');
          }
          return;
        }
        for (const folder of targets) {
          notify(`Scanning ${folder.path}…`);
          try {
            const summary = await scanLibraryFolder(db, folder.path, (done, total) => {
              if (done === total || done % 25 === 0) {
                notify(`Scanning ${folder.path}: ${done}/${total}`);
              }
            });
            const errors = summary.failed > 0 ? `, ${summary.failed} failed` : '';
            notify(
              `${folder.path}: +${summary.added} new, ${summary.updated} updated, ` +
                `${summary.removed} removed${errors}`,
            );
          } catch (err) {
            notify(
              `Cannot scan ${folder.path}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      })().finally(() => {
        scanBusyRef.current = false;
        setLibraryRefresh((c) => c + 1);
        const pending = pendingScanRef.current;
        pendingScanRef.current = null;
        if (pending) {
          if (pending.all) {
            // Full rescan — db.listLibraryFolders() is re-read at run time,
            // so folders attached during the previous scan are included.
            void runLibraryScan(undefined, true);
          } else if (pending.folders.size > 0) {
            void runLibraryScan([...pending.folders], true);
          }
        }
      });
    },
    [db, notify],
  );

  // Attach a folder and scan it in one step. Called by :library add and by
  // the CLI when the positional argument is a directory.
  const attachLibraryFolder = useCallback(
    (rawPath: string): void => {
      let resolved: string;
      try {
        resolved = resolveFolderPath(rawPath);
        if (!fs.statSync(resolved).isDirectory()) {
          notify(`Not a directory: ${rawPath}`);
          return;
        }
      } catch (err) {
        notify(
          `Cannot attach folder ${rawPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      if (db.getLibraryFolderByPath(resolved)) {
        notify(`Folder already attached: ${resolved}`);
        return;
      }
      db.addLibraryFolder(resolved);
      notify(`Attached folder: ${resolved}`);
      void runLibraryScan(resolved);
    },
    [db, notify, runLibraryScan],
  );

  // On startup and every time the library view is entered (returning from
  // the reader or OPDS), rescan only folders whose files changed since the
  // last scan — a cheap mtime-based dirty check, no parsing for clean
  // folders. All stale folders are aggregated into one scan call so the
  // pending queue stays targeted (no force-all rescan of clean folders).
  // Explicit :library scan still forces a full rescan. The dirty check runs
  // asynchronously (chunked walk), so entering the library never blocks on
  // large folders; the checks are cancelled if the user leaves the view
  // before they finish.
  useEffect(() => {
    if (screen !== 'library') return;
    let cancelled = false;
    void (async () => {
      const stale: string[] = [];
      for (const folder of db.listLibraryFolders()) {
        if (cancelled) return;
        if (await folderNeedsRescan(db, folder)) stale.push(folder.path);
      }
      if (!cancelled && stale.length > 0) {
        void runLibraryScan(stale);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, db, runLibraryScan]);

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
        case 'opds':
          if (args[0] === 'add') {
            const name = args[1];
            const url = args[2];
            if (!name || !url) {
              notify('Usage: :opds add <name> <url> [username] [password]');
            } else {
              const username = args[3];
              const password = args[4];
              if (db.getCatalogByName(name)) {
                notify(`Catalog "${name}" already exists`);
              } else {
                const id = db.addCatalog({ name, url, username, password });
                notify(`Added catalog: ${name} (#${id})`);
              }
            }
          } else if (args[0] === 'remove' || args[0] === 'rm') {
            const name = args[1];
            if (!name) {
              notify('Usage: :opds remove <name>');
            } else {
              const cat = db.getCatalogByName(name);
              if (cat) {
                db.removeCatalog(cat.id);
                notify(`Removed catalog: ${name}`);
              } else {
                notify(`No catalog named "${name}"`);
              }
            }
          } else if (args[0] === 'list' || args[0] === 'ls') {
            const catalogs = db.listCatalogs();
            if (catalogs.length === 0) {
              notify('No OPDS catalogs configured. Add one with :opds add <name> <url>');
            } else {
              notify(catalogs.map((c) => `${c.name} — ${c.url}`).join(' | '));
            }
          } else {
            setScreen('opds');
          }
          break;
        case 'library':
        case 'folder': {
          const sub = (args[0] ?? '').toLowerCase();
          if (sub === 'add') {
            const p = args[1];
            if (!p) {
              notify('Usage: :library add <path>');
            } else {
              attachLibraryFolder(p);
            }
          } else if (sub === 'remove' || sub === 'rm') {
            const p = args[1];
            if (!p) {
              notify('Usage: :library remove <path>');
            } else {
              // resolveFolderPath only normalizes a string (expandTilde +
              // path.resolve) and cannot throw.
              const resolved = resolveFolderPath(p);
              const folder = db.getLibraryFolderByPath(resolved);
              if (!folder) {
                notify(`No attached folder: ${resolved}`);
              } else {
                // Detaching removes the folder's books (with progress and
                // bookmarks) from the library; files on disk are untouched.
                // Confirm first — this can wipe hundreds of reading sessions.
                setFolderRemoveConfirm({
                  path: resolved,
                  count: db.listPathsByLibraryRoot(resolved).length,
                });
              }
            }
          } else if (sub === 'list' || sub === 'ls') {
            const folders = db.listLibraryFolders();
            if (folders.length === 0) {
              notify('No folders attached. Add one with :library add <path>');
            } else {
              notify(folders.map((f) => f.path).join(' | '));
            }
          } else if (sub === 'scan' || sub === 'rescan') {
            void runLibraryScan();
          } else {
            notify('Usage: :library add <path> | remove <path> | list | scan');
          }
          break;
        }
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
      attachLibraryFolder,
      runLibraryScan,
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
      'opds',
      'library',
    ];
    if (parts.length <= 1 && !trimmed.includes(' ')) {
      const matches = commands.filter((c) => c.startsWith(cmd));
      if (matches.length === 1) return `:${matches[0]} `;
    }
    if (cmd === 'opds' && parts.length === 2) {
      const sub = (parts[1] ?? '').toLowerCase();
      const subs = ['add', 'remove', 'list'];
      const matches = subs.filter((s) => s.startsWith(sub));
      if (matches.length === 1) return `:opds ${matches[0]} `;
    }
    if (cmd === 'library' && parts.length === 2) {
      const sub = (parts[1] ?? '').toLowerCase();
      const subs = ['add', 'remove', 'list', 'scan'];
      const matches = subs.filter((s) => s.startsWith(sub));
      if (matches.length === 1) return `:library ${matches[0]} `;
    }
    if (cmd === 'theme' && parts.length === 2) {
      const prefix = (parts[1] ?? '').toLowerCase();
      const matches = themeNames().filter((t) => t.startsWith(prefix));
      if (matches.length === 1) return `:theme ${matches[0]}`;
    }
    return null;
  }, []);

  const validCommandPrefix = useCallback((value: string): number => {
    return validCommandPrefixLength(value);
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

  // Help overlay: HelpView handles its own input (j/k scroll, esc close)
  // via useInput while mounted. No App-level handler needed.

  // :library remove confirmation — y/enter detaches the folder and deletes
  // its books (progress/bookmarks included), n/esc cancels. Mirrors the
  // DeleteConfirm pattern used for single books in LibraryView.
  const folderRemoveDispatchRef = useInputDispatch(folderRemoveConfirm !== null);
  folderRemoveDispatchRef.current = (input: string, key: Key) => {
    const target = folderRemoveConfirm;
    if (!target) return;
    const keyName = resolveKeyName(input, key);
    if (keyName === 'y' || keyName === 'enter') {
      const folder = db.getLibraryFolderByPath(target.path);
      const removedBooks = db.removeBooksByLibraryRoot(target.path);
      if (folder) db.removeLibraryFolder(folder.id);
      notify(
        `Detached ${target.path}; removed ${removedBooks} book${removedBooks === 1 ? '' : 's'}`,
      );
      setFolderRemoveConfirm(null);
      setLibraryRefresh((c) => c + 1);
      return;
    }
    if (keyName === 'n' || keyName === 'escape') {
      setFolderRemoveConfirm(null);
    }
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
          validCommandPrefix={validCommandPrefix}
          inputDisabled={
            promptOpenPath || helpOpen || themePickerOpen || folderRemoveConfirm !== null
          }
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
          inputDisabled={
            promptOpenPath || helpOpen || themePickerOpen || folderRemoveConfirm !== null
          }
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
          validCommandPrefix={validCommandPrefix}
          inputDisabled={
            promptOpenPath || helpOpen || themePickerOpen || folderRemoveConfirm !== null
          }
        />
      ) : null}
      {folderRemoveConfirm ? (
        <Box flexDirection="column" paddingX={1}>
          <Text color={theme.colors.error} bold>
            Detach "{folderRemoveConfirm.path}"? {folderRemoveConfirm.count} book
            {folderRemoveConfirm.count === 1 ? '' : 's'} with reading progress will be removed (y/N
            · esc cancel)
          </Text>
          <Text color={theme.colors.dim} dimColor>
            Files on disk are untouched; re-attaching the folder re-imports the books.
          </Text>
        </Box>
      ) : null}
      {helpOpen ? (
        <HelpView config={liveConfig} theme={theme} screen={screen} onClose={() => setHelpOpen(false)} />
      ) : null}
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
