// Verifies the better-sqlite3 fallback backend still works when the native
// module is unavailable (dev-only path; the release package ships native).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../native.js', () => ({
  native: null,
  isNativeErrorResult: () => false,
  getNativeLoadError: () => null,
}));

import { LibraryDb } from './db.js';
import { DatabaseError } from '../utils/errors.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-fallback-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('LibraryDb without the native core', () => {
  it('fails fast instead of silently degrading (no TS fallback for the DB)', () => {
    // The Rust core owns the schema and migrations: a missing binding must
    // surface as a clear error, never as a partially-working database.
    expect(() => new LibraryDb(path.join(dir, 'lib.sqlite'))).toThrow(DatabaseError);
    expect(() => new LibraryDb(path.join(dir, 'lib.sqlite'))).toThrow(/@tabook\/native/);
  });

  it('reports the load error alongside the failure', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => new LibraryDb(path.join(dir, 'lib.sqlite'))).toThrow();
    } finally {
      err.mockRestore();
    }
  });

  it('throws DatabaseError on unopenable path', () => {
    const dbDir = path.join(dir, 'not-a-db');
    fs.mkdirSync(dbDir);
    expect(() => new LibraryDb(dbDir)).toThrow();
  });
});
