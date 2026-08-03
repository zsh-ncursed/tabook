import { createRequire } from 'node:module';
import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { loadConfig } from '../config/config.js';
import { getTheme } from '../themes/themes.js';
import { LibraryDb } from '../db/db.js';
import { defaultDbPath } from '../utils/paths.js';
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
    .name('tome')
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
    console.error(`tome: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  for (const warning of loaded.warnings) {
    console.error(`tome: ${warning}`);
  }

  const config = loaded.config;
  if (options.theme) {
    try {
      getTheme(options.theme);
    } catch {
      console.error(`tome: unknown theme "${options.theme}"`);
      process.exit(1);
    }
  }

  let db: LibraryDb;
  try {
    const dbPath = config.dbPath !== '' ? config.dbPath : defaultDbPath();
    db = new LibraryDb(dbPath);
  } catch (err) {
    console.error(`tome: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let initialPath: string | undefined = file;
  if (options.library) {
    initialPath = undefined;
  }

  const tree = render(
    React.createElement(App, {
      db,
      config,
      initialPath,
      themeOverride: options.theme,
    }),
  );
  void tree.waitUntilExit();
}

main();
