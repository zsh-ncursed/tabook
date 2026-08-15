import { describe, expect, it } from 'vitest';
import { bashCompletion, zshCompletion } from './completions.js';
import { themeNames } from '../themes/themes.js';

const OPTIONS = ['--library', '--theme', '--config', '--man', '--completion'];

describe('bashCompletion', () => {
  it('emits a complete -F function for tabook', () => {
    const script = bashCompletion();
    expect(script).toContain('_tabook()');
    expect(script).toContain('complete -F _tabook tabook');
  });

  it('lists every CLI option', () => {
    const script = bashCompletion();
    for (const option of OPTIONS) {
      expect(script).toContain(option);
    }
  });

  it('completes themes, shells and files', () => {
    const script = bashCompletion();
    for (const theme of themeNames()) {
      expect(script).toContain(theme);
    }
    expect(script).toContain('bash zsh');
    expect(script).toContain('compgen -f');
  });
});

describe('zshCompletion', () => {
  it('is a #compdef script using _arguments', () => {
    const script = zshCompletion();
    expect(script.startsWith('#compdef tabook')).toBe(true);
    expect(script).toContain('_arguments');
    expect(script).toContain('_tabook "$@"');
  });

  it('lists every CLI option', () => {
    const script = zshCompletion();
    for (const option of OPTIONS) {
      expect(script).toContain(option);
    }
  });

  it('completes themes, shells and files', () => {
    const script = zshCompletion();
    for (const theme of themeNames()) {
      expect(script).toContain(theme);
    }
    expect(script).toContain('(bash zsh)');
    expect(script).toContain('_files');
  });
});
