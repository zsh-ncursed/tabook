import { describe, it, expect, vi } from 'vitest';
import { TtsManager } from './manager.js';
import type { TtsChunk } from './types.js';
import type { AudioPlayer, WavSource } from './backend.js';

// Мок-плеер: воспроизведение мгновенно, onEnded вызывается вручную.
function mockPlayer(): AudioPlayer & { fireEnded(): void } {
  const cbs: { onEnded: () => void; onError: (m: string) => void } = {
    onEnded: () => {},
    onError: () => {},
  };
  return {
    onCallbacks: (cb) => {
      cbs.onEnded = cb.onEnded;
      cbs.onError = cb.onError;
    },
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    fireEnded: () => cbs.onEnded(),
  };
}

const SILENCE: WavSource = { kind: 'buffer', buffer: Buffer.alloc(0) };

describe('TtsManager', () => {
  it('starts idle and reports status to listeners', () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player });
    const statuses: string[] = [];
    mgr.onStatus((s) => statuses.push(s.state));
    expect(statuses).toEqual(['idle']);
  });

  it('plays chunks through the engine and advances on chunk end', async () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player, interChunkPauseMs: 0 });
    const synthesize = vi.fn(async () => SILENCE);
    mgr.register({
      id: 'mock',
      label: 'Mock',
      capabilities: { languages: ['ru'], offline: true, rateControl: false },
      check: async () => null,
      synthesize,
      dispose: () => {},
    });

    const statuses: string[] = [];
    mgr.onStatus((s) => statuses.push(s.state));

    mgr.play(
      [
        { text: 'first', startChar: 0 },
        { text: 'second', startChar: 5 },
      ],
      { engine: 'mock' },
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('playing');

    // Первый чанк доиграл — переходим ко второму
    player.fireEnded();
    await new Promise((r) => setTimeout(r, 10));
    expect(synthesize).toHaveBeenCalledTimes(2);

    // Второй доиграл — idle
    player.fireEnded();
    await new Promise((r) => setTimeout(r, 10));
    expect(mgr.getStatus().state).toBe('idle');
  });

  it('stop resets to idle and prevents further advance', async () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player, interChunkPauseMs: 0 });
    mgr.register({
      id: 'mock',
      label: 'Mock',
      capabilities: { languages: ['ru'], offline: true, rateControl: false },
      check: async () => null,
      synthesize: async () => SILENCE,
      dispose: () => {},
    });

    mgr.play([{ text: 'a', startChar: 0 }, { text: 'b', startChar: 1 }], { engine: 'mock' });
    await new Promise((r) => setTimeout(r, 5));
    mgr.stop();
    expect(mgr.getStatus().state).toBe('idle');
    player.fireEnded();
    await new Promise((r) => setTimeout(r, 10));
    // Не начался следующий чанк
    expect(mgr.getStatus().state).toBe('idle');
  });

  it('reports an error when no engine is registered', () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player });
    mgr.play([{ text: 'a', startChar: 0 }]);
    expect(mgr.getStatus().state).toBe('error');
  });

  it('drops empty chunks instead of crashing the engine', () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player });
    const synthesize = vi.fn<(c: TtsChunk) => Promise<WavSource>>(async () => SILENCE);
    mgr.register({
      id: 'mock',
      label: 'Mock',
      capabilities: { languages: ['ru'], offline: true, rateControl: false },
      check: async () => null,
      synthesize,
      dispose: () => {},
    });
    // Пустые/whitespace-чанки — piper падает на пустом stdin.
    mgr.play(
      [
        { text: '', startChar: 0 },
        { text: '   ', startChar: 0 },
        { text: 'real text', startChar: 5 },
      ],
      { engine: 'mock' },
    );
    expect(mgr.getStatus().state).toBe('playing');
    expect(synthesize).toHaveBeenCalledTimes(1);
    const firstCall = synthesize.mock.calls.at(0);
    expect((firstCall?.[0] as TtsChunk | undefined)?.text).toBe('real text');
  });

  it('errors gracefully when every chunk is empty', () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player });
    mgr.play([{ text: '   ', startChar: 0 }]);
    expect(mgr.getStatus()).toEqual({ state: 'error', message: 'nothing to read at this position' });
  });

  it('toggle pauses and resumes', async () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player, interChunkPauseMs: 0 });
    mgr.register({
      id: 'mock',
      label: 'Mock',
      capabilities: { languages: ['ru'], offline: true, rateControl: false },
      check: async () => null,
      synthesize: async () => SILENCE,
      dispose: () => {},
    });
    mgr.play([{ text: 'a', startChar: 0 }], { engine: 'mock' });
    await new Promise((r) => setTimeout(r, 5));
    expect(mgr.toggle().state).toBe('paused');
    expect(player.pause).toHaveBeenCalled();
    expect(mgr.toggle().state).toBe('playing');
    expect(player.resume).toHaveBeenCalled();
  });

  it('lists registered engines', () => {
    const player = mockPlayer();
    const mgr = new TtsManager({ player });
    mgr.register({
      id: 'a',
      label: 'A',
      capabilities: { languages: ['ru'], offline: true, rateControl: false },
      check: async () => null,
      synthesize: async () => SILENCE,
      dispose: () => {},
    });
    expect(mgr.engines.map((e) => e.id)).toEqual(['a']);
    expect(mgr.resolveBackend('a')?.id).toBe('a');
    expect(mgr.resolveBackend('nope')).toBeNull();
    expect(mgr.resolveBackend('auto')?.id).toBe('a');
  });
});
