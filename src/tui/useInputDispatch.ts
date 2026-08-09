import { useCallback, useRef, type MutableRefObject } from 'react';
import { useInput, type Key } from 'ink';

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
 */
export function useInputDispatch(
  isActive: boolean,
): MutableRefObject<(input: string, key: Key) => void> {
  const dispatchRef = useRef<(input: string, key: Key) => void>(() => {});
  const handleInput = useCallback((input: string, key: Key) => {
    dispatchRef.current(input, key);
  }, []);
  useInput(handleInput, { isActive });
  return dispatchRef;
}
