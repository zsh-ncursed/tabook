export interface ThemeColors {
  background: string;
  text: string;
  heading: string;
  accent: string;
  selection: string;
  panel: string;
  panelBorder: string;
  statusBar: string;
  statusBarText: string;
  searchHighlight: string;
  dim: string;
  link: string;
  tableHeader: string;
  error: string;
}

export interface Theme {
  name: string;
  dark: boolean;
  colors: ThemeColors;
}

function makeTheme(
  name: string,
  dark: boolean,
  palette: {
    background: string;
    text: string;
    heading: string;
    accent: string;
    panel: string;
    panelBorder: string;
    statusBar: string;
    dim: string;
    link?: string;
    error?: string;
  },
): Theme {
  return {
    name,
    dark,
    colors: {
      background: palette.background,
      text: palette.text,
      heading: palette.heading,
      accent: palette.accent,
      selection: palette.accent,
      panel: palette.panel,
      panelBorder: palette.panelBorder,
      statusBar: palette.statusBar,
      statusBarText: palette.text,
      searchHighlight: palette.heading,
      dim: palette.dim,
      link: palette.link ?? palette.accent,
      tableHeader: palette.heading,
      error: palette.error ?? '#ff5555',
    },
  };
}

export const THEMES: Record<string, Theme> = {
  dracula: makeTheme('dracula', true, {
    background: '#282a36',
    text: '#f8f8f2',
    heading: '#bd93f9',
    accent: '#ff79c6',
    panel: '#21222c',
    panelBorder: '#44475a',
    statusBar: '#44475a',
    dim: '#6272a4',
    link: '#8be9fd',
  }),

  monokai: makeTheme('monokai', true, {
    background: '#272822',
    text: '#f8f8f2',
    heading: '#e6db74',
    accent: '#66d9ef',
    panel: '#1f201d',
    panelBorder: '#49483e',
    statusBar: '#49483e',
    dim: '#75715e',
    link: '#66d9ef',
  }),

  'ayu-dark': makeTheme('ayu-dark', true, {
    background: '#0b0e14',
    text: '#bfbdb6',
    heading: '#ffb454',
    accent: '#59c2ff',
    panel: '#0f1419',
    panelBorder: '#232a33',
    statusBar: '#1a1f29',
    dim: '#565b66',
    link: '#59c2ff',
  }),

  'ayu-light': makeTheme('ayu-light', false, {
    background: '#fafafa',
    text: '#5c6773',
    heading: '#f07178',
    accent: '#36a3d9',
    panel: '#f0f0f0',
    panelBorder: '#d9d9d9',
    statusBar: '#d9e1e8',
    dim: '#8a9199',
    link: '#36a3d9',
  }),

  'github-dark': makeTheme('github-dark', true, {
    background: '#0d1117',
    text: '#c9d1d9',
    heading: '#58a6ff',
    accent: '#58a6ff',
    panel: '#161b22',
    panelBorder: '#30363d',
    statusBar: '#161b22',
    dim: '#8b949e',
    link: '#58a6ff',
  }),

  'github-light': makeTheme('github-light', false, {
    background: '#ffffff',
    text: '#24292f',
    heading: '#0969da',
    accent: '#0969da',
    panel: '#f6f8fa',
    panelBorder: '#d0d7de',
    statusBar: '#f6f8fa',
    dim: '#57606a',
    link: '#0969da',
  }),

  'gruvbox-dark': makeTheme('gruvbox-dark', true, {
    background: '#282828',
    text: '#ebdbb2',
    heading: '#fabd2f',
    accent: '#83a598',
    panel: '#1d2021',
    panelBorder: '#504945',
    statusBar: '#504945',
    dim: '#928374',
    link: '#8ec07c',
  }),

  'gruvbox-light': makeTheme('gruvbox-light', false, {
    background: '#fbf1c7',
    text: '#3c3836',
    heading: '#b57614',
    accent: '#458588',
    panel: '#ebdbb2',
    panelBorder: '#d5c4a1',
    statusBar: '#d5c4a1',
    dim: '#928374',
    link: '#689d6a',
  }),

  nord: makeTheme('nord', true, {
    background: '#2e3440',
    text: '#d8dee9',
    heading: '#88c0d0',
    accent: '#81a1c1',
    panel: '#2e3440',
    panelBorder: '#4c566a',
    statusBar: '#3b4252',
    dim: '#4c566a',
    link: '#8fbcbb',
  }),

  'solarized-dark': makeTheme('solarized-dark', true, {
    background: '#002b36',
    text: '#839496',
    heading: '#268bd2',
    accent: '#2aa198',
    panel: '#073642',
    panelBorder: '#586e75',
    statusBar: '#073642',
    dim: '#586e75',
    link: '#268bd2',
  }),

  'solarized-light': makeTheme('solarized-light', false, {
    background: '#fdf6e3',
    text: '#657b83',
    heading: '#268bd2',
    accent: '#2aa198',
    panel: '#eee8d5',
    panelBorder: '#93a1a1',
    statusBar: '#eee8d5',
    dim: '#93a1a1',
    link: '#268bd2',
  }),

  'one-dark': makeTheme('one-dark', true, {
    background: '#282c34',
    text: '#abb2bf',
    heading: '#61afef',
    accent: '#56b6c2',
    panel: '#21252b',
    panelBorder: '#3e4451',
    statusBar: '#21252b',
    dim: '#5c6370',
    link: '#61afef',
  }),

  'catppuccin-mocha': makeTheme('catppuccin-mocha', true, {
    background: '#1e1e2e',
    text: '#cdd6f4',
    heading: '#f5e0dc',
    accent: '#89b4fa',
    panel: '#181825',
    panelBorder: '#45475a',
    statusBar: '#313244',
    dim: '#6c7086',
    link: '#94e2d5',
  }),

  'catppuccin-latte': makeTheme('catppuccin-latte', false, {
    background: '#eff1f5',
    text: '#4c4f69',
    heading: '#d20f39',
    accent: '#1e66f5',
    panel: '#e6e9ef',
    panelBorder: '#bcc0cc',
    statusBar: '#e6e9ef',
    dim: '#7c7f93',
    link: '#179299',
  }),
};

export function getTheme(name: string): Theme {
  const theme = THEMES[name];
  if (!theme) {
    throw new Error(`Unknown theme: ${name}`);
  }
  return theme;
}

export function themeNames(): string[] {
  return Object.keys(THEMES);
}
