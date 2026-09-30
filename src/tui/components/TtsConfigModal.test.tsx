import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TtsConfigModal } from './TtsConfigModal.js';
import { THEMES } from '../../themes/themes.js';
import { defaultConfig } from '../../config/defaults.js';
import type { TtsConfig } from '../../config/defaults.js';

const config = defaultConfig();
const baseTts: TtsConfig = config.tts;

function makeProps(overrides: Partial<Parameters<typeof TtsConfigModal>[0]> = {}) {
  return {
    theme: THEMES['dracula']!,
    config,
    tts: baseTts,
    isActive: true,
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

async function settle(ms = 100): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('TtsConfigModal', () => {
  it('renders the settings rows', async () => {
    const { lastFrame } = render(<TtsConfigModal {...makeProps()} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TTS settings');
    expect(frame).toContain('Engine');
    expect(frame).toContain('Voice');
    expect(frame).toContain('Rate');
    expect(frame).toContain('Pitch');
    expect(frame).toContain('Follow');
  });

  it('esc closes the modal via onCancel', async () => {
    const onClose = vi.fn();
    const { stdin } = render(<TtsConfigModal {...makeProps({ onClose })} />);
    await settle();
    stdin.write('\u001b');
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('j/k moves the cursor between rows', async () => {
    const { stdin, lastFrame } = render(<TtsConfigModal {...makeProps()} />);
    await settle();
    stdin.write('j');
    await settle();
    // Second row is Voice — highlighted by '>'
    expect(lastFrame() ?? '').toContain('> Voice');
  });

  it('toggles follow with enter on the Follow row', async () => {
    const onApply = vi.fn();
    const { stdin } = render(<TtsConfigModal {...makeProps({ onApply })} />);
    await settle();
    // Move to Follow row (index 4): j jjj
    stdin.write('jjjj');
    await settle();
    stdin.write('\r'); // toggle
    await settle();
    // Move to Apply (index 6): jj
    stdin.write('jj');
    await settle();
    stdin.write('\r'); // apply
    await settle();
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]![0] as TtsConfig;
    expect(applied.follow).toBe(!baseTts.follow);
  });

  it('l increases rate on the Rate row', async () => {
    const onApply = vi.fn();
    const { stdin } = render(<TtsConfigModal {...makeProps({ onApply })} />);
    await settle();
    // Move to Rate row (index 2): jj
    stdin.write('jj');
    await settle();
    stdin.write('l'); // +0.25
    await settle();
    // Move to Apply (index 6): jjjj
    stdin.write('jjjj');
    await settle();
    stdin.write('\r');
    await settle();
    const applied = onApply.mock.calls[0]![0] as TtsConfig;
    expect(applied.rate).toBe(1.25);
  });

  it('h decreases pitch on the Pitch row', async () => {
    const onApply = vi.fn();
    const { stdin } = render(<TtsConfigModal {...makeProps({ onApply })} />);
    await settle();
    // Move to Pitch row (index 3): jjj
    stdin.write('jjj');
    await settle();
    stdin.write('h'); // -0.1
    await settle();
    stdin.write('jjj'); // to Apply (index 6)
    await settle();
    stdin.write('\r');
    await settle();
    const applied = onApply.mock.calls[0]![0] as TtsConfig;
    expect(applied.pitch).toBe(0.9);
  });

  it('cycles engine with enter on the Engine row', async () => {
    const onApply = vi.fn();
    const { stdin } = render(<TtsConfigModal {...makeProps({ onApply })} />);
    await settle();
    stdin.write('\r'); // engine row is first (index 0)
    await settle();
    stdin.write('jjjjjj'); // to Apply (index 6)
    await settle();
    stdin.write('\r');
    await settle();
    const applied = onApply.mock.calls[0]![0] as TtsConfig;
    expect(applied.engine).toBe('espeak');
  });
});
