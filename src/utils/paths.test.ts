import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  APP_NAME,
  configDir,
  dataDir,
  defaultDbPath,
  defaultConfigPath,
  ensureDir,
} from './paths.js';

const HOME = os.homedir();

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
});

describe('paths', () => {
  it('falls back to XDG defaults', () => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    expect(configDir()).toBe(path.join(HOME, '.config', APP_NAME));
    expect(dataDir()).toBe(path.join(HOME, '.local', 'share', APP_NAME));
  });

  it('honors XDG env vars', () => {
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-config';
    process.env.XDG_DATA_HOME = '/tmp/xdg-data';
    expect(configDir()).toBe(path.join('/tmp/xdg-config', APP_NAME));
    expect(dataDir()).toBe(path.join('/tmp/xdg-data', APP_NAME));
  });

  it('derives db and config paths from the config dir', () => {
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-config';
    expect(defaultDbPath()).toBe(path.join('/tmp/xdg-config', APP_NAME, 'library.db'));
    expect(defaultConfigPath()).toBe(path.join('/tmp/xdg-config', APP_NAME, 'config.toml'));
  });

  it('ensureDir creates directories recursively', () => {
    const dir = path.join(os.tmpdir(), 'tabook-paths-test', 'nested');
    ensureDir(dir);
    expect(require('node:fs').existsSync(dir)).toBe(true);
  });
});
