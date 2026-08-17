import { describe, it, expect } from 'vitest';
import {
  buildLineIndex,
  rowAtLine,
  visibleWindow,
  cursorForAction,
  CARD_ROWS,
  COVER_W,
} from './listLayout.js';

// Rows with mixed heights: 1-line headers and 3-line cards.
const heightOf = (row: { h: number }): number => row.h;
const rows = [{ h: 1 }, { h: 3 }, { h: 3 }, { h: 1 }, { h: 3 }];

describe('cursorForAction', () => {
  it('clamps navigation within [0, count - 1]', () => {
    expect(cursorForAction('move_cursor_down', 0, 5)).toBe(1);
    expect(cursorForAction('move_cursor_down', 4, 5)).toBe(4);
    expect(cursorForAction('move_cursor_up', 0, 5)).toBe(0);
    expect(cursorForAction('move_cursor_up', 4, 5)).toBe(3);
    expect(cursorForAction('go_to_start', 3, 5)).toBe(0);
    expect(cursorForAction('go_to_end', 0, 5)).toBe(4);
  });

  it('handles empty lists without going negative', () => {
    expect(cursorForAction('move_cursor_down', 0, 0)).toBe(0);
    expect(cursorForAction('move_cursor_up', 0, 0)).toBe(0);
    expect(cursorForAction('go_to_end', 0, 0)).toBe(0);
  });

  it('pages by pageSize', () => {
    expect(cursorForAction('page_down', 0, 10, 4)).toBe(4);
    expect(cursorForAction('page_down', 8, 10, 4)).toBe(9);
    expect(cursorForAction('page_up', 9, 10, 4)).toBe(5);
    expect(cursorForAction('page_up', 0, 10, 4)).toBe(0);
  });

  it('returns the cursor unchanged for non-navigation actions', () => {
    expect(cursorForAction('select', 2, 5)).toBe(2);
    expect(cursorForAction('back', 2, 5)).toBe(2);
    expect(cursorForAction(undefined, 2, 5)).toBe(2);
  });
});

describe('buildLineIndex', () => {
  it('accumulates line counts with a leading zero', () => {
    const idx = buildLineIndex(rows, heightOf);
    expect(idx.prefix).toEqual([0, 1, 4, 7, 8, 11]);
    expect(idx.total).toBe(11);
  });

  it('handles an empty list', () => {
    const idx = buildLineIndex([], heightOf);
    expect(idx.prefix).toEqual([0]);
    expect(idx.total).toBe(0);
  });
});

describe('rowAtLine', () => {
  const idx = buildLineIndex(rows, heightOf);

  it('maps each line to its owning row', () => {
    // Row 0 spans lines 0 (header, h=1).
    expect(rowAtLine(rows, idx, 0)).toBe(0);
    // Row 1 spans lines 1..3 (3-line card).
    expect(rowAtLine(rows, idx, 1)).toBe(1);
    expect(rowAtLine(rows, idx, 3)).toBe(1);
    // Row 2 spans lines 4..6.
    expect(rowAtLine(rows, idx, 4)).toBe(2);
    expect(rowAtLine(rows, idx, 6)).toBe(2);
    // Row 3 (header) line 7.
    expect(rowAtLine(rows, idx, 7)).toBe(3);
    // Row 4 spans lines 8..10.
    expect(rowAtLine(rows, idx, 10)).toBe(4);
  });

  it('clamps to the last row for lines past the end', () => {
    expect(rowAtLine(rows, idx, 999)).toBe(4);
  });

  it('clamps to row 0 for empty lists', () => {
    const empty = buildLineIndex([], heightOf);
    expect(rowAtLine([], empty, 0)).toBe(0);
  });
});

describe('visibleWindow', () => {
  it('centers the cursor row in the window', () => {
    const idx = buildLineIndex(rows, heightOf);
    // 5 visible lines → cursor row 2 (lines 4..6) centered at top ≈ line 2.
    const w = visibleWindow(rows, idx, 2, 5);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.end).toBeLessThanOrEqual(rows.length);
    // The cursor row (2) must be inside [start, end).
    expect(w.start).toBeLessThanOrEqual(2);
    expect(w.end).toBeGreaterThan(2);
  });

  it('shows the whole list when it fits', () => {
    const idx = buildLineIndex(rows, heightOf);
    const w = visibleWindow(rows, idx, 0, 20);
    expect(w).toEqual({ start: 0, end: rows.length });
  });

  it('returns an empty window for an empty list', () => {
    const idx = buildLineIndex([], heightOf);
    expect(visibleWindow([], idx, 0, 10)).toEqual({ start: 0, end: 0 });
  });

  it('clamps a cursor past the end to the last row', () => {
    const idx = buildLineIndex(rows, heightOf);
    const w = visibleWindow(rows, idx, 999, 4);
    expect(w.end).toBe(rows.length);
  });

  it('a 3-line window starting at row 0 still includes row 0 only partially', () => {
    const idx = buildLineIndex(rows, heightOf);
    // Window top clamped to 0; 3 lines show rows 0..1 (header + first card).
    const w = visibleWindow(rows, idx, 0, 3);
    expect(w.start).toBe(0);
    expect(w.end).toBeGreaterThanOrEqual(2);
  });
});

describe('shared card geometry', () => {
  it('defines a cover thumbnail box for list cards', () => {
    expect(CARD_ROWS).toBe(3);
    expect(COVER_W).toBeGreaterThan(0);
    expect(COVER_W).toBeGreaterThanOrEqual(10);
  });
});
