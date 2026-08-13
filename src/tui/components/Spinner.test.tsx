import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Spinner } from './Spinner.js';
import { getTheme } from '../../themes/themes.js';

const theme = getTheme('dracula');

describe('Spinner', () => {
  it('renders the label', () => {
    const { lastFrame } = render(<Spinner label="Loading" theme={theme} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Loading');
  });

  it('renders a braille frame character', () => {
    const { lastFrame } = render(<Spinner label="Working" theme={theme} />);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  });

  it('renders different labels', () => {
    const { lastFrame } = render(<Spinner label="Downloading" theme={theme} />);
    expect(lastFrame()).toContain('Downloading');
  });
});
