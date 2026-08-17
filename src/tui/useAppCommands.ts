import { useCallback } from 'react';
import type { LibraryDb, SortField } from '../db/db.js';
import type { Config } from '../config/defaults.js';
import { themeNames } from '../themes/themes.js';
import { completeCommand as completeCommandFn, validCommandPrefixLength } from './commands.js';
import { runCommand, type AppScreen, type CommandContext } from './runCommand.js';
import type { ReaderSession } from './reader/readerModel.js';

// Everything App.tsx feeds into the command dispatcher. Grouped here so App
// stays a composition of hooks: it owns state and session/overlay handlers,
// this hook owns the :command pipeline (context assembly + completion).
export interface UseAppCommandsParams {
  db: LibraryDb;
  screen: AppScreen;
  session: ReaderSession | null;
  themeName: string;
  themeOverride?: string;
  configPath: string | null;
  notify: (message: string) => void;
  exit: () => void;
  openBookPath: (filePath: string) => Promise<void>;
  openFileDialog: () => void;
  closeReader: () => void;
  attachLibraryFolder: (rawPath: string) => void;
  runLibraryScan: (folderOnly?: string | string[], silentWhenEmpty?: boolean) => Promise<void>;
  persistConfig: (theme: string) => void;
  setScreen: (s: AppScreen) => void;
  setHelpOpen: (open: boolean) => void;
  setThemeName: (name: string) => void;
  setThemePickerOpen: (open: boolean) => void;
  setFolderRemoveConfirm: (v: { path: string; count: number } | null) => void;
  setLibraryRefresh: (fn: (c: number) => number) => void;
  setCmdVersion: (fn: (v: number) => number) => void;
  setLiveConfig: (c: Config) => void;
  libraryCmdRef: { current: { sort?: SortField; group?: boolean } };
}

export function useAppCommands(params: UseAppCommandsParams): {
  runCommand: (text: string) => void;
  completeCommand: (value: string) => string | null;
  validCommandPrefix: (value: string) => number;
} {
  const {
    db,
    screen,
    session,
    themeName,
    themeOverride,
    configPath,
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
  } = params;

  const run = useCallback(
    (text: string): void => {
      const ctx: CommandContext = {
        db,
        screen,
        session,
        themeName,
        themeOverride,
        configPath,
        notify,
        exit,
        openBookPath,
        openFileDialog,
        closeReader,
        attachLibraryFolder,
        runLibraryScan,
        setScreen,
        setHelpOpen,
        setThemeName,
        setThemePickerOpen,
        setFolderRemoveConfirm,
        persistConfig,
        setLibraryRefresh,
        setCmdVersion,
        setLiveConfig,
        libraryCmdRef,
        // Set by runCommand on `:theme` (no args) and read back when the
        // picker closes; a fresh ref per invocation matches the pre-hook
        // behavior in App.tsx.
        prePickThemeRef: { current: null },
      };
      runCommand(text, ctx);
    },
    [
      db,
      screen,
      session,
      themeName,
      themeOverride,
      configPath,
      notify,
      exit,
      openBookPath,
      openFileDialog,
      closeReader,
      attachLibraryFolder,
      runLibraryScan,
      persistConfig,
      libraryCmdRef,
    ],
  );

  // Stable: completion depends only on the static command registry.
  const complete = useCallback(
    (value: string): string | null => completeCommandFn(value, themeNames),
    [],
  );
  const validPrefix = useCallback((value: string): number => validCommandPrefixLength(value), []);

  return { runCommand: run, completeCommand: complete, validCommandPrefix: validPrefix };
}
