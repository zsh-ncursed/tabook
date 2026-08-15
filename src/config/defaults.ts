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
  | 'toggle_recent'
  | 'toggle_continue'
  | 'zoom_image';

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
  'toggle_continue',
  'zoom_image',
];

export const DEFAULT_KEYBINDINGS: Record<string, KeyAction> = {
  j: 'move_cursor_down',
  k: 'move_cursor_up',
  h: 'move_cursor_left',
  l: 'move_cursor_right',
  // Arrow keys are bound by default so they behave identically in every view
  // and modal (they used to work only in hardcoded modal handlers).
  up: 'move_cursor_up',
  down: 'move_cursor_down',
  left: 'move_cursor_left',
  right: 'move_cursor_right',
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
  C: 'toggle_continue',
  J: 'toggle_justify',
  W: 'toggle_wide',
  d: 'delete_from_library',
  D: 'delete_file',
  t: 'toc',
  i: 'book_info',
  z: 'zoom_image',
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
}

// Sections that can appear in the status bar. Each view provides its own data
// (title, page, percent, ...); the config decides which sections are rendered
// and on which side.
export type StatusBarSection = 'title' | 'page' | 'percent' | 'search' | 'hint' | 'downloads';

export const STATUSBAR_SECTIONS: readonly StatusBarSection[] = [
  'title',
  'page',
  'percent',
  'search',
  'hint',
  'downloads',
];

export interface StatusBarConfig {
  left: StatusBarSection[];
  right: StatusBarSection[];
  showProgressBar: boolean;
}

export interface Config {
  theme: string;
  dbPath: string;
  /** Pick a light/dark theme from the terminal background color (OSC 11) at startup. */
  autoTheme: boolean;
  /** Enable SGR mouse reporting (click selects rows in lists). */
  mouse: boolean;
  keybindings: Record<string, KeyAction>;
  typography: TypographyConfig;
  display: DisplayConfig;
  statusbar: StatusBarConfig;
}

export function defaultConfig(): Config {
  return {
    theme: 'dracula',
    dbPath: '',
    autoTheme: false,
    mouse: true,
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
    },
    statusbar: {
      left: ['title'],
      right: ['percent', 'page', 'search', 'hint', 'downloads'],
      showProgressBar: true,
    },
  };
}
