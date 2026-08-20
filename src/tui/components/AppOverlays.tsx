import React from 'react';

import type { Theme } from '../../themes/themes.js';
import { themeNames } from '../../themes/themes.js';
import type { Config } from '../../config/defaults.js';
import type { AppScreen } from '../runCommand.js';
import { HelpView } from '../help/HelpView.js';
import { ThemePicker } from './ThemePicker.js';
import { FolderRemoveConfirm } from './FolderRemoveConfirm.js';
import { OpenPathPrompt } from './OpenPathPrompt.js';
import { CommandPalette } from './CommandPalette.js';
import type { BookRecord } from '../../db/db.js';

export interface AppOverlaysProps {
  theme: Theme;
  screen: AppScreen;
  config: Config;
  /** Currently applied theme name (highlighted row / cancel-restore baseline). */
  themeName: string;
  folderRemoveConfirm: { path: string; count: number } | null;
  helpOpen: boolean;
  commandPaletteOpen: boolean;
  themePickerOpen: boolean;
  promptOpenPath: boolean;
  /** Books offered by the command palette (fuzzy library search). */
  paletteBooks?: BookRecord[];
  onRunCommand: (text: string) => void;
  /** Open a book selected in the command palette. */
  onOpenPaletteBook?: (record: BookRecord) => void;
  onConfirmFolderRemove: () => void;
  onCancelFolderRemove: () => void;
  onCloseHelp: () => void;
  onClosePalette: () => void;
  onThemePreview: (name: string) => void;
  onThemeApply: (name: string) => void;
  onThemeClose: (apply: boolean, previousTheme: string | null) => void;
  onOpenPath: (path: string) => void;
  onCancelPath: () => void;
}

// Overlay orchestration, extracted from App.tsx: renders whichever of the
// modal layers (folder-remove confirm, help, command palette, theme picker,
// path prompt) is open, plus the transient status message. Pure rendering —
// all decisions and side effects stay in App, which owns the state and
// passes plain handlers.
export function AppOverlays(props: AppOverlaysProps): React.JSX.Element {
  const {
    theme,
    screen,
    config,
    themeName,
    folderRemoveConfirm,
    helpOpen,
    commandPaletteOpen,
    themePickerOpen,
    promptOpenPath,
    paletteBooks,
    onRunCommand,
    onOpenPaletteBook,
    onConfirmFolderRemove,
    onCancelFolderRemove,
    onCloseHelp,
    onClosePalette,
    onThemePreview,
    onThemeApply,
    onThemeClose,
    onOpenPath,
    onCancelPath,
  } = props;
  return (
    <>
      {folderRemoveConfirm ? (
        <FolderRemoveConfirm
          theme={theme}
          path={folderRemoveConfirm.path}
          count={folderRemoveConfirm.count}
          isActive={folderRemoveConfirm !== null}
          onConfirm={onConfirmFolderRemove}
          onCancel={onCancelFolderRemove}
        />
      ) : null}
      {helpOpen ? (
        <HelpView config={config} theme={theme} screen={screen} onClose={onCloseHelp} />
      ) : null}
      {commandPaletteOpen ? (
        <CommandPalette
          theme={theme}
          screen={screen}
          books={paletteBooks}
          onRun={onRunCommand}
          onOpenBook={onOpenPaletteBook}
          onClose={onClosePalette}
        />
      ) : null}
      {themePickerOpen ? (
        <ThemePicker
          theme={theme}
          config={config}
          items={themeNames()}
          currentTheme={themeName}
          isActive={themePickerOpen}
          onPreview={onThemePreview}
          onApply={onThemeApply}
          onClose={onThemeClose}
        />
      ) : null}
      {promptOpenPath ? (
        <OpenPathPrompt theme={theme} onOpen={onOpenPath} onCancel={onCancelPath} />
      ) : null}
    </>
  );
}
