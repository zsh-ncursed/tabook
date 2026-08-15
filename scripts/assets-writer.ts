// Generates the packaged man page and shell-completion scripts into a target
// directory (the release layout). The scripts are produced from the same
// source-of-truth registries the app itself uses (COMMANDS,
// DEFAULT_KEYBINDINGS, THEMES), so the shipped assets can never drift.
//
// Bundled by scripts/package-release.mjs and run once per release build:
//   node dist/assets-writer.mjs <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manPage } from '../src/cli/man.js';
import { bashCompletion, zshCompletion } from '../src/cli/completions.js';

const outDir =
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');

mkdirSync(join(outDir, 'man'), { recursive: true });
mkdirSync(join(outDir, 'completions'), { recursive: true });
writeFileSync(join(outDir, 'man', 'tabook.1'), manPage());
writeFileSync(join(outDir, 'completions', 'tabook.bash'), bashCompletion());
writeFileSync(join(outDir, 'completions', '_tabook'), zshCompletion());
