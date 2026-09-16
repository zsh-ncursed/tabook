// Desktop notifications for background events (an OPDS download landing in
// the library). The TUI's own status line and message are invisible when the
// terminal is in another tab or minimized, so a system notification is the
// only thing that reliably gets the user's attention.
//
// Best-effort by design: a headless box, a container, or any machine without
// a notification daemon simply has nothing to show, and that must never break
// the download itself — every failure path is swallowed.

import { spawn } from 'node:child_process';

/** Avoid firing twice for the same title within this window (ms). */
const DEDUP_WINDOW_MS = 60_000;
const recent = new Map<string, number>();

// The daemon's name on each platform, tried in order. On Linux this is
// notify-send (freedesktop); on macOS it is osascript.
type Notifier = { bin: string; build: (title: string, body: string) => string[] };

const NOTIFIERS: Notifier[] = [
  { bin: 'notify-send', build: (t, b) => ['--app-name', 'tabook', t, b] },
  {
    bin: 'osascript',
    build: (t, b) => [
      '-e',
      `display notification ${JSON.stringify(b)} with title ${JSON.stringify(t)}`,
    ],
  },
];

function hasDisplay(): boolean {
  // No display server → no daemon to talk to. Skipping here keeps the common
  // SSH/CI case from even spawning a process.
  return Boolean(
    process.env.DISPLAY ||
    process.env.WAYLAND_DISPLAY ||
    process.env.XDG_SESSION_TYPE === 'macos' ||
    process.platform === 'darwin',
  );
}

export function notifyDesktop(title: string, body: string): boolean {
  // Throttle repeats so a re-download or a rapid queue does not spam.
  const now = Date.now();
  const last = recent.get(body) ?? 0;
  if (now - last < DEDUP_WINDOW_MS) return false;
  recent.set(body, now);

  if (!hasDisplay()) return false;

  for (const { bin, build } of NOTIFIERS) {
    try {
      const child = spawn(bin, build(title, body), { stdio: 'ignore', detached: true });
      child.on('error', () => {
        // Binary missing or refused — try the next platform's notifier.
      });
      child.unref();
      return true;
    } catch {
      // spawn itself threw; continue to the next notifier.
    }
  }
  return false;
}

/** Test hook: clear the dedup window so tests start from a clean state. */
export function __resetDesktopNotifyForTests(): void {
  recent.clear();
}
