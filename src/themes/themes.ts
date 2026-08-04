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
    searchHighlight?: string;
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
      searchHighlight: palette.searchHighlight ?? (dark ? '#ffff00' : '#ffeb3b'),
      dim: palette.dim,
      link: palette.link ?? palette.accent,
      tableHeader: palette.heading,
      error: palette.error ?? '#ff5555',
    },
  };
}

export const THEMES: Record<string, Theme> = {
  'amoled': makeTheme('amoled', true, {
    background: '#000000',
    text: '#ffffff',
    heading: '#b388ff',
    accent: '#ff4081',
    panel: '#000000',
    panelBorder: '#ff4081',
    statusBar: '#000000',
    dim: '#555555',
    link: '#18ffff',
  }),

  'aura': makeTheme('aura', true, {
    background: '#15141b',
    text: '#edecee',
    heading: '#a277ff',
    accent: '#ff6767',
    panel: '#15141b',
    panelBorder: '#ff6767',
    statusBar: '#15141b',
    dim: '#6d6a7e',
    link: '#82e2ff',
  }),

  'ayu': makeTheme('ayu', true, {
    background: '#0f1419',
    text: '#d6dae0',
    heading: '#3fb7e3',
    accent: '#f2856f',
    panel: '#0f1419',
    panelBorder: '#f2856f',
    statusBar: '#0f1419',
    dim: '#5a6673',
    link: '#66c6f1',
  }),

  'carbonfox': makeTheme('carbonfox', true, {
    background: '#393939',
    text: '#f2f4f8',
    heading: '#33b1ff',
    accent: '#ff8389',
    panel: '#393939',
    panelBorder: '#ff8389',
    statusBar: '#393939',
    dim: '#6f6f6f',
    link: '#78a9ff',
  }),

  'catppuccin': makeTheme('catppuccin', true, {
    background: '#1e1e2e',
    text: '#cdd6f4',
    heading: '#b4befe',
    accent: '#f38ba8',
    panel: '#1e1e2e',
    panelBorder: '#f38ba8',
    statusBar: '#1e1e2e',
    dim: '#6c7086',
    link: '#89dceb',
  }),

  'catppuccin-frappe': makeTheme('catppuccin-frappe', true, {
    background: '#303446',
    text: '#c6d0f5',
    heading: '#ca9ee6',
    accent: '#f4b8e4',
    panel: '#303446',
    panelBorder: '#a5adce',
    statusBar: '#303446',
    dim: '#949cb8',
    link: '#8da4e2',
  }),

  'catppuccin-macchiato': makeTheme('catppuccin-macchiato', true, {
    background: '#24273a',
    text: '#cad3f5',
    heading: '#c6a0f6',
    accent: '#f5bde6',
    panel: '#24273a',
    panelBorder: '#a5adcb',
    statusBar: '#24273a',
    dim: '#939ab7',
    link: '#8aadf4',
  }),

  'cobalt2': makeTheme('cobalt2', true, {
    background: '#193549',
    text: '#ffffff',
    heading: '#ffc600',
    accent: '#2affdf',
    panel: '#193549',
    panelBorder: '#2d5a7b',
    statusBar: '#193549',
    dim: '#0088ff',
    link: '#0088ff',
  }),

  'cursor': makeTheme('cursor', true, {
    background: '#181818',
    text: '#e4e4e4',
    heading: '#AAA0FA',
    accent: '#88c0d0',
    panel: '#181818',
    panelBorder: '#e4e4e45e',
    statusBar: '#181818',
    dim: '#e4e4e45e',
    link: '#82D2CE',
  }),

  'dracula': makeTheme('dracula', true, {
    background: '#1d1e28',
    text: '#f8f8f2',
    heading: '#bd93f9',
    accent: '#ff79c6',
    panel: '#1d1e28',
    panelBorder: '#ff79c6',
    statusBar: '#1d1e28',
    dim: '#6272a4',
    link: '#8be9fd',
  }),

  'everforest': makeTheme('everforest', true, {
    background: '#2d353b',
    text: '#d3c6aa',
    heading: '#d699b6',
    accent: '#d699b6',
    panel: '#2d353b',
    panelBorder: '#7a8478',
    statusBar: '#2d353b',
    dim: '#7a8478',
    link: '#a7c080',
  }),

  'flexoki': makeTheme('flexoki', true, {
    background: '#100F0F',
    text: '#CECDC3',
    heading: '#8B7EC8',
    accent: '#8B7EC8',
    panel: '#100F0F',
    panelBorder: '#6F6E69',
    statusBar: '#100F0F',
    dim: '#6F6E69',
    link: '#4385BE',
  }),

  'github': makeTheme('github', true, {
    background: '#0d1117',
    text: '#c9d1d9',
    heading: '#58a6ff',
    accent: '#39c5cf',
    panel: '#0d1117',
    panelBorder: '#30363d',
    statusBar: '#0d1117',
    dim: '#8b949e',
    link: '#58a6ff',
  }),

  'gruvbox': makeTheme('gruvbox', true, {
    background: '#282828',
    text: '#ebdbb2',
    heading: '#83a598',
    accent: '#fb4934',
    panel: '#282828',
    panelBorder: '#fb4934',
    statusBar: '#282828',
    dim: '#928374',
    link: '#d3869b',
  }),

  'kanagawa': makeTheme('kanagawa', true, {
    background: '#1F1F28',
    text: '#DCD7BA',
    heading: '#957FB8',
    accent: '#D27E99',
    panel: '#1F1F28',
    panelBorder: '#727169',
    statusBar: '#1F1F28',
    dim: '#727169',
    link: '#7E9CD8',
  }),

  'lucent-orng': makeTheme('lucent-orng', true, {
    background: '#2a1a15',
    text: '#eeeeee',
    heading: '#EC5B2B',
    accent: '#FFF7F1',
    panel: '#2a1a15',
    panelBorder: '#808080',
    statusBar: '#2a1a15',
    dim: '#808080',
    link: '#EC5B2B',
  }),

  'material': makeTheme('material', true, {
    background: '#263238',
    text: '#eeffff',
    heading: '#82aaff',
    accent: '#89ddff',
    panel: '#263238',
    panelBorder: '#37474f',
    statusBar: '#263238',
    dim: '#546e7a',
    link: '#89ddff',
  }),

  'matrix': makeTheme('matrix', true, {
    background: '#0a0e0a',
    text: '#62ff94',
    heading: '#00efff',
    accent: '#c770ff',
    panel: '#0a0e0a',
    panelBorder: '#8ca391',
    statusBar: '#0a0e0a',
    dim: '#8ca391',
    link: '#30b3ff',
  }),

  'mercury': makeTheme('mercury', true, {
    background: '#171721',
    text: '#dddde5',
    heading: '#ffffff',
    accent: '#8da4f5',
    panel: '#171721',
    panelBorder: '#b4b7c81f',
    statusBar: '#171721',
    dim: '#9d9da8',
    link: '#8da4f5',
  }),

  'monokai': makeTheme('monokai', true, {
    background: '#272822',
    text: '#f8f8f2',
    heading: '#ae81ff',
    accent: '#f92672',
    panel: '#272822',
    panelBorder: '#f92672',
    statusBar: '#272822',
    dim: '#75715e',
    link: '#66d9ef',
  }),

  'nightowl': makeTheme('nightowl', true, {
    background: '#011627',
    text: '#d6deeb',
    heading: '#82aaff',
    accent: '#f78c6c',
    panel: '#011627',
    panelBorder: '#f78c6c',
    statusBar: '#011627',
    dim: '#637777',
    link: '#82aaff',
  }),

  'nord': makeTheme('nord', true, {
    background: '#2e3440',
    text: '#e5e9f0',
    heading: '#88c0d0',
    accent: '#d57780',
    panel: '#2e3440',
    panelBorder: '#d57780',
    statusBar: '#2e3440',
    dim: '#616e88',
    link: '#81a1c1',
  }),

  'one-dark': makeTheme('one-dark', true, {
    background: '#282c34',
    text: '#abb2bf',
    heading: '#c678dd',
    accent: '#56b6c2',
    panel: '#282c34',
    panelBorder: '#5c6370',
    statusBar: '#282c34',
    dim: '#5c6370',
    link: '#61afef',
  }),

  'onedarkpro': makeTheme('onedarkpro', true, {
    background: '#1e222a',
    text: '#abb2bf',
    heading: '#61afef',
    accent: '#e06c75',
    panel: '#1e222a',
    panelBorder: '#e06c75',
    statusBar: '#1e222a',
    dim: '#5c6370',
    link: '#56b6c2',
  }),

  'opencode': makeTheme('opencode', true, {
    background: '#0a0a0a',
    text: '#eeeeee',
    heading: '#9d7cd8',
    accent: '#9d7cd8',
    panel: '#0a0a0a',
    panelBorder: '#808080',
    statusBar: '#0a0a0a',
    dim: '#808080',
    link: '#fab283',
  }),

  'orng': makeTheme('orng', true, {
    background: '#0a0a0a',
    text: '#eeeeee',
    heading: '#EC5B2B',
    accent: '#FFF7F1',
    panel: '#0a0a0a',
    panelBorder: '#808080',
    statusBar: '#0a0a0a',
    dim: '#808080',
    link: '#EC5B2B',
  }),

  'osaka-jade': makeTheme('osaka-jade', true, {
    background: '#111c18',
    text: '#C1C497',
    heading: '#2DD5B7',
    accent: '#549e6a',
    panel: '#111c18',
    panelBorder: '#53685B',
    statusBar: '#111c18',
    dim: '#53685B',
    link: '#8CD3CB',
  }),

  'palenight': makeTheme('palenight', true, {
    background: '#292d3e',
    text: '#a6accd',
    heading: '#c792ea',
    accent: '#89ddff',
    panel: '#292d3e',
    panelBorder: '#676e95',
    statusBar: '#292d3e',
    dim: '#676e95',
    link: '#82aaff',
  }),

  'rosepine': makeTheme('rosepine', true, {
    background: '#191724',
    text: '#e0def4',
    heading: '#c4a7e7',
    accent: '#ebbcba',
    panel: '#191724',
    panelBorder: '#403d52',
    statusBar: '#191724',
    dim: '#6e6a86',
    link: '#9ccfd8',
  }),

  'shadesofpurple': makeTheme('shadesofpurple', true, {
    background: '#1a102b',
    text: '#f5f0ff',
    heading: '#c792ff',
    accent: '#ff7ac6',
    panel: '#1a102b',
    panelBorder: '#ff7ac6',
    statusBar: '#1a102b',
    dim: '#b362ff',
    link: '#7dd4ff',
  }),

  'solarized': makeTheme('solarized', true, {
    background: '#002b36',
    text: '#93a1a1',
    heading: '#6c71c4',
    accent: '#d33682',
    panel: '#002b36',
    panelBorder: '#d33682',
    statusBar: '#002b36',
    dim: '#586e75',
    link: '#2aa198',
  }),

  'synthwave84': makeTheme('synthwave84', true, {
    background: '#262335',
    text: '#ffffff',
    heading: '#ff7edb',
    accent: '#b084eb',
    panel: '#262335',
    panelBorder: '#495495',
    statusBar: '#262335',
    dim: '#848bbd',
    link: '#36f9f6',
  }),

  'tokyonight': makeTheme('tokyonight', true, {
    background: '#1a1b26',
    text: '#c0caf5',
    heading: '#7aa2f7',
    accent: '#ff9e64',
    panel: '#1a1b26',
    panelBorder: '#ff9e64',
    statusBar: '#1a1b26',
    dim: '#565f89',
    link: '#7dcfff',
  }),

  'vercel': makeTheme('vercel', true, {
    background: '#000000',
    text: '#EDEDED',
    heading: '#BF7AF0',
    accent: '#8E4EC6',
    panel: '#000000',
    panelBorder: '#454545',
    statusBar: '#000000',
    dim: '#878787',
    link: '#52A8FF',
  }),

  'vesper': makeTheme('vesper', true, {
    background: '#101010',
    text: '#FFF',
    heading: '#FFC799',
    accent: '#FF8080',
    panel: '#101010',
    panelBorder: '#FF8080',
    statusBar: '#101010',
    dim: '#8b8b8b',
    link: '#FFC799',
  }),

  'zenburn': makeTheme('zenburn', true, {
    background: '#3f3f3f',
    text: '#dcdccc',
    heading: '#f0dfaf',
    accent: '#93e0e3',
    panel: '#3f3f3f',
    panelBorder: '#9f9f9f',
    statusBar: '#3f3f3f',
    dim: '#7f9f7f',
    link: '#8cd0d3',
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
