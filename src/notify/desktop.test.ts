import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { notifyDesktop, __resetDesktopNotifyForTests } from './desktop.js';

// The helper spawns real processes; stub child_process.spawn so the tests can
// assert what would have been executed without needing a notification daemon.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = {
      on: vi.fn(),
      unref: vi.fn(),
    };
    return child;
  }),
}));

// hasDisplay() reads env vars; give every test a display so the spawn path is
// reachable, and let individual tests opt out. The dedup window is module
// state, so clear it before each test for isolation.
beforeEach(() => {
  process.env.DISPLAY = ':0';
  __resetDesktopNotifyForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifyDesktop', () => {
  it('fires notify-send with the app name, title and body', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

    notifyDesktop('tabook', 'Downloaded: Foo — in your library');

    expect(spawnMock).toHaveBeenCalledOnce();
    const [bin, args] = spawnMock.mock.calls[0]!;
    expect(bin).toBe('notify-send');
    expect(args).toContain('tabook');
    expect(args).toContain('Downloaded: Foo — in your library');
  });

  it('skips entirely when no display server is present (headless box)', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.XDG_SESSION_TYPE;

    expect(notifyDesktop('tabook', 'headless')).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('suppresses a repeat notification for the same body within the window', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

    notifyDesktop('tabook', 'Downloaded: Foo — in your library');
    expect(spawnMock).toHaveBeenCalledOnce();

    // Same book again immediately (e.g. a re-download finished): one
    // notification is enough, do not spam.
    notifyDesktop('tabook', 'Downloaded: Foo — in your library');
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('does not throw when spawn fails (never breaks the download)', async () => {
    const { spawn } = await import('node:child_process');
    (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(() => notifyDesktop('tabook', 'safe')).not.toThrow();
  });

  it('falls back to the next platform notifier when the first is missing', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    // First notifier (notify-send) unavailable; osascript should be tried.
    spawnMock.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    notifyDesktop('tabook', 'mac user');
    // notify-send attempted, then osascript.
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1]![0]).toBe('osascript');
  });
});
