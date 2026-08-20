import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';
import { ListModal } from './ListModal.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { useInputDispatch } from '../useInputDispatch.js';

export interface ThemePickerProps {
  theme: Theme;
  config: Config;
  items: string[];
  currentTheme: string;
  isActive: boolean;
  /** Live preview: called with the highlighted theme on cursor moves. */
  onPreview: (name: string) => void;
  /** Apply the selected theme (persist + notify). */
  onApply: (name: string) => void;
  /** Close the picker. `apply` says whether a theme was chosen; `previousTheme`
   * is the theme that was active when the picker opened, for cancel to
   * restore. */
  onClose: (apply: boolean, previousTheme: string | null) => void;
}

// Theme picker overlay. Keys go through the configurable keymap
// (move_cursor_up/down, select/back), so rebinds apply here too. enter and
// space are the default select / page_down bindings; both apply the
// highlighted theme. Cursor moves live-preview the theme via onPreview.
// The pre-pick theme is remembered so cancel can restore it.
export function ThemePicker(props: ThemePickerProps): React.JSX.Element {
  const { theme, config, items, currentTheme, isActive, onPreview, onApply, onClose } = props;
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const [cursor, setCursor] = useState(() => {
    const idx = items.indexOf(currentTheme);
    return idx >= 0 ? idx : 0;
  });
  // The theme that was active when the picker mounted (useRef keeps the first
  // value even as onPreview updates the live theme), so cancel can restore it.
  const previousThemeRef = useRef<string | null>(currentTheme);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const callbacksRef = useRef({ onPreview, onApply, onClose });
  callbacksRef.current = { onPreview, onApply, onClose };

  // Live preview on cursor change.
  useEffect(() => {
    const name = itemsRef.current[cursor];
    if (name && THEMES[name]) callbacksRef.current.onPreview(name);
  }, [cursor]);

  const dispatchRef = useInputDispatch(isActive);
  dispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;
    const count = itemsRef.current.length;
    const applyTheme = (): void => {
      const name = itemsRef.current[cursor];
      if (name && THEMES[name]) callbacksRef.current.onApply(name);
    };
    const action = resolver.feed(keyName);
    switch (action) {
      case 'back':
        callbacksRef.current.onClose(false, previousThemeRef.current);
        return;
      case 'move_cursor_down':
        setCursor((c) => Math.min(count - 1, c + 1));
        return;
      case 'move_cursor_up':
        setCursor((c) => Math.max(0, c - 1));
        return;
      case 'select':
      case 'page_down':
        applyTheme();
        callbacksRef.current.onClose(true, previousThemeRef.current);
        return;
      default:
        return;
    }
  };

  return (
    <ListModal
      theme={theme}
      title="Theme picker"
      items={items.map((n) => ({ id: n, label: n, accent: n === currentTheme }))}
      cursor={cursor}
      height={Math.min(14, items.length)}
      footer="j/k preview · enter apply · esc cancel"
    />
  );
}
