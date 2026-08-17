// Line↔row mapping for lists whose rows have non-uniform heights (e.g. book
// cards of CARD_ROWS lines next to 1-line group headers). The library and
// OPDS views both render a window of rows into a fixed number of terminal
// lines; this module translates between the two coordinate spaces so cursor
// centering, visible slicing and mouse hit-testing stay correct.

import type { KeyAction } from '../config/defaults.js';
//
// Coordinates:
//   row   — index into the row array (a book, a header, an entry, …)
//   line  — terminal line within the list area (0-based, independent of the
//           screen header offset)

// Shared card geometry for cover thumbnails in the library and OPDS lists:
// each book/entry occupies CARD_ROWS terminal lines so a COVER_W-wide
// thumbnail can be drawn next to the text without covering neighbor rows.
export const CARD_ROWS = 3;
export const COVER_W = 12;

export function buildLineIndex<T>(
  rows: readonly T[],
  heightOf: (row: T) => number,
): {
  /** prefix[i] = number of terminal lines occupied by rows[0..i-1]. */
  prefix: number[];
  /** Total lines occupied by all rows. */
  total: number;
} {
  const prefix: number[] = [0];
  for (const row of rows) {
    prefix.push(prefix[prefix.length - 1]! + heightOf(row));
  }
  return { prefix, total: prefix[prefix.length - 1]! };
}

/** First row index whose line range contains `line` (0-based). */
export function rowAtLine<T>(
  rows: readonly T[],
  index: { prefix: number[] },
  line: number,
): number {
  const prefix = index.prefix;
  // Binary search for the largest i with prefix[i] <= line.
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prefix[mid]! <= line) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/**
 * The window of rows that fits into `maxLines` terminal lines with `cursor`
 * roughly centered. Returns the inclusive row range [start, end).
 */
export function visibleWindow<T>(
  rows: readonly T[],
  index: { prefix: number[]; total: number },
  cursor: number,
  maxLines: number,
): { start: number; end: number } {
  if (rows.length === 0) return { start: 0, end: 0 };
  const clamped = Math.min(Math.max(0, cursor), rows.length - 1);
  const prefix = index.prefix;
  const maxTop = Math.max(0, index.total - maxLines);
  // Row cursor occupies lines [prefix[c], prefix[c+1]). Center it: the top
  // of the window sits half a viewport above the row start, clamped so the
  // window never shows empty lines beyond the list.
  const idealTop = prefix[clamped]! - Math.floor(maxLines / 2);
  const top = Math.min(maxTop, Math.max(0, idealTop));
  // start = first row with prefix[start+1] > top.
  const start = rowAtLine(rows, index, top);
  // end = first row that starts at or after top + maxLines.
  const end = rowAtLine(rows, index, top + maxLines - 1) + 1;
  return { start, end };
}

/**
 * The visible [start, end) slice of a uniform-height (1-line row) list,
 * centered on the cursor — the row-uniform equivalent of visibleWindow (the
 * line index is the identity, so no prefix array is needed). Shared by the
 * command palette and the downloads list, which used to repeat the same
 * clamp arithmetic.
 */
export function centeredWindow(
  count: number,
  cursor: number,
  viewport: number,
): { start: number; end: number } {
  if (count === 0) return { start: 0, end: 0 };
  const clamped = Math.min(Math.max(0, cursor), count - 1);
  const start = Math.max(
    0,
    Math.min(clamped - Math.floor(viewport / 2), Math.max(0, count - viewport)),
  );
  return { start, end: Math.min(count, start + viewport) };
}

/**
 * The cursor index after a navigation action, clamped to [0, count - 1].
 * Shared by the views' per-mode key switches, which used to repeat the same
 * Math.min/Math.max arithmetic for every list (catalogs, feed entries,
 * downloads, …). Returns the cursor unchanged for non-navigation actions.
 */
export function cursorForAction(
  action: KeyAction | undefined,
  cursor: number,
  count: number,
  pageSize = 1,
): number {
  const last = Math.max(0, count - 1);
  switch (action) {
    case 'move_cursor_down':
      return Math.min(last, cursor + 1);
    case 'move_cursor_up':
      return Math.max(0, cursor - 1);
    case 'page_down':
      return Math.min(last, cursor + Math.max(1, pageSize));
    case 'page_up':
      return Math.max(0, cursor - Math.max(1, pageSize));
    case 'go_to_start':
      return 0;
    case 'go_to_end':
      return last;
    default:
      return cursor;
  }
}
