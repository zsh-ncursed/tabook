import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const APP_NAME = 'tabook';

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, APP_NAME);
}

export function dataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_NAME);
}

export function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : path.join(os.homedir(), '.cache');
  return path.join(base, APP_NAME);
}

export function downloadsDir(): string {
  return path.join(cacheDir(), 'downloads');
}

export function defaultDbPath(): string {
  return path.join(configDir(), 'library.db');
}

// Expand a leading ~ or ~/ into the user's home directory. Paths elsewhere in
// the app (defaults, config-dir resolution) are built from os.homedir()
// directly, but a user-supplied db_path in config.toml may legitimately start
// with a tilde — without this, "db_path = ~/books/library.db" would create a
// literal "~" directory relative to the cwd.
export function expandTilde(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function defaultConfigPath(): string {
  return path.join(configDir(), 'config.toml');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
