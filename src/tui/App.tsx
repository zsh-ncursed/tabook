import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { LibraryDb, BookRecord, SortField } from '../db/db.js';
import type { Config } from '../config/defaults.js';
import { getTheme, THEMES, themeNames } from '../themes/themes.js';
import { openBook, parseBookFile } from '../formats/index.js';
import type { ParsedBook } from '../formats/model.js';
import { ReaderSession } from './reader/readerModel.js';
import { LibraryView } from './library/LibraryView.js';
import { ReaderView } from './reader/ReaderView.js';
import { HelpView } from './help/HelpView.js';
import { TextPrompt } from './components/TextPrompt.js';
import { useTerminalSize } from './useTerminalSize.js';
import { pickBookFile } from '../utils/open.js';

export interface AppProps {
  db: LibraryDb;
  config: Config;
  initialPath?: string;
  themeOverride?: string;
}

export function App(props: AppProps): React.JSX.Element {
  const { db, config } = props;
  const { exit } = useApp();
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

  const theme = getTheme(themeName);

  const notify = useCallback((text: string): void => {
    setMessage({ text, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  const openParsedBook = useCallback(
    (book: ParsedBook, bookId: number | null): void => {
      const progress = bookId !== null ? db.getProgress(bookId) : undefined;
      const readerSession = new ReaderSession(book, {
        typo: config.typography,
        simplified: config.display.simplifiedMode,
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
    [db, config, width, height],
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

  const closeReader = useCallback((): void => {
    if (session) {
      session.saveProgress();
      if (session.bookId !== null && sessionStartRef.current !== null) {
        const pages = Math.abs(session.pageNumber - startPageRef.current);
        db.endSession(sessionStartRef.current, pages);
        sessionStartRef.current = null;
      }
    }
    setSession(null);
    setScreen('library');
    setLibraryRefresh((c) => c + 1);
  }, [session, db]);

  const saveToLibrary = useCallback((): number | null => {
    if (!session) return null;
    const book = session.book;
    db.addBook({
      path: book.path,
      filename: book.filename,
      format: book.format,
      size: book.size,
      metadata: book.metadata,
    });
    const record = db.getBookByPath(book.path);
    const id = record?.id ?? null;
    if (id !== null) session.setBookId(id);
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
      const parts = text.trim().split(/\s+/);
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
              notify(`Theme: ${args[0]}`);
            } else {
              notify(`Unknown theme: ${args[0]}. Available: ${themeNames().join(', ')}`);
            }
          } else {
            notify(`Theme: ${themeName}`);
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
            const page = Number(args[0]);
            if (Number.isFinite(page) && page > 0) {
              session.goToPage(page - 1);
              notify(`Page ${page}`);
            } else {
              notify('Usage: :goto <page>');
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
        default:
          notify(`Unknown command: ${rawCmd} (try :help)`);
      }
    },
    [screen, session, closeReader, exit, openBookPath, openFileDialog, notify, themeName],
  );

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

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {screen === 'library' ? (
        <LibraryView
          db={db}
          config={config}
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
          inputDisabled={promptOpenPath}
        />
      ) : session ? (
        <ReaderView
          session={session}
          config={config}
          theme={theme}
          db={db}
          notify={notify}
          onClose={closeReader}
          onSave={saveToLibrary}
          onOpenFile={openFileDialog}
          onHelp={() => setHelpOpen(true)}
          runCommand={handleCommand}
          inputDisabled={promptOpenPath}
        />
      ) : null}
      {helpOpen ? (
        <HelpView config={config} theme={theme} onClose={() => setHelpOpen(false)} />
      ) : null}
      {promptOpenPath ? (
        <Box paddingX={1}>
          <TextPrompt
            theme={theme}
            prefix="open: "
            placeholder="path to .fb2 / .fb2.zip / .epub file"
            onSubmit={(value) => {
              setPromptOpenPath(false);
              const p = value.trim();
              if (p) void openBookPath(p);
            }}
            onCancel={() => setPromptOpenPath(false)}
          />
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
