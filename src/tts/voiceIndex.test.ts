import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadCachedVoices, refreshIndex, checkAndRefresh, piperVoiceDir } from './voiceIndex.js';

// Перехватываем fetch и домашнюю директорию, чтобы тесты не трогали сеть и
// реальный HOME пользователя.
const tmpHome = () =>
  path.join(os.tmpdir(), `tabook-vi-home-${process.pid}-${Math.random().toString(36).slice(2)}`);

const SAMPLE_TREE = [
  { path: 'ru_RU/irina/medium/ru_RU-irina-medium.onnx', size: 46000000, type: 'file' },
  { path: 'ru_RU/irina/medium/ru_RU-irina-medium.onnx.json', size: 2000, type: 'file' },
  { path: 'en_US/amy/medium/en_US-amy-medium.onnx', size: 52000000, type: 'file' },
  { path: 'README.md', size: 100, type: 'file' },
];

describe('voiceIndex', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalHome: string | undefined;
  let home: string;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalHome = process.env.HOME;
    home = tmpHome();
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, '.config', 'tabook'), { recursive: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
  });

  it('piperVoiceDir respects PIPER_MODELS_DIR', () => {
    process.env.PIPER_MODELS_DIR = '/custom/models';
    expect(piperVoiceDir()).toBe('/custom/models');
    delete process.env.PIPER_MODELS_DIR;
  });

  it('piperVoiceDir defaults to ~/.local/share/piper/voices', () => {
    expect(piperVoiceDir()).toBe(path.join(home, '.local', 'share', 'piper', 'voices'));
  });

  it('refreshIndex fetches the tree and builds voice records', async () => {
    const calledUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes('recursive=true')) {
        return new Response(JSON.stringify(SAMPLE_TREE), { status: 200 });
      }
      // Main API metadata (download counts)
      return new Response(
        JSON.stringify([
          { id: 'ru_RU/irina/medium', download_count: 500 },
          { id: 'en_US/amy/medium', download_count: 300 },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;

    await refreshIndex();

    expect(calledUrls.some((u) => u.includes('recursive=true'))).toBe(true);
    const voices = loadCachedVoices();
    expect(voices).toHaveLength(2);
    // Sorted by downloads desc → irina first
    expect(voices[0]!.id).toBe('ru_RU/irina/medium');
    expect(voices[0]!.downloads).toBe(500);
    expect(voices[0]!.language).toBe('ru_RU');
    expect(voices[0]!.languageName).toBe('Russian');
    expect(voices[0]!.quality).toBe('medium');
    expect(voices[0]!.downloadUrl).toContain('ru_RU/irina/medium/ru_RU-irina-medium.onnx');
    expect(voices[0]!.installed).toBe(false);
  });

  it('marks a voice installed when the .onnx exists on disk', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('recursive=true')) {
        return new Response(JSON.stringify(SAMPLE_TREE), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    // Симулируем установленный голос irina
    const voiceDir = path.join(
      home,
      '.local',
      'share',
      'piper',
      'voices',
      'ru_RU',
      'irina',
      'medium',
    );
    fs.mkdirSync(voiceDir, { recursive: true });
    fs.writeFileSync(path.join(voiceDir, 'ru_RU-irina-medium.onnx'), Buffer.from('fake'));

    await refreshIndex();
    const voices = loadCachedVoices();
    const irina = voices.find((v) => v.id === 'ru_RU/irina/medium');
    expect(irina?.installed).toBe(true);
    const amy = voices.find((v) => v.id === 'en_US/amy/medium');
    expect(amy?.installed).toBe(false);
  });

  it('checkAndRefresh skips the fetch while the cache is fresh', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(SAMPLE_TREE), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await refreshIndex();
    expect(fetchMock).toHaveBeenCalledTimes(2); // tree + metadata

    fetchMock.mockClear();
    await checkAndRefresh();
    // Кеш свежий — дополнительных запросов быть не должно
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when the HF API fails', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
    ) as unknown as typeof globalThis.fetch;

    await expect(refreshIndex()).rejects.toThrow(/HF API error: 500/);
  });

  it('loadCachedVoices returns [] when there is no cache file', () => {
    process.env.HOME = tmpHome(); // отдельный пустой HOME
    expect(loadCachedVoices()).toEqual([]);
  });
});
