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

  it('takes the install hint from the backend, not from a hardcoded switch', async () => {
    const mgr = new TtsManager({ player: silentPlayer() });
    mgr.register({
      ...makeBackend('vosk', 'Vosk TTS'),
      check: async () => 'vosk-tts not found',
      installHint: () => ({
        install: 'pipx install vosk-tts',
        notes: 'then download a model in :tts config',
      }),
    });
    const { stdin, lastFrame } = render(
      <TtsConfigModal {...makeProps({ ttsManager: mgr, tts: { ...baseTts, engine: 'vosk' } })} />,
    );
    await settle();
    stdin.write('\r'); // open engine picker
    await settle(300);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('pipx install vosk-tts');
    expect(frame).toContain('then download a model');
  });

  it('opens a voice catalogue for a non-piper engine and uses its label', async () => {
    const backend = catalogBackend();
    const { stdin, lastFrame } = render(
      <TtsConfigModal
        {...makeProps({ ttsManager: catalogManager(backend), tts: { ...baseTts, engine: 'vosk' } })}
      />,
    );
    await settle();
    stdin.write('j'); // Voice row
    await settle();
    stdin.write('\r');
    await settle(300);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Vosk TTS voices');
    expect(frame).toContain('Installed model');
    expect(frame).toContain('Remote model');
    expect(frame).toContain('installed');
  });

  it('falls back to local models and shows the catalog error when voiceCatalog fails', async () => {
    const backend: TtsBackend = {
      ...makeBackend('vosk', 'Vosk TTS'),
      voiceCatalog: async () => {
        throw new Error('Vosk model catalog unavailable: offline');
      },
    };
    const { stdin, lastFrame } = render(
      <TtsConfigModal
        {...makeProps({ ttsManager: catalogManager(backend), tts: { ...baseTts, engine: 'vosk' } })}
      />,
    );
    await settle();
    stdin.write('j'); // Voice row
    await settle();
    stdin.write('\r');
    await settle(300);
    const frame = lastFrame() ?? '';
    // Локальные модели остаются доступными, ошибка каталога — в футере.
    expect(frame).toContain('vosk voice');
    expect(frame).toContain('catalog unavailable');
  });

  it('shows the stale-cache warning in the footer', async () => {
    const backend: TtsBackend = {
      ...makeBackend('vosk', 'Vosk TTS'),
      catalogWarning: 'Vosk catalog unavailable (offline); using cached list',
      voiceCatalog: async () => [
        { id: 'm-installed', label: 'Installed model', language: 'ru', installed: true },
      ],
    };
    const { stdin, lastFrame } = render(
      <TtsConfigModal
        {...makeProps({ ttsManager: catalogManager(backend), tts: { ...baseTts, engine: 'vosk' } })}
      />,
    );
    await settle();
    stdin.write('j'); // Voice row
    await settle();
    stdin.write('\r');
    await settle(300);
    expect(lastFrame() ?? '').toContain('using cached list');
  });

  it('selects an installed model without installing it', async () => {
    const backend = catalogBackend();
    const onApply = vi.fn();
    const { stdin } = render(
      <TtsConfigModal
        {...makeProps({
          onApply,
          ttsManager: catalogManager(backend),
          tts: { ...baseTts, engine: 'vosk', voice: '' },
        })}
      />,
    );
    await settle();
    stdin.write('j');
    await settle();
    stdin.write('\r');
    await settle(300);
    stdin.write('\r'); // first entry — installed
    await settle();
    stdin.write('jjjjj'); // Voice row -> Apply
    await settle();
    stdin.write('\r');
    await settle();
    expect(backend.installVoice).not.toHaveBeenCalled();
    expect((onApply.mock.calls[0]![0] as TtsConfig).voice).toBe('m-installed');
  });

  it('opens a speaker picker for a multi-speaker model and saves model#N', async () => {
    const backend = catalogBackend();
    const onApply = vi.fn();
    const { stdin, lastFrame } = render(
      <TtsConfigModal
        {...makeProps({
          onApply,
          ttsManager: catalogManager(backend),
          tts: { ...baseTts, engine: 'vosk', voice: '' },
        })}
      />,
    );
    await settle();
    stdin.write('j');
    await settle();
    stdin.write('\r');
    await settle(300);
    stdin.write('j'); // second entry — multi-speaker
    await settle();
    stdin.write('\r');
    await settle();
    expect(lastFrame() ?? '').toContain('speaker');
    stdin.write('j'); // speaker 0 -> 1
    await settle();
    stdin.write('\r');
    await settle();
    stdin.write('jjjjj'); // Voice -> Apply
    await settle();
    stdin.write('\r');
    await settle();
    expect((onApply.mock.calls[0]![0] as TtsConfig).voice).toBe('m-multi#1');
  });

  it('installs an uninstalled model and shows progress', async () => {
    let finish!: (voice: string) => void;
    const backend = catalogBackend();
    backend.installVoice = vi.fn(
      (_id, onProgress) =>
        new Promise<string>((res) => {
          onProgress({ phase: 'download', done: 50, total: 100 });
          finish = res;
        }),
    );
    const onApply = vi.fn();
    const { stdin, lastFrame } = render(
      <TtsConfigModal
        {...makeProps({
          onApply,
          ttsManager: catalogManager(backend),
          tts: { ...baseTts, engine: 'vosk', voice: '' },
        })}
      />,
    );
    await settle();
    stdin.write('j');
    await settle();
    stdin.write('\r');
    await settle(300);
    stdin.write('jj'); // third entry — remote
    await settle();
    stdin.write('\r');
    await settle();
    expect(backend.installVoice).toHaveBeenCalledWith(
      'm-remote',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(lastFrame() ?? '').toContain('50%');
    finish('m-remote#0');
    await settle();
    stdin.write('jjjjj');
    await settle();
    stdin.write('\r');
    await settle();
    expect((onApply.mock.calls[0]![0] as TtsConfig).voice).toBe('m-remote#0');
  });

  it('aborts an in-flight install on esc and keeps the picker open', async () => {
    const backend = catalogBackend();
    let seenSignal: AbortSignal | undefined;
    backend.installVoice = vi.fn(
      (_id, _onProgress, signal) =>
        new Promise<string>((_res, rej) => {
          seenSignal = signal;
          signal?.addEventListener('abort', () => rej(new Error('Download cancelled')));
        }),
    );
    const { stdin, lastFrame } = render(
      <TtsConfigModal
        {...makeProps({
          ttsManager: catalogManager(backend),
          tts: { ...baseTts, engine: 'vosk', voice: '' },
        })}
      />,
    );
    await settle();
    stdin.write('j');
    await settle();
    stdin.write('\r');
    await settle(300);
    stdin.write('jj');
    await settle();
    stdin.write('\r'); // start install
    await settle();
    stdin.write('\u001b'); // cancel download
    await settle();
    expect(seenSignal?.aborted).toBe(true);
    expect(lastFrame() ?? '').toContain('Vosk TTS voices');
    expect(lastFrame() ?? '').toContain('Download cancelled');
  });
});

/** Каталог с установленной, multi- и удалённой моделями. */
function catalogBackend(): TtsBackend & { installVoice: ReturnType<typeof vi.fn> } {
  return {
    id: 'vosk',
    label: 'Vosk TTS',
    capabilities: { languages: ['ru'], offline: true, rateControl: true, pitchControl: false },
    check: async () => null,
    voiceCatalog: async () => [
      { id: 'm-installed', label: 'Installed model', language: 'ru', installed: true },
      { id: 'm-multi', label: 'Multi model', language: 'ru', installed: true, speakers: 2 },
      { id: 'm-remote', label: 'Remote model', language: 'ru', installed: false, size: 1024 },
    ],
    installVoice: vi.fn(async (id: string) => `${id}#0`),
    synthesize: async () => ({ kind: 'buffer', buffer: Buffer.alloc(0) }),
    dispose: () => {},
  };
}

function catalogManager(backend: TtsBackend): TtsManager {
  const mgr = new TtsManager({ player: silentPlayer() });
  mgr.register(backend);
  return mgr;
}
