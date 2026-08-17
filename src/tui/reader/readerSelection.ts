import type { ReaderSession } from './readerModel.js';
import type { SelectionRange } from '../renderLines.js';

// A cell in the reader viewport: line index (within the visible viewport)
// and rendered column (indent/prefix spaces count, matching the mouse X).
export interface SelCell {
  line: number;
  col: number;
}

export interface TextSelection {
  start: SelCell;
  end: SelCell;
}

// Book-wide character offset of the selection's leading edge (the cell that
// is earliest in reading order, i.e. the anchor when dragging up/left).
export function selectionStartOffset(session: ReaderSession, sel: TextSelection): number {
  const minLine = Math.min(sel.start.line, sel.end.line);
  const atMin =
    sel.start.line < sel.end.line ||
    (sel.start.line === sel.end.line && sel.start.col <= sel.end.col)
      ? sel.start
      : sel.end;
  return session.charOffsetAt(minLine, atMin.col);
}

// Joined, whitespace-collapsed text of the selection (rendered line slices
// are joined with spaces so a multi-line selection reads as one line).
export function selectionText(session: ReaderSession, sel: TextSelection): string {
  const minLine = Math.min(sel.start.line, sel.end.line);
  const maxLine = Math.max(sel.start.line, sel.end.line);
  const parts: string[] = [];
  for (let i = minLine; i <= maxLine; i++) {
    const from = i === minLine ? Math.min(sel.start.col, sel.end.col) : 0;
    const to = i === maxLine ? Math.max(sel.start.col, sel.end.col) + 1 : Number.MAX_SAFE_INTEGER;
    parts.push(session.selectionText(i, from, to));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function selectionCharCount(session: ReaderSession, sel: TextSelection): number {
  const minLine = Math.min(sel.start.line, sel.end.line);
  const maxLine = Math.max(sel.start.line, sel.end.line);
  let n = 0;
  for (let i = minLine; i <= maxLine; i++) {
    const from = i === minLine ? Math.min(sel.start.col, sel.end.col) : 0;
    const to = i === maxLine ? Math.max(sel.start.col, sel.end.col) + 1 : Number.MAX_SAFE_INTEGER;
    n += session.selectionText(i, from, to).length;
  }
  return n;
}

// Render the selection highlight for viewport line i, or undefined when the
// line is outside the selection. Columns are rendered coordinates; to is
// exclusive (a click at column c selects the cell at c, so to = c + 1).
export function selectionRangeForLine(
  sel: TextSelection | null,
  i: number,
): SelectionRange | undefined {
  if (!sel) return undefined;
  const minLine = Math.min(sel.start.line, sel.end.line);
  const maxLine = Math.max(sel.start.line, sel.end.line);
  if (i < minLine || i > maxLine) return undefined;
  if (minLine === maxLine) {
    return {
      from: Math.min(sel.start.col, sel.end.col),
      to: Math.max(sel.start.col, sel.end.col) + 1,
    };
  }
  if (i === minLine) {
    const col = sel.start.line <= sel.end.line ? sel.start.col : sel.end.col;
    return { from: col, to: Number.MAX_SAFE_INTEGER };
  }
  if (i === maxLine) {
    const col = sel.start.line <= sel.end.line ? sel.end.col : sel.start.col;
    return { from: 0, to: col + 1 };
  }
  return { from: 0, to: Number.MAX_SAFE_INTEGER };
}
