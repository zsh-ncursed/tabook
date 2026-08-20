import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemePicker } from './ThemePicker.js';
import { THEMES, themeNames } from '../../themes/themes.js';
const items = themeNames();
import { defaultConfig } from '../../config/defaults.js';

const config = defaultConfig();

function makeProps(overrides: Partial<Parameters<typeof ThemePicker>[0]> = {}) {
  return {
    theme: THEMES['dracula']!,
    config,
    items,
    currentTheme: 'dracula',
    isActive: true,
    onPreview: vi.fn(),
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

async function settle(ms = 100): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('ThemePicker', () => {
  it('initializes cursor to current theme index', async () => {
    const onPreview = vi.fn();
    render(<ThemePicker {...makeProps({ onPreview })} />);
    await settle();
    // The first live-preview call should be the current theme, not 'amoled'
    expect(onPreview).toHaveBeenCalledWith('dracula');
  });

  it('live-previews highlighted theme on cursor move', async () => {
    const onPreview = vi.fn();
    const { stdin } = render(<ThemePicker {...makeProps({ onPreview })} />);
    await settle();
    onPreview.mockClear();
    stdin.write('j'); // move down
    await settle();
    // Should preview the next theme after dracula
    const calledWith = onPreview.mock.calls.map((c: unknown[]) => c[0]);
    expect(calledWith.length).toBeGreaterThan(0);
    expect(calledWith[0]).not.toBe('dracula');
  });

  it('Enter applies highlighted theme', async () => {
    const onApply = vi.fn();
    const { stdin } = render(<ThemePicker {...makeProps({ onApply })} />);
    await settle();
    stdin.write('\r');
    await settle();
    expect(onApply).toHaveBeenCalledWith('dracula');
  });

  it('Enter after moving cursor applies the new theme', async () => {
    const onApply = vi.fn();
    const { stdin } = render(<ThemePicker {...makeProps({ onApply })} />);
    await settle();
    stdin.write('j'); // move to next theme
    await settle();
    stdin.write('\r'); // apply
    await settle();
    expect(onApply).toHaveBeenCalledTimes(1);
    // Should be the next theme, not the original
    const applied = onApply.mock.calls[0]![0] as string;
    expect(applied).not.toBe('dracula');
    expect(THEMES[applied]).toBeDefined();
  });
});
