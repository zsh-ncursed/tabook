import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { registerForceRedraw } from '../tui/screenRefresh.js';
import { loadConfig } from '../config/config.js';
import { getTheme } from '../themes/themes.js';
import { LibraryDb } from '../db/db.js';
import { resolveFolderPath } from '../db/scan.js';
import { defaultDbPath, expandTilde } from '../utils/paths.js';
import { appVersion } from '../utils/version.js';
import { App } from '../tui/App.js';
import { manPage } from './man.js';
import { bashCompletion, zshCompletion } from './completions.js';
import { queryTerminalBackground, terminalThemeName } from '../tui/terminalTheme.js';

export function main(): void {
  const program = new Command();
  program
    .name('tabook')
    .description('TUI e-book reader for FB2 and EPUB')
    .version(appVersion(), '-V, --version', 'output the version number')
    .option('--library', 'open the library view')
    .option('--theme <name>', 'theme to use (overrides config)')
    .option('--config <path>', 'path to the config file')
    .option('--man', 'print the man page to stdout and exit')
    .option('--completion <shell>', 'print a bash or zsh completion script to stdout and exit')
    .argument('[file]', 'path to a book file (.fb2, .fb2.zip or .epub)')
    .action(
      (
        file: string | undefined,
        options: {
          theme?: string;
          config?: string;
          library?: boolean;
          man?: boolean;
          completion?: string;
        },
      ) => {
        if (options.man) {
          process.stdout.write(manPage());
          return;
        }
        if (options.completion !== undefined) {
          const shell = options.completion;
          if (shell === 'bash') {
            process.stdout.write(bashCompletion());
          } else if (shell === 'zsh') {
            process.stdout.write(zshCompletion());
          } else {
            console.error(`tabook: unknown shell "${shell}" (expected "bash" or "zsh")`);
            process.exit(1);
          }
          return;
        }
        void run(file, options);
      },
    );
  program.parse(process.argv);
}

async function run(
  file: string | undefined,
  options: { theme?: string; config?: string; library?: boolean },
): Promise<void> {
  let loaded;
  try {
    loaded = loadConfig(options.config);
  } catch (err) {
    console.error(`tabook: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  for (const warning of loaded.warnings) {
    console.error(`tabook: ${warning}`);
  }

  const config = loaded.config;
  if (options.theme) {
    try {
      getTheme(options.theme);
    } catch {
      console.error(`tabook: unknown theme "${options.theme}"`);
      process.exit(1);
    }
  }

  // auto_theme: match the configured theme to the terminal background (OSC 11)
  // — dark terminal keeps the configured theme, a light terminal switches to
  // its -light variant. An explicit --theme always wins. Only meaningful in a
  // real terminal (the query needs a TTY on both ends).
  let themeOverride = options.theme;
  if (!themeOverride && config.autoTheme && process.stdout.isTTY && process.stdin.isTTY) {
    const bg = await queryTerminalBackground();
    themeOverride = terminalThemeName(config.theme, bg);
  }

  let db: LibraryDb;
  try {
    const dbPath = config.dbPath !== '' ? expandTilde(config.dbPath) : defaultDbPath();
    db = new LibraryDb(dbPath);
    // Pre-seed default OPDS catalogs if none exist yet (fresh DB).
    // This gives the user immediate, working sources on first run.
    if (db.listCatalogs().length === 0) {
      db.addCatalog({
        name: 'Project Gutenberg',
        url: 'https://m.gutenberg.org/ebooks.opds/',
      });
      db.addCatalog({ name: 'Flibusta', url: 'https://flibusta.is/opds' });
    }
  } catch (err) {
    console.error(`tabook: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // A directory passed as the positional argument is treated as a library
  // folder: it gets attached (scanned on startup by the App) and the library
  // view opens instead of a book.
  let attachFolder: string | undefined;
  if (file) {
    try {
      const resolved = resolveFolderPath(file);
      if (fs.statSync(resolved).isDirectory()) {
        attachFolder = resolved;
      }
    } catch {
      // Not a path we can stat (missing file, unreadable, …) — fall through
      // and let the book-open path report the error.
    }
  }

  let initialPath: string | undefined = file;
  if (options.library) {
    if (file && !attachFolder) {
      console.error('tabook: --library overrides the file argument, ignoring it');
    }
    initialPath = undefined;
  } else if (attachFolder) {
    initialPath = undefined;
  }

  if (attachFolder) {
    try {
      db.addLibraryFolder(attachFolder);
    } catch (err) {
      console.error(`tabook: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  process.on('exit', () => {
    try {
      db.close();
    } catch (err) {
      console.error(
        `tabook: error closing database: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  const tree = render(
    React.createElement(App, {
      db,
      config,
      configPath: loaded.path,
      initialPath,
      themeOverride,
    }),
  );
  // ponytail: Ink's logUpdate suppresses a write when the closing frame is
  // byte-identical to the pre-modal one (modal stays on screen). clear()
  // resets logUpdate so the next re-render always paints.
  registerForceRedraw(() => tree.clear());
  void tree.waitUntilExit();
}

function isEntryPoint(): boolean {
  return (
    typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url
  );
}

if (isEntryPoint()) {
  main();
}
