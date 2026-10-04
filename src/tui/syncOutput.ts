// Synchronized output (DEC private mode 2026): the terminal buffers everything
// written between `ESC[?2026h` and `ESC[?2026l` and presents it as ONE atomic
// frame, so a partial repaint is never shown.
//
// Why the reader needs it: the root Box in App.tsx carries `minHeight={height}`
// so every frame is at least as tall as the screen, which makes Ink take its
// full-wipe path (`clearTerminal` = ESC[2J + ESC[3J + ESC[H) on EVERY render
// instead of the incremental `log-update` erase. That is deliberate — without
// minHeight, logUpdate's line counter goes stale and the tail of a taller
// previous frame survives on screen (stale book rows and dialog borders after
// a modal closes). But a full wipe per frame is invisible while the reader is
// idle, because frames are only redrawn on a keypress. TTS adds a 12 Hz repaint
// source (the braille spinner in TtsIndicator, plus a status/karaoke update per
// chunk), so the screen was wiped and repainted ~12-16 times a second — the
// flicker. Synchronized output removes the visible intermediate state without
// touching the minHeight tail protection.
//
// Terminals without 2026 support ignore the unknown private mode and behave
// exactly as before, so this is safe as a no-op fallback. Non-TTY stdout is
// left untouched so piped/redirected output stays free of escape codes.
import type { Writable } from 'node:stream';

const BEGIN = '\x1b[?2026h';
const END = '\x1b[?2026l';

/**
 * Wrap a writable stream so each write is bracketed by synchronized-output
 * markers, emitted as ONE write call.
 *
 * Single write matters: if the markers went out as separate writes, another
 * writer (the kitty image layer writes its escape sequences straight to
 * process.stdout) could land between them and land inside the synchronized
 * block.
 *
 * Only string payloads are wrapped; binary writes pass through untouched
 * because escape sequences cannot be concatenated onto them safely.
 */
export function withSynchronizedOutput<T extends Writable>(stream: T): T {
  // isTTY is absent on a plain Writable, hence the loose check: only a real
  // terminal has something to present atomically.
  if ((stream as { isTTY?: boolean }).isTTY !== true) return stream;

  const target = stream as unknown as {
    write: (...args: unknown[]) => unknown;
    [key: string | symbol]: unknown;
  };

  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === 'write') {
        return (...args: unknown[]): unknown => {
          const [chunk, ...rest] = args;
          // Empty writes would emit bare markers for no reason; log-update
          // relies on the byte-identical guard, not on this, so skipping is safe.
          if (typeof chunk !== 'string' || chunk === '') {
            return Reflect.apply(target.write, obj, args);
          }
          return Reflect.apply(target.write, obj, [`${BEGIN}${chunk}${END}`, ...rest]);
        };
      }
      const value = Reflect.get(obj, prop, receiver);
      // Stream methods read internal state off `this`; binding to the real
      // stream keeps that working through the proxy.
      return typeof value === 'function' ? value.bind(obj) : value;
    },
  });

  return proxy as unknown as T;
}
