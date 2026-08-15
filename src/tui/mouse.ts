// SGR mouse support — click-to-select in lists, like vim/less.
//
// ink 5 has no mouse hook, so we implement it directly over the terminal
// protocol: enable button-event reporting (DECSET 1000) with SGR coordinates
// (DECSET 1006, `ESC [ < b ; x ; y M|m` — press vs release), parse the bytes
// that arrive on stdin, and fan clicks out to subscribers. The escape codes
// are standard ANSI (used by vim, less, htop, …); terminals without mouse
// support simply ignore the enable sequence.
import { useEffect, useRef } from 'react';

export type MouseButton = 'left' | 'right' | 'middle' | 'none' | 'unknown';

export interface MouseClick {
  x: number; // 1-based column (as reported by the terminal)
  y: number; // 1-based row
  button: MouseButton;
  press: boolean;
}

type ClickListener = (click: MouseClick) => void;

const listeners = new Set<ClickListener>();
let attached = false;

export function enableMouseReporting(): void {
  // 1000 = button press/release events, 1006 = SGR extended coordinates.
  process.stdout.write('\x1b[?1000h\x1b[?1006h');
  attach();
}

export function disableMouseReporting(): void {
  process.stdout.write('\x1b[?1000l\x1b[?1006l');
  detach();
}

/** Subscribe to mouse clicks. Returns an unsubscribe function. */
export function subscribeMouseClicks(fn: ClickListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * React hook: subscribe to mouse clicks for the lifetime of the component.
 * The handler is read from a ref, so it always sees fresh state without
 * re-subscribing.
 */
export function useMouseClicks(handler: (click: MouseClick) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeMouseClicks((click) => ref.current(click)), []);
}

function attach(): void {
  if (attached) return;
  attached = true;
  process.stdin.on('data', onData);
}

function detach(): void {
  if (!attached) return;
  attached = false;
  process.stdin.off('data', onData);
}

function onData(chunk: Buffer | string): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  parseMouseChunk(text, emitMouseClick);
}

/** Dispatch a click to all subscribers (used by the parser and by tests). */
export function emitMouseClick(click: MouseClick): void {
  for (const fn of listeners) fn(click);
}

/**
 * Parse a chunk of raw stdin bytes for SGR mouse sequences and legacy x10
 * sequences. Chunks may contain multiple events (and half events split
 * across chunks). The x10 legacy form (`ESC [ M` + 3 bytes) requires state
 * across chunks, which we buffer here.
 */
export function parseMouseChunk(text: string, emit: (click: MouseClick) => void): void {
  let i = 0;
  while (i < text.length) {
    // SGR: ESC [ < Cb ; Cx ; Cy (M press | m release)
    if (text[i] === '\x1b' && text[i + 1] === '[' && text[i + 2] === '<') {
      const end = text.indexOf('M', i + 3);
      const endRelease = text.indexOf('m', i + 3);
      let terminator = -1;
      let isPress = true;
      if (end !== -1 && (endRelease === -1 || end < endRelease)) {
        terminator = end;
        isPress = true;
      } else if (endRelease !== -1) {
        terminator = endRelease;
        isPress = false;
      }
      if (terminator === -1) return; // incomplete — wait for more data
      const body = text.slice(i + 3, terminator);
      const [b, x, y] = body.split(';').map((v) => Number(v));
      if (b !== undefined && x !== undefined && y !== undefined) {
        emit({ x, y, button: buttonFromCode(b), press: isPress });
      }
      i = terminator + 1;
      continue;
    }
    i++;
  }
}

function buttonFromCode(code: number): MouseButton {
  const mod = code & 3;
  if (mod === 0) return 'left';
  if (mod === 1) return 'middle';
  if (mod === 2) return 'right';
  return 'none'; // release with no button
}
