import type { KeyAction } from '../config/defaults.js';
import type { Config } from '../config/defaults.js';

export interface KeyEvent {
  input: string;
  key: {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageDown: boolean;
    pageUp: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    meta: boolean;
  };
}

export function resolveKeyName(input: string, key: KeyEvent['key']): string | null {
  if (key.escape) return 'escape';
  if (key.return) return 'enter';
  if (key.backspace) return 'backspace';
  if (key.delete) return 'delete';
  if (key.tab) return 'tab';
  if (key.pageUp) return 'pageup';
  if (key.pageDown) return 'pagedown';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.ctrl && input.length === 1 && /^[a-zA-Z]$/.test(input)) {
    return `ctrl+${input.toLowerCase()}`;
  }
  if (input === ' ') return 'space';
  if (input !== '' && input !== '\t') return input;
  return null;
}

export interface ActionResolver {
  resolve(keyName: string): KeyAction | undefined;
  feed(keyName: string): KeyAction | undefined;
}

export function createActionResolver(config: Config): ActionResolver {
  const keymap = new Map<string, KeyAction>();
  for (const [key, action] of Object.entries(config.keybindings)) {
    keymap.set(key, action);
  }
  const sequence: string[] = [];

  const lookup = (keys: string[]): KeyAction | undefined => {
    return keymap.get(keys.join(''));
  };

  return {
    resolve(keyName: string): KeyAction | undefined {
      return lookup([keyName]);
    },
    feed(keyName: string): KeyAction | undefined {
      const candidate = [...sequence, keyName];
      const direct = lookup([keyName]);
      const combo = lookup(candidate);
      if (combo !== undefined) {
        sequence.length = 0;
        return combo;
      }
      sequence.length = 0;
      if (candidate.length >= 2) {
        sequence.push(keyName);
        return direct;
      }
      if (keyName.length > 1) {
        return direct;
      }
      sequence.push(keyName);
      return direct;
    },
  };
}

export function actionLabel(action: KeyAction): string {
  const labels: Partial<Record<KeyAction, string>> = {
    move_cursor_up: 'Move up',
    move_cursor_down: 'Move down',
    move_cursor_left: 'Move left',
    move_cursor_right: 'Move right',
    scroll_down: 'Scroll down',
    scroll_up: 'Scroll up',
    page_down: 'Next page',
    page_up: 'Previous page',
    go_to_start: 'Go to start',
    go_to_end: 'Go to end',
    select: 'Select / open',
    back: 'Back',
    quit: 'Quit / close view',
    open_file: 'Open file',
    save_to_library: 'Save to library',
    delete_from_library: 'Delete from library',
    add_bookmark: 'Add bookmark',
    list_bookmarks: 'List bookmarks',
    toc: 'Table of contents',
    book_info: 'Book info',
    help: 'Help',
    command: 'Command line',
    search: 'Search',
    search_next: 'Next result',
    search_prev: 'Previous result',
    sort_cycle: 'Cycle sort',
    toggle_simplified: 'Toggle simplified mode',
    toggle_respect_css: 'Toggle publisher CSS',
    toggle_justify: 'Toggle text justify',
    toggle_wide: 'Toggle wide screen',
    toggle_recent: 'Toggle recent books',
  };
  return labels[action] ?? action;
}
