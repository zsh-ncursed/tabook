import { describe, it, expect } from 'vitest';
import { parseMouseChunk, type MouseClick } from './mouse.js';

function parseAll(text: string): MouseClick[] {
  const out: MouseClick[] = [];
  parseMouseChunk(text, (c) => out.push(c));
  return out;
}

describe('parseMouseChunk', () => {
  it('parses an SGR left-button press', () => {
    expect(parseAll('\x1b[<0;5;10M')).toEqual([
      { x: 5, y: 10, button: 'left', press: true, motion: false },
    ]);
  });

  it('parses an SGR left-button release', () => {
    expect(parseAll('\x1b[<0;5;10m')).toEqual([
      { x: 5, y: 10, button: 'left', press: false, motion: false },
    ]);
  });

  it('distinguishes middle and right buttons', () => {
    expect(parseAll('\x1b[<1;1;1M')).toEqual([
      { x: 1, y: 1, button: 'middle', press: true, motion: false },
    ]);
    expect(parseAll('\x1b[<2;1;1M')).toEqual([
      { x: 1, y: 1, button: 'right', press: true, motion: false },
    ]);
  });

  it('flags SGR motion events (bit 5) as drags', () => {
    // left button held + pointer moved
    expect(parseAll('\x1b[<32;5;10M')).toEqual([
      { x: 5, y: 10, button: 'left', press: true, motion: true },
    ]);
    // with modifiers (ctrl = bit 4): 32 | 16 = 48
    expect(parseAll('\x1b[<48;3;7M')).toEqual([
      { x: 3, y: 7, button: 'left', press: true, motion: true },
    ]);
  });

  it('parses multiple events in one chunk', () => {
    const clicks = parseAll('\x1b[<0;1;1M\x1b[<32;2;1M\x1b[<0;2;1m');
    expect(clicks).toHaveLength(3);
    expect(clicks[0]).toMatchObject({ x: 1, y: 1, press: true, motion: false });
    expect(clicks[1]).toMatchObject({ x: 2, y: 1, press: true, motion: true });
    expect(clicks[2]).toMatchObject({ x: 2, y: 1, press: false, motion: false });
  });

  it('ignores non-mouse bytes', () => {
    expect(parseAll('hello world')).toEqual([]);
    expect(parseAll('\x1b[<0;1;1')).toEqual([]); // incomplete
  });

  it('keeps event bodies split across chunks (buffered by the caller via stdin data events)', () => {
    // A single chunk with an incomplete sequence emits nothing; the caller
    // (stdin data listener) sees the continuation in a later chunk.
    expect(parseAll('\x1b[<0;1;1')).toEqual([]);
    expect(parseAll('M')).toEqual([]);
    // But when both halves arrive in one chunk they parse fine.
    expect(parseAll('\x1b[<0;1;1M')).toHaveLength(1);
  });
});
