import { describe, expect, it } from 'vitest';
import { manPage } from './man.js';
import { COMMANDS } from '../tui/commands.js';
import { DEFAULT_KEYBINDINGS } from '../config/defaults.js';

describe('manPage', () => {
  it('is a valid roff man page header', () => {
    const page = manPage();
    expect(page.startsWith('.TH TABOOK 1 ')).toBe(true);
    expect(page).toContain('.SH NAME');
    expect(page).toContain('.SH SYNOPSIS');
    expect(page).toContain('.SH OPTIONS');
    expect(page).toContain('.SH COMMANDS');
    expect(page).toContain('.SH KEYBINDINGS');
    expect(page).toContain('.SH CONFIGURATION');
    expect(page).toContain('.SH FILES');
    expect(page).toContain('.SH EXIT STATUS');
    expect(page).toContain('.SH SEE ALSO');
  });

  it('documents every CLI option', () => {
    const page = manPage();
    // In roff, hyphens are escaped (\-) so they render as literal hyphens.
    const roff = (s: string): string => s.replace(/-/g, '\\-');
    for (const option of ['--library', '--theme', '--config', '--man', '--completion']) {
      expect(page).toContain(roff(option));
    }
    expect(page).toContain(roff('-V'));
  });

  it('covers every command from the registry (no drift)', () => {
    const page = manPage();
    const usages = new Set(COMMANDS.map((c) => c.usage));
    for (const usage of usages) {
      expect(page).toContain(usage);
    }
  });

  it('covers every default keybinding (no drift)', () => {
    const page = manPage();
    for (const key of Object.keys(DEFAULT_KEYBINDINGS)) {
      expect(page).toContain(key);
    }
  });

  it('mentions config and database locations', () => {
    const page = manPage();
    expect(page).toContain('~/.config/tabook/config.toml');
    expect(page).toContain('library.db');
    expect(page).toContain('library.db.key');
  });
});
