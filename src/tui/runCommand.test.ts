import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { runCommand, type CommandContext } from './runCommand.js';
import type { LibraryDb } from '../db/db.js';
import type { ReaderSession } from './reader/readerModel.js';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    db: {} as LibraryDb,
    screen: 'library',
    session: null,
    themeName: 'dracula',
    configPath: '/tmp/tabook-config.toml',
    notify: vi.fn(),
    exit: vi.fn(),
    openBookPath: vi.fn(async () => {}),
    openFileDialog: vi.fn(),
    closeReader: vi.fn(),
    attachLibraryFolder: vi.fn(),
    runLibraryScan: vi.fn(async () => {}),
    setScreen: vi.fn(),
    setHelpOpen: vi.fn(),
    setThemeName: vi.fn(),
    setThemePickerOpen: vi.fn(),
    setFolderRemoveConfirm: vi.fn(),
    persistConfig: vi.fn(),
    setLibraryRefresh: vi.fn(),
    setCmdVersion: vi.fn(),
    setLiveConfig: vi.fn(),
    libraryCmdRef: { current: {} },
    prePickThemeRef: { current: null },
    ...overrides,
  };
}

describe('runCommand', () => {
  it('quits from the library screen', () => {
    const ctx = makeCtx();
    runCommand(':q', ctx);
    expect(ctx.exit).toHaveBeenCalled();
  });

  it('closes the reader instead of quitting from the reader screen', () => {
    const ctx = makeCtx({ screen: 'reader', session: {} as ReaderSession });
    runCommand(':quit', ctx);
    expect(ctx.closeReader).toHaveBeenCalled();
    expect(ctx.exit).not.toHaveBeenCalled();
  });

  it('opens a book path with :open', () => {
    const ctx = makeCtx();
    runCommand(':open /tmp/book.fb2', ctx);
    expect(ctx.openBookPath).toHaveBeenCalledWith('/tmp/book.fb2');
  });

  it('opens the file dialog when :open has no argument', () => {
    const ctx = makeCtx();
    runCommand(':open', ctx);
    expect(ctx.openFileDialog).toHaveBeenCalled();
  });

  it('applies and persists a theme with :theme <name>', () => {
    const ctx = makeCtx();
    runCommand(':theme solarized', ctx);
    expect(ctx.setThemeName).toHaveBeenCalledWith('solarized');
    expect(ctx.persistConfig).toHaveBeenCalledWith('solarized');
  });

  it('notifies about an unknown theme', () => {
    const ctx = makeCtx();
    runCommand(':theme nosuch', ctx);
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('Unknown theme'));
  });

  it('opens the theme picker when :theme has no argument', () => {
    const ctx = makeCtx({ themeName: 'dracula' });
    runCommand(':theme', ctx);
    expect(ctx.setThemePickerOpen).toHaveBeenCalledWith(true);
  });

  it('adds an OPDS catalog', () => {
    const db = {
      getCatalogByName: vi.fn(() => undefined),
      addCatalog: vi.fn(() => 7),
    } as unknown as LibraryDb;
    const ctx = makeCtx({ db });
    runCommand(':opds add Flibusta https://flibusta.is/opds user pass', ctx);
    expect(db.addCatalog).toHaveBeenCalledWith({
      name: 'Flibusta',
      url: 'https://flibusta.is/opds',
      username: 'user',
      password: 'pass',
    });
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('Added catalog'));
  });

  it('rejects an OPDS catalog that already exists', () => {
    const db = {
      getCatalogByName: vi.fn(() => ({ id: 1, name: 'X' })),
      addCatalog: vi.fn(),
    } as unknown as LibraryDb;
    const ctx = makeCtx({ db });
    runCommand(':opds add X https://x/', ctx);
    expect(db.addCatalog).not.toHaveBeenCalled();
  });

  it('removes an OPDS catalog', () => {
    const db = {
      getCatalogByName: vi.fn(() => ({ id: 3, name: 'X' })),
      removeCatalog: vi.fn(),
    } as unknown as LibraryDb;
    const ctx = makeCtx({ db });
    runCommand(':opds remove X', ctx);
    expect(db.removeCatalog).toHaveBeenCalledWith(3);
  });

  it('attaches a library folder with :library add', () => {
    const ctx = makeCtx();
    runCommand(':library add /books', ctx);
    expect(ctx.attachLibraryFolder).toHaveBeenCalledWith('/books');
  });

  it('triggers a full rescan with :library scan', () => {
    const ctx = makeCtx();
    runCommand(':library scan', ctx);
    expect(ctx.runLibraryScan).toHaveBeenCalledWith();
  });

  it('prompts to confirm folder removal, counting its books', () => {
    const db = {
      getLibraryFolderByPath: vi.fn(() => ({ id: 1, path: '/books' })),
      listPathsByLibraryRoot: vi.fn(() => ['a', 'b']),
    } as unknown as LibraryDb;
    const ctx = makeCtx({ db });
    runCommand(':library remove /books', ctx);
    expect(ctx.setFolderRemoveConfirm).toHaveBeenCalledWith({
      path: '/books',
      count: 2,
    });
  });

  it('writes a default config with :config init', () => {
    const ctx = makeCtx({ configPath: '/tmp/nonexistent-dir-tabook/config.toml' });
    runCommand(':config init', ctx);
    expect(fs.existsSync('/tmp/nonexistent-dir-tabook/config.toml')).toBe(true);
    fs.rmSync('/tmp/nonexistent-dir-tabook', { recursive: true, force: true });
  });

  it('opens help with :help', () => {
    const ctx = makeCtx();
    runCommand(':help', ctx);
    expect(ctx.setHelpOpen).toHaveBeenCalledWith(true);
  });

  it('reports unknown commands', () => {
    const ctx = makeCtx();
    runCommand(':frobnicate', ctx);
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
  });

  it('ignores :goto outside the reader', () => {
    const ctx = makeCtx();
    runCommand(':goto 10', ctx);
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it('searches the open book with :search', () => {
    const session = {
      setQuery: vi.fn(),
      searchState: vi.fn(() => ({ matches: 3 })),
      nextMatch: vi.fn(),
    } as unknown as ReaderSession;
    const ctx = makeCtx({ screen: 'reader', session });
    runCommand(':search hello world', ctx);
    expect(session.setQuery).toHaveBeenCalledWith('hello world');
    expect(session.nextMatch).toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith('3 matches');
  });
});
