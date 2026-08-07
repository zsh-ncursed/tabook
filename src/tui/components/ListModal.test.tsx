import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ListModal } from './ListModal.js';
import type { Theme } from '../../themes/themes.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';

const theme: Theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;

const items = [
  { id: 1, label: 'First' },
  { id: 2, label: 'Second' },
  { id: 3, label: 'Third' },
];

describe('ListModal (presentational)', () => {
  it('renders the title and items', () => {
    const { lastFrame } = render(<ListModal theme={theme} title="Test" items={items} cursor={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Test');
    expect(frame).toContain('First');
    expect(frame).toContain('Second');
    expect(frame).toContain('Third');
  });

  it('highlights the item at cursor position', () => {
    const { lastFrame } = render(<ListModal theme={theme} title="Test" items={items} cursor={1} />);
    const frame = lastFrame() ?? '';
    // The selected item is prefixed with '>' — 'Second' should have it
    expect(frame).toContain('> Second');
  });

  it('shows the default footer when no footer prop is given', () => {
    const { lastFrame } = render(<ListModal theme={theme} title="Test" items={items} cursor={0} />);
    expect(lastFrame()).toContain('esc close');
  });

  it('shows a custom footer when provided', () => {
    const { lastFrame } = render(
      <ListModal theme={theme} title="Test" items={items} cursor={0} footer="custom footer text" />,
    );
    expect(lastFrame()).toContain('custom footer text');
  });
});
