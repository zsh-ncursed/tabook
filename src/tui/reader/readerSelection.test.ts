import { describe, it, expect, vi } from 'vitest';
import type { ReaderSession } from './readerModel.js';
import {
  selectionStartOffset,
  selectionText,
  selectionCharCount,
  selectionRangeForLine,
  type TextSelection,
} from './readerSelection.js';

// Deterministic viewport: each line renders the given text, charOffsetAt maps
// (line, col) to a book-wide offset (line*100+col) so the leading-edge logic
// is testable in isolation from the real layout.
function makeSession(lineText: string[] = ['abcde', 'abcde', 'abcde']): ReaderSession {
  return {
    charOffsetAt: vi.fn((line: number, col: number) => line * 100 + col),
    selectionText: vi.fn((line: number, from: number, to: number) => {
      const text = lineText[line] ?? '';
      const a = Math.max(0, Math.min(text.length, from));
      const b = Math.max(a, Math.min(text.length, to));
      return text.slice(a, b);
    }),
  } as unknown as ReaderSession;
}

describe('selectionStartOffset', () => {
  it('uses the start cell when dragging downward (start above end)', () => {
    const session = makeSession();
    const sel: TextSelection = { start: { line: 1, col: 5 }, end: { line: 2, col: 0 } };
    expect(selectionStartOffset(session, sel)).toBe(105);
  });

  it('uses the end cell when dragging upward (start below end)', () => {
    const session = makeSession();
    const sel: TextSelection = { start: { line: 2, col: 0 }, end: { line: 1, col: 5 } };
    expect(selectionStartOffset(session, sel)).toBe(105);
  });

  it('picks the leftmost cell on the same line', () => {
    const session = makeSession();
    const sel: TextSelection = { start: { line: 1, col: 3 }, end: { line: 1, col: 1 } };
    expect(selectionStartOffset(session, sel)).toBe(101);
  });
});

describe('selectionText', () => {
  it('slices a single line from min(cols) to max(cols)+1', () => {
    const session = makeSession();
    const sel: TextSelection = { start: { line: 1, col: 1 }, end: { line: 1, col: 3 } };
    expect(selectionText(session, sel)).toBe('bcd');
  });

  it('joins multi-line selections with spaces and reads to end of line', () => {
    const session = makeSession();
    const sel: TextSelection = { start: { line: 1, col: 1 }, end: { line: 2, col: 2 } };
    expect(selectionText(session, sel)).toBe('bcde abc');
  });

  it('collapses whitespace across the join and trims the result', () => {
    const session = makeSession(['a  b', 'c']);
    const sel: TextSelection = { start: { line: 0, col: 0 }, end: { line: 1, col: 1 } };
    expect(selectionText(session, sel)).toBe('a b c');
  });

  it('trims leading/trailing whitespace on a partial-line selection', () => {
    const session = makeSession(['x  y']);
    const sel: TextSelection = { start: { line: 0, col: 0 }, end: { line: 0, col: 1 } };
    expect(selectionText(session, sel)).toBe('x');
  });
});

describe('selectionCharCount', () => {
  it('counts characters on a single line', () => {
    const session = makeSession();
    // cols 1..4 → 'bcd'
    const sel: TextSelection = { start: { line: 1, col: 1 }, end: { line: 1, col: 3 } };
    expect(selectionCharCount(session, sel)).toBe(3);
  });

  it('sums characters across lines', () => {
    const session = makeSession();
    const sel: TextSelection = { start: { line: 1, col: 1 }, end: { line: 2, col: 2 } };
    expect(selectionCharCount(session, sel)).toBe(7);
  });
});

describe('selectionRangeForLine', () => {
  it('returns undefined for a null selection', () => {
    expect(selectionRangeForLine(null, 0)).toBeUndefined();
  });

  it('returns undefined outside the selection lines', () => {
    const session = makeSession();
    const sel: TextSelection = { start: { line: 1, col: 1 }, end: { line: 2, col: 3 } };
    expect(selectionRangeForLine(sel, 0)).toBeUndefined();
    expect(selectionRangeForLine(sel, 3)).toBeUndefined();
    expect(session.charOffsetAt).not.toHaveBeenCalled();
  });

  it('highlights a single-line selection with exclusive to', () => {
    const sel: TextSelection = { start: { line: 1, col: 1 }, end: { line: 1, col: 3 } };
    expect(selectionRangeForLine(sel, 1)).toEqual({ from: 1, to: 4 });
  });

  it('highlights the anchor line to end-of-line on a downward drag', () => {
    const sel: TextSelection = { start: { line: 1, col: 1 }, end: { line: 2, col: 3 } };
    expect(selectionRangeForLine(sel, 1)).toEqual({ from: 1, to: Number.MAX_SAFE_INTEGER });
    expect(selectionRangeForLine(sel, 2)).toEqual({ from: 0, to: 4 });
  });

  it('uses the end cell as the anchor on an upward drag', () => {
    const sel: TextSelection = { start: { line: 2, col: 3 }, end: { line: 1, col: 1 } };
    expect(selectionRangeForLine(sel, 1)).toEqual({ from: 1, to: Number.MAX_SAFE_INTEGER });
    expect(selectionRangeForLine(sel, 2)).toEqual({ from: 0, to: 4 });
  });

  it('highlights middle lines in full', () => {
    const sel: TextSelection = { start: { line: 0, col: 0 }, end: { line: 2, col: 0 } };
    expect(selectionRangeForLine(sel, 1)).toEqual({ from: 0, to: Number.MAX_SAFE_INTEGER });
  });
});
