import { useCallback, useRef, type MutableRefObject } from 'react';
import { useInput, type Key } from 'ink';
import { wasMouseChunkRecent } from './mouse.js';
import { splitChars } from '../utils/text.js';

/**
 * A single stable useInput handler that forwards every keypress through a ref
 * the caller overwrites on each render.
 *
 * Ink's useInput re-registers (and re-enters raw mode) whenever the callback
 * identity changes, so a handler that closes over fresh state would cause a
 * raw-mode round-trip on every render. Instead the hook registers one stable
 * callback and routes input through `dispatchRef.current`; callers assign a
 * fresh closure to that ref each render, so the handler always sees the latest
 * state without re-registering. The `isActive` flag still gates whether Ink
 * delivers input to the handler at all.
 *
 * With `splitChunks: true` (the reader), a multi-char stdin chunk (fast
 * keypresses like "t\u001b" arriving together, or pasted text) is split into
 * individual code points and each is dispatched with a synthetic Key, because
 * Ink only parses the first char of a chunk into `key` and would drop the
 * rest.
 */
export function useInputDispatch(
  isActive: boolean,
  opts?: { splitChunks?: boolean },
): MutableRefObject<(input: string, key: Key) => void> {
  const dispatchRef = useRef<(input: string, key: Key) => void>(() => {});
  const handleInput = useCallback(
    (input: string, key: Key) => {
      // Ink mis-parses the leading ESC[ of an SGR mouse sequence as the '['
      // key — one bogus keypress per mouse chunk. The mouse event itself was
      // already handled by the mouse module's own stdin listener, so drop the
      // echo key (in the reader '[' is prev_chapter and would fight a drag).
      if (wasMouseChunkRecent()) return;
      if (opts?.splitChunks && input.length > 1 && !key.ctrl && !key.meta) {
        // Iterate code points, not UTF-16 code units: split('') would tear
        // CJK / emoji surrogate pairs into lone halves and dispatch garbage.
        for (const ch of splitChars(input)) {
          dispatchRef.current(ch, keyForChar(ch));
        }
        return;
      }
      dispatchRef.current(input, key);
    },
    [opts?.splitChunks],
  );
  useInput(handleInput, { isActive });
  return dispatchRef;
}

function keyForChar(ch: string): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: ch === '\r' || ch === '\n',
    escape: ch === '\u001b',
    ctrl: false,
    shift: false,
    tab: ch === '\t',
    backspace: ch === '\u007f' || ch === '\b',
    delete: false,
    meta: false,
  };
}
