import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TtsConfigModal } from './TtsConfigModal.js';
import { THEMES } from '../../themes/themes.js';
import { defaultConfig } from '../../config/defaults.js';
import type { TtsConfig } from '../../config/defaults.js';
import { TtsManager } from '../../tts/manager.js';
import type { TtsBackend, AudioPlayer } from '../../tts/backend.js';

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

/**
 * Мок менеджера с тремя движками: модалка должна брать список движков
 * из реестра (а не заширтое пару движков), но проверка должна стать бестой.
 */
function fakeManager(): TtsManager {
  const mgr = new TtsManager({ player: silentPlayer() });
  mgr.register(makeBackend('piper', 'Piper'));
  mgr.register(makeBackend('sherpa', 'sherpa-onnx'));
  mgr.register(makeBackend('espeak', 'eSpeak NG'));
  return mgr;
}

function makeBackend(id: string, label: string): TtsBackend {
  return {
    id,
    label,
    capabilities: { languages: ['ru'], offline: true, rateControl: false, pitchControl: false },
    check: async () => null,
    listVoices: async () => [{ id: `${id}-voice`, label: `${id} voice` }],
    synthesize: async () => ({ kind: 'buffer', buffer: Buffer.alloc(0) }),
    dispose: () => {},
  };
}

/** Плеер-заглушка: тесты не должны попадать в звук. */
function silentPlayer(): AudioPlayer {
  return {
    play: () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    onCallbacks: () => {},
    dispose: () => {},
  };
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

  // Раньше Engine циклил пару движков piper/espeak; теперь там список движков
  // берётся из реестра менеджера, поэтому любой движок появился бы в списке.
  it('opens an engine picker listing every registered engine', async () => {
    const { stdin, lastFrame } = render(
      <TtsConfigModal {...makeProps({ ttsManager: fakeManager() })} />,
    );
    await settle();
    stdin.write('\r'); // engine row is first (index 0)
    await settle();
    await settle(300); // let the availability checks settle
    const frame = lastFrame() ?? '';
    expect(frame).toContain('TTS engine');
    expect(frame).toContain('piper');
    expect(frame).toContain('sherpa');
    expect(frame).toContain('espeak');
  });

  it('applies the engine chosen in the picker', async () => {
    const onApply = vi.fn();
    const { stdin } = render(
      <TtsConfigModal {...makeProps({ onApply, ttsManager: fakeManager() })} />,
    );
    await settle();
    stdin.write('\r'); // open engine list
    await settle();
    stdin.write('j'); // piper -> sherpa
    await settle();
    stdin.write('\r'); // pick sherpa
    await settle();
    stdin.write('jjjjjj'); // back to the settings list, to Apply (index 6)
    await settle();
    stdin.write('\r');
    await settle();
    const applied = onApply.mock.calls[0]![0] as TtsConfig;
    expect(applied.engine).toBe('sherpa');
  });
});
