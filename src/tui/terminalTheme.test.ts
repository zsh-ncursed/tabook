import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  parseOsc11Color,
  colorLuminance,
  pickThemeForBackground,
  terminalThemeName,
  queryTerminalBackground,
} from './terminalTheme.js';

describe('parseOsc11Color', () => {
  it('parses the xterm rgb:hhhh/hhhh/hhhh format', () => {
    expect(parseOsc11Color('rgb:0000/0000/0000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseOsc11Color('rgb:ffff/ffff/ffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseOsc11Color('rgb:1e1e/2e2e/2e2e')).toEqual({ r: 30, g: 46, b: 46 });
    expect(parseOsc11Color('rgb:ff/00/00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseOsc11Color('rgb:abc/def/123')).toEqual({ r: 171, g: 222, b: 18 });
  });

  it('parses the #rrggbb fallback format', () => {
    expect(parseOsc11Color('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseOsc11Color('#1e2e2e')).toEqual({ r: 30, g: 46, b: 46 });
  });

  it('rejects garbage', () => {
    expect(parseOsc11Color('')).toBeNull();
    expect(parseOsc11Color('rgb:zz/00/00')).toBeNull();
    expect(parseOsc11Color('#12345')).toBeNull();
    expect(parseOsc11Color('black')).toBeNull();
  });
});

describe('colorLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(colorLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(colorLuminance({ r: 255, g: 255, b: 255 })).toBe(1);
  });
});

describe('pickThemeForBackground', () => {
  it('keeps the configured theme on a dark background', () => {
    expect(pickThemeForBackground('dracula', { r: 30, g: 30, b: 46 })).toBe('dracula');
  });

  it('switches to the -light variant on a light background when one exists', () => {
    expect(pickThemeForBackground('github', { r: 255, g: 255, b: 255 })).toBe('github-light');
    expect(pickThemeForBackground('gruvbox', { r: 250, g: 250, b: 250 })).toBe('gruvbox-light');
  });

  it('falls back to github-light for themes without a light variant', () => {
    expect(pickThemeForBackground('dracula', { r: 255, g: 255, b: 255 })).toBe('github-light');
  });
});

describe('terminalThemeName', () => {
  it('returns undefined for a dark terminal (no override)', () => {
    expect(terminalThemeName('dracula', { r: 0, g: 0, b: 0 })).toBeUndefined();
    expect(terminalThemeName('github-light', { r: 0, g: 0, b: 0 })).toBeUndefined();
  });

  it('returns the light variant only when it differs from the configured theme', () => {
    expect(terminalThemeName('github', { r: 255, g: 255, b: 255 })).toBe('github-light');
    expect(terminalThemeName('github-light', { r: 255, g: 255, b: 255 })).toBeUndefined();
  });

  it('returns undefined when the query failed', () => {
    expect(terminalThemeName('github', null)).toBeUndefined();
  });
});

describe('queryTerminalBackground', () => {
  const origStdin = process.stdin;
  const origStdout = process.stdout;

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true });
    vi.restoreAllMocks();
  });

  function fakeStdin(): EventEmitter & { setRawMode: (v: boolean) => void; resume: () => void } {
    const stdin = new EventEmitter() as EventEmitter & {
      setRawMode: (v: boolean) => void;
      resume: () => void;
    };
    const rawModes: boolean[] = [];
    stdin.setRawMode = (v: boolean) => {
      rawModes.push(v);
    };
    stdin.resume = () => {};
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
    return stdin;
  }

  it('answers a response with ST terminator and no newline (raw-mode regression)', async () => {
    const stdin = fakeStdin();
    const rawModes: boolean[] = [];
    stdin.setRawMode = (v: boolean) => {
      rawModes.push(v);
    };
    const writeSpy = vi.spyOn(process.stdout, 'write');

    const p = queryTerminalBackground(1000);
    // The query must run in raw mode (else canonical mode swallows the
    // newline-less response) — regression for the pty-found bug.
    expect(rawModes).toEqual([true]);
    expect(writeSpy).toHaveBeenCalledWith('\x1b]11;?\x1b\\');

    stdin.emit('data', Buffer.from('\x1b]11;rgb:ffff/ffff/ffff\x1b\\'));
    await expect(p).resolves.toEqual({ r: 255, g: 255, b: 255 });
    // Raw mode restored after the query so ink can take over cleanly.
    expect(rawModes).toEqual([true, false]);
  });

  it('resolves null on timeout and restores raw mode', async () => {
    const stdin = fakeStdin();
    const rawModes: boolean[] = [];
    stdin.setRawMode = (v: boolean) => {
      rawModes.push(v);
    };

    await expect(queryTerminalBackground(20)).resolves.toBeNull();
    expect(rawModes).toEqual([true, false]);
  });
});
