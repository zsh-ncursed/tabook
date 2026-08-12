export type KeyAction =
  | 'move_cursor_up'
  | 'move_cursor_down'
  | 'move_cursor_left'
  | 'move_cursor_right'
  | 'scroll_down'
  | 'scroll_up'
  | 'page_down'
  | 'page_up'
  | 'go_to_start'
  | 'go_to_end'
  | 'select'
  | 'back'
  | 'quit'
  | 'open_file'
  | 'save_to_library'
  | 'delete_from_library'
  | 'delete_file'
  | 'add_bookmark'
  | 'list_bookmarks'
  | 'toc'
  | 'book_info'
  | 'help'
  | 'command'
  | 'search'
  | 'search_next'
  | 'search_prev'
  | 'next_chapter'
  | 'prev_chapter'
  | 'sort_cycle'
  | 'toggle_simplified'
  | 'toggle_respect_css'
  | 'toggle_justify'
  | 'toggle_wide'
  | 'toggle_recent';

export const KEY_ACTIONS: readonly KeyAction[] = [
  'move_cursor_up',
  'move_cursor_down',
  'move_cursor_left',
  'move_cursor_right',
  'scroll_down',
  'scroll_up',
  'page_down',
  'page_up',
  'go_to_start',
  'go_to_end',
  'select',
  'back',
  'quit',
  'open_file',
  'save_to_library',
  'delete_from_library',
  'delete_file',
  'add_bookmark',
  'list_bookmarks',
  'toc',
  'book_info',
  'help',
  'command',
  'search',
  'search_next',
  'search_prev',
  'next_chapter',
  'prev_chapter',
  'sort_cycle',
  'toggle_simplified',
  'toggle_respect_css',
  'toggle_justify',
  'toggle_wide',
  'toggle_recent',
];

export const DEFAULT_KEYBINDINGS: Record<string, KeyAction> = {
  j: 'move_cursor_down',
  k: 'move_cursor_up',
  h: 'move_cursor_left',
  l: 'move_cursor_right',
  gg: 'go_to_start',
  G: 'go_to_end',
  '/': 'search',
  n: 'search_next',
  N: 'search_prev',
  ']': 'next_chapter',
  '[': 'prev_chapter',
  o: 'open_file',
  s: 'save_to_library',
  b: 'add_bookmark',
  B: 'list_bookmarks',
  R: 'toggle_recent',
  J: 'toggle_justify',
  W: 'toggle_wide',
  d: 'delete_from_library',
  D: 'delete_file',
  t: 'toc',
  i: 'book_info',
  '?': 'help',
  q: 'quit',
  ':': 'command',
  enter: 'select',
  escape: 'back',
  space: 'page_down',
  backspace: 'page_up',
  pageup: 'page_up',
  pagedown: 'page_down',
  'ctrl+d': 'page_down',
  'ctrl+u': 'page_up',
};

export interface TypographyConfig {
  measure: number;
  lineSpacing: number;
  paragraphIndent: number;
  paragraphSpacing: number;
  hyphenation: boolean;
  justify: boolean;
}

export interface DisplayConfig {
  simplifiedMode: boolean;
  respectPublisherCss: boolean;
  showProgressBar: boolean;
}

export interface Config {
  theme: string;
  dbPath: string;
  keybindings: Record<string, KeyAction>;
  typography: TypographyConfig;
  display: DisplayConfig;
}

export function defaultConfig(): Config {
  return {
    theme: 'dracula',
    dbPath: '',
    keybindings: { ...DEFAULT_KEYBINDINGS },
    typography: {
      measure: 80,
      lineSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 1,
      hyphenation: false,
      justify: false,
    },
    display: {
      simplifiedMode: false,
      respectPublisherCss: true,
      showProgressBar: true,
    },
  };
}
