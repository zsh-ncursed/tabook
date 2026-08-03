import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const APP_NAME = 'tome';

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

export function defaultDbPath(): string {
  return path.join(configDir(), 'library.db');
}

export function defaultConfigPath(): string {
  return path.join(configDir(), 'config.toml');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
