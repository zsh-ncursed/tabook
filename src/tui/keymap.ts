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
  // Основные клавиши управления курсором и навигации
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

  // Комбинации с Ctrl (только для букв)
  if (key.ctrl && input.length === 1 && /^[a-zA-Z]$/.test(input)) {
    return `ctrl+${input.toLowerCase()}`;
  }

  // Пробел и другие символы
  if (input === ' ') return 'space';
  // LF is Enter in terminal terms: ink sets key.return only for CR ('\r'), so
  // a terminal (or Ctrl+J, which sends the same byte) would otherwise leak a
  // raw '\n' into text inputs — e.g. corrupting the command palette query.
  if (input === '\n') return 'enter';
  if (input.length === 1 && /^[Ff][1-9]$/.test(input)) {
    return `f${input.toLowerCase().replace('f', '')}`;
  }
  if (input !== '' && input !== '\t') return input;

  // Логирование необработанных клавиш (для отладки)
  // console.warn(`Неизвестная клавиша: ${input}, ${JSON.stringify(key)}`);
  return null;
}

export interface ActionResolver {
  resolve(keyName: string): KeyAction | undefined;
  feed(keyName: string): KeyAction | undefined;
}

// Key names resolveKeyName emits for special keys, i.e. NOT
// character-by-character combos. Used to tell real 2-char combos ('gg') apart
// from 2-char named keys ('up', 'tab') when buffering sequences.
const NAMED_KEYS: ReadonlySet<string> = new Set([
  'up',
  'down',
  'left',
  'right',
  'pageup',
  'pagedown',
  'enter',
  'escape',
  'backspace',
  'delete',
  'tab',
  'space',
]);

export function createActionResolver(config: Config): ActionResolver {
  const keymap = new Map<string, KeyAction>();
  for (const [key, action] of Object.entries(config.keybindings)) {
    keymap.set(key, action);
  }

  // Для отслеживания последовательностей клавиш
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

      // Проверка на совпадение с комбинацией
      const combo = candidate.length > 1 ? lookup(candidate) : undefined;
      if (combo !== undefined) {
        sequence.length = 0; // Очистка буфера после выполнения комбинации
        return combo;
      }

      // Is this key the first half of a two-keystroke combo (like 'gg')?
      // Only literal 2-character bindings count: named keys ('up', 'tab') are
      // also 2 chars and contain no '+', so without the exclusion 'u' would
      // look like the prefix of a 'up' combo, get buffered and never fire.
      // This stayed hidden while OPDS verbs were hardcoded above the resolver;
      // routing 'u' through the keymap exposed it.
      const isPrefix =
        keyName.length === 1 &&
        [...keymap.keys()].some(
          (k) => k.startsWith(keyName) && k.length === 2 && !k.includes('+') && !NAMED_KEYS.has(k),
        );

      // A non-prefix key breaks any pending combo: drop the buffered keys
      // before deciding. Without this reset, 'g' then 'j' leaves 'g'
      // buffered and the next 'g' wrongly completes 'gg' → go_to_start.
      sequence.length = 0;

      if (isPrefix) {
        sequence.push(keyName);
        return undefined; // Буферизуем клавишу для ожидания следующей
      }

      // Если комбинация не найдена, возвращаем действие для текущей клавиши
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
    delete_file: 'Delete file',
    add_bookmark: 'Add bookmark',
    list_bookmarks: 'List bookmarks',
    toc: 'Table of contents',
    book_info: 'Book info',
    help: 'Help',
    command: 'Command line',
    command_palette: 'Command palette',
    search: 'Search',
    search_next: 'Next result',
    search_prev: 'Previous result',
    next_chapter: 'Next chapter',
    prev_chapter: 'Previous chapter',
    sort_cycle: 'Cycle sort',
    toggle_simplified: 'Toggle simplified mode',
    toggle_respect_css: 'Toggle publisher CSS',
    toggle_justify: 'Toggle text justify',
    toggle_wide: 'Toggle wide screen',
    toggle_recent: 'Toggle recent books',
    toggle_continue: 'Toggle continue reading',
    zoom_image: 'Zoom image',
    opds_download: 'Download book (OPDS)',
    opds_downloads: 'Downloads queue (OPDS)',
    opds_next_page: 'Next feed page (OPDS)',
    opds_prev_page: 'Previous feed page (OPDS)',
    opds_catalogs: 'Switch catalog (OPDS)',
  };
  return labels[action] ?? action;
}

/** First key bound to `action` in config, or undefined if unbound. */
export function keyForAction(config: Config, action: KeyAction): string | undefined {
  for (const [k, a] of Object.entries(config.keybindings)) {
    if (a === action) return k;
  }
  return undefined;
}
