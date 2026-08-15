import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { LibraryDb, SortField } from '../db/db.js';
import type { Config } from '../config/defaults.js';
import { THEMES, themeNames } from '../themes/themes.js';
import { defaultConfig } from '../config/defaults.js';
import { loadConfig, serializeConfig } from '../config/config.js';
import { defaultConfigPath } from '../utils/paths.js';
import { shellSplit } from '../utils/text.js';
import { forceRedraw } from './screenRefresh.js';
import { resolveFolderPath } from '../db/scan.js';
import type { ReaderSession } from './reader/readerModel.js';

export type AppScreen = 'library' | 'reader' | 'opds';

// Everything the command dispatcher needs from the App component. Passing a
// context object keeps runCommand a pure function of (text, ctx) — easy to
// test, and App.tsx just builds the context from its state/handlers.
export interface CommandContext {
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
  setScreen: (s: AppScreen) => void;
  setHelpOpen: (open: boolean) => void;
  setThemeName: (name: string) => void;
  setThemePickerOpen: (open: boolean) => void;
  setFolderRemoveConfirm: (v: { path: string; count: number } | null) => void;
  persistConfig: (theme: string) => void;
  setLibraryRefresh: (fn: (c: number) => number) => void;
  setCmdVersion: (fn: (v: number) => number) => void;
  setLiveConfig: (c: Config) => void;
  libraryCmdRef: { current: { sort?: SortField; group?: boolean } };
  prePickThemeRef: { current: string | null };
}

export function runCommand(text: string, ctx: CommandContext): void {
  const {
    db,
    screen,
    session,
    notify,
    exit,
    openBookPath,
    openFileDialog,
    closeReader,
    themeName,
    themeOverride,
    configPath,
    persistConfig,
    attachLibraryFolder,
    runLibraryScan,
    setScreen,
    setHelpOpen,
    setThemeName,
    setThemePickerOpen,
    setFolderRemoveConfirm,
    setCmdVersion,
    setLiveConfig,
    libraryCmdRef,
    prePickThemeRef,
  } = ctx;
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
      notify('Respect publisher CSS is stored in config; the CSS engine arrives in a later stage');
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
        const p = configPath || defaultConfigPath();
        try {
          const dir = p.substring(0, p.lastIndexOf('/'));
          if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(p, serializeConfig(defaultConfig()), 'utf8');
          notify(`Config written to ${p}`);
        } catch (err) {
          notify(`Cannot write config: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (args[0] === 'edit') {
        const p = configPath || defaultConfigPath();
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
            if (!themeOverride && loaded.config.theme !== themeName) {
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
}
