import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusBar } from './StatusBar.js';
import type { Theme } from '../../themes/themes.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';

const theme: Theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;

describe('StatusBar (configurable sections)', () => {
  it('renders the default sections: title left, page/percent/hint right', () => {
    const { lastFrame } = render(
      <StatusBar
        theme={theme}
        statusbar={defaultConfig().statusbar}
        data={{ title: 'My Book', page: 3, totalPages: 10, percent: 42, hint: 'j/k' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('My Book');
    expect(frame).toContain('p.3/10');
    expect(frame).toContain('j/k');
  });

  it('skips sections with no data', () => {
    const { lastFrame } = render(
      <StatusBar
        theme={theme}
        statusbar={defaultConfig().statusbar}
        data={{ title: 'My Book', hint: 'j/k' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('My Book');
    expect(frame).toContain('j/k');
    expect(frame).not.toContain('p.');
    expect(frame).not.toContain('%');
  });

  it('shows the progress bar when showProgressBar is on and percent is present', () => {
    const { lastFrame } = render(
      <StatusBar
        theme={theme}
        statusbar={defaultConfig().statusbar}
        data={{ title: 'B', percent: 50 }}
      />,
    );
    const frame = lastFrame() ?? '';
    // Progress bar glyphs + the percentage
    expect(frame).toContain('█');
    expect(frame).toContain('50%');
  });

  it('hides the progress bar when showProgressBar is off', () => {
    const statusbar = defaultConfig().statusbar;
    statusbar.showProgressBar = false;
    const { lastFrame } = render(
      <StatusBar theme={theme} statusbar={statusbar} data={{ title: 'B', percent: 50 }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('█');
    // Without the bar, the percent section renders as text instead
    expect(frame).toContain('50%');
  });

  it('respects a custom section layout', () => {
    const statusbar = defaultConfig().statusbar;
    statusbar.left = ['hint'];
    statusbar.right = ['title'];
    const { lastFrame } = render(
      <StatusBar theme={theme} statusbar={statusbar} data={{ title: 'T', hint: 'hint text' }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('hint text');
    expect(frame).toContain('T');
  });
});
