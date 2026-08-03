import { describe, it, expect } from 'vitest';
import { getTheme, themeNames } from './themes.js';

describe('themes', () => {
  it('exposes built-in theme names', () => {
    const names = themeNames();
    expect(names).toContain('dracula');
    expect(names).toContain('monokai');
    expect(names.length).toBeGreaterThanOrEqual(14);
  });

  it('returns a theme with a full palette', () => {
    const theme = getTheme('dracula');
    expect(theme.name).toBe('dracula');
    expect(theme.dark).toBe(true);
    expect(theme.colors.background).toBeTruthy();
    expect(theme.colors.text).toBeTruthy();
    expect(theme.colors.statusBar).toBeTruthy();
  });

  it('returns light themes for light names', () => {
    expect(getTheme('github-light').dark).toBe(false);
  });

  it('throws for unknown themes', () => {
    expect(() => getTheme('nope')).toThrow(/Unknown theme/);
  });
});
