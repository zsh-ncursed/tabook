import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { registerForceRedraw } from '../tui/screenRefresh.js';
import { loadConfig } from '../config/config.js';
import { getTheme } from '../themes/themes.js';
import { LibraryDb } from '../db/db.js';
import { defaultDbPath, expandTilde } from '../utils/paths.js';
import { App } from '../tui/App.js';

const require = createRequire(import.meta.url);

function readVersion(): string {
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const pkg = require(candidate) as { version?: string };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // Empty catch; the candidate may not exist in this layout.
    }
  }
  return '0.0.0';
}

export function main(): void {
  const program = new Command();
  program
    .name('tabook')
    .description('TUI e-book reader for FB2 and EPUB')
    .version(readVersion(), '-V, --version', 'output the version number')
    .option('--library', 'open the library view')
    .option('--theme <name>', 'theme to use (overrides config)')
    .option('--config <path>', 'path to the config file')
    .argument('[file]', 'path to a book file (.fb2, .fb2.zip or .epub)')
    .action(
      (
        file: string | undefined,
        options: { theme?: string; config?: string; library?: boolean },
      ) => {
        run(file, options);
      },
    );
  program.parse(process.argv);
}

function run(
  file: string | undefined,
  options: { theme?: string; config?: string; library?: boolean },
): void {
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

  let db: LibraryDb;
  try {
    const dbPath = config.dbPath !== '' ? expandTilde(config.dbPath) : defaultDbPath();
    db = new LibraryDb(dbPath);
    // Pre-seed Project Gutenberg catalog if no catalogs exist yet (fresh DB).
    // This gives the user an immediate, working OPDS source on first run.
    if (db.listCatalogs().length === 0) {
      db.addCatalog({
        name: 'Project Gutenberg',
        url: 'https://m.gutenberg.org/ebooks.opds/',
      });
    }
  } catch (err) {
    console.error(`tabook: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let initialPath: string | undefined = file;
  if (options.library) {
    initialPath = undefined;
  }

  process.on('exit', () => {
    try {
      db.close();
    } catch {
      // best-effort close on exit
    }
  });

  const tree = render(
    React.createElement(App, {
      db,
      config,
      configPath: loaded.path,
      initialPath,
      themeOverride: options.theme,
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
