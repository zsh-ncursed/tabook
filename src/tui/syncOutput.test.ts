import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import React, { useEffect, useState } from 'react';
import { render, Box, Text } from 'ink';
import { withSynchronizedOutput } from './syncOutput.js';

const BEGIN = '\x1b[?2026h';
const END = '\x1b[?2026l';

/** TTY-эмуляция stdout: пишет всё в frames, чтобы проверять границы обёртки. */
class FakeStdout extends EventEmitter {
  columns = 80;
  rows = 24;
  isTTY = true;
  frames: string[] = [];

  write(chunk: unknown): boolean {
    this.frames.push(String(chunk));
    return true;
  }
}

describe('withSynchronizedOutput', () => {
  it('brackets every write in synchronized-output markers', () => {
    const stdout = new FakeStdout();
    const wrapped = withSynchronizedOutput(stdout as unknown as Writable);

    wrapped.write('frame one');

    expect(stdout.frames).toEqual([`${BEGIN}frame one${END}`]);
  });

  it('emits markers and payload in ONE write, so nothing can land between them', () => {
    const stdout = new FakeStdout();
    const wrapped = withSynchronizedOutput(stdout as unknown as Writable);

    wrapped.write('payload');

    // A separate write for BEGIN and another for the payload would let the
    // kitty image layer's escape sequences slip inside the synchronized block.
    expect(stdout.frames).toHaveLength(1);
    expect(stdout.frames[0]!.startsWith(BEGIN)).toBe(true);
    expect(stdout.frames[0]!.endsWith(END)).toBe(true);
  });

  it('brackets each of several writes independently', () => {
    const stdout = new FakeStdout();
    const wrapped = withSynchronizedOutput(stdout as unknown as Writable);

    wrapped.write('a');
    wrapped.write('b');

    expect(stdout.frames).toEqual([`${BEGIN}a${END}`, `${BEGIN}b${END}`]);
  });

  it('passes non-TTY streams through unwrapped (no escapes in piped output)', () => {
    const stdout = new FakeStdout();
    stdout.isTTY = false;
    const wrapped = withSynchronizedOutput(stdout as unknown as Writable);

    wrapped.write('frame');

    expect(stdout.frames).toEqual(['frame']);
  });

  it('returns the same stream instance when not a TTY', () => {
    const stdout = new FakeStdout();
    stdout.isTTY = false;

    expect(withSynchronizedOutput(stdout as unknown as Writable)).toBe(stdout);
  });

  it('forwards extra write arguments (encoding, callback)', () => {
    const calls: unknown[][] = [];
    const base = new EventEmitter() as unknown as Writable & { isTTY: boolean };
    base.isTTY = true;
    (base as unknown as { write: (...args: unknown[]) => boolean }).write = (
      ...args: unknown[]
    ): boolean => {
      calls.push(args);
      return true;
    };

    const wrapped = withSynchronizedOutput(base);
    const cb = (): void => {};
    wrapped.write('x', 'utf8', cb);

    expect(calls).toEqual([[`${BEGIN}x${END}`, 'utf8', cb]]);
  });

  it('brackets Ink’s full-screen wipe frame atomically', () => {
    // Exactly the payload Ink emits on the clearTerminal path
    // (ansiEscapes.clearTerminal = ESC[2J + ESC[3J + ESC[H) followed by the
    // new frame. This is the write that flickered 12-16x/second during TTS,
    // and it must arrive as ONE synchronized write — otherwise the terminal
    // can present the wiped screen without the content that refills it.
    const wipe = '\x1b[2J\x1b[3J\x1b[H' + 'frame body';
    const stdout = new FakeStdout();
    const wrapped = withSynchronizedOutput(stdout as unknown as Writable);

    wrapped.write(wipe);

    expect(stdout.frames).toEqual([`${BEGIN}${wipe}${END}`]);
    // The markers surround the wipe and the content together, and nothing
    // was emitted between them.
    expect(stdout.frames[0]!.indexOf(BEGIN)).toBe(0);
    expect(stdout.frames[0]!.lastIndexOf(END)).toBe(stdout.frames[0]!.length - END.length);
  });

  it('leaves binary payloads untouched (escapes cannot be concatenated)', () => {
    const stdout = new FakeStdout();
    const wrapped = withSynchronizedOutput(stdout as unknown as Writable);
    const buf = Buffer.from([0x00, 0x01, 0x02]);

    wrapped.write(buf);

    expect(stdout.frames).toEqual([String(buf)]);
  });

  it('exposes stream properties and keeps methods working through the proxy', () => {
    const stdout = new FakeStdout();
    const wrapped = withSynchronizedOutput(stdout as unknown as Writable) as unknown as FakeStdout;

    expect(wrapped.columns).toBe(80);
    expect(wrapped.rows).toBe(24);
    expect(wrapped.isTTY).toBe(true);
    expect(typeof wrapped.on).toBe('function');
    // Methods must run against the real stream, not the proxy: a proxied
    // `this` would let EventEmitter's internal state land on the proxy object.
    const seen: string[] = [];
    wrapped.on('ping', () => seen.push('pong'));
    wrapped.emit('ping');
    expect(seen).toEqual(['pong']);
  });
});

/** Спиннер как в TtsIndicator: локальный frame + setInterval(80мс). */
function Spinner() {
  const PLAY = ['⠸', '⠴', '⠦', '⠧', '⠇', '⠏', '⠋', '⠙'];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % PLAY.length), 80);
    return () => clearInterval(id);
  }, []);
  return React.createElement(Text, null, `${PLAY[frame]} 3/42`);
}

// Ink refuses to write frames to stdout when it detects CI (`is-in-ci`, see
// ink/build/ink.js:111) — it only stashes `lastOutput`, because CI does not
// handle the erase escapes. The end-to-end repaint assertions below therefore
// can only run on a developer machine. The contract itself is covered by the
// deterministic test above, which runs everywhere.
const inCi =
  process.env.CI !== '0' &&
  process.env.CI !== 'false' &&
  ('CI' in process.env ||
    'CONTINUOUS_INTEGRATION' in process.env ||
    Object.keys(process.env).some((k) => k.startsWith('CI_')));

describe('withSynchronizedOutput with Ink', () => {
  it('renders a live frame and brackets every write', async () => {
    const stdout = new FakeStdout();
    const tree = render(
      React.createElement(
        Box,
        { flexDirection: 'column', width: '100%' },
        React.createElement(Text, null, 'header'),
        React.createElement(Spinner),
      ),
      {
        stdout: withSynchronizedOutput(stdout as unknown as NodeJS.WriteStream),
        patchConsole: false,
      },
    );
    await new Promise((r) => setTimeout(r, 250));
    tree.unmount();

    // Ink still painted real content through the proxy.
    const painted = stdout.frames.some((f) => f.includes('header'));
    expect(painted).toBe(true);
    // Every frame write carries the synchronized-output markers.
    const frameWrites = stdout.frames.filter((f) => f.includes('header') || f.includes('⠸'));
    expect(frameWrites.length).toBeGreaterThan(0);
    for (const f of frameWrites) {
      expect(f.startsWith(BEGIN)).toBe(true);
      expect(f.endsWith(END)).toBe(true);
    }
  });

  it.skipIf(inCi)('keeps a full-screen repaint inside one synchronized block', async () => {
    const stdout = new FakeStdout();
    const tree = render(
      // minHeight = rows forces Ink's clearTerminal path, the one that flickers.
      React.createElement(
        Box,
        { flexDirection: 'column', width: '100%', minHeight: stdout.rows },
        React.createElement(Spinner),
      ),
      {
        stdout: withSynchronizedOutput(stdout as unknown as NodeJS.WriteStream),
        patchConsole: false,
      },
    );
    await new Promise((r) => setTimeout(r, 250));
    tree.unmount();

    const clears = stdout.frames.filter((f) => f.includes('\x1b[2J'));
    expect(clears.length).toBeGreaterThan(0);
    for (const f of clears) {
      // The wipe AND the repaint arrive in a single bracketed write, so the
      // terminal shows the cleared screen and the new content as one frame.
      expect(f.startsWith(BEGIN)).toBe(true);
      expect(f.endsWith(END)).toBe(true);
    }
  });
});
