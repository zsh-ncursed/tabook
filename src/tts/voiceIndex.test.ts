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
  { path: 'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx', size: 46000000, type: 'file' },
  { path: 'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json', size: 2000, type: 'file' },
  { path: 'en/en_US/amy/medium/en_US-amy-medium.onnx', size: 52000000, type: 'file' },
  // Не голоса: samples и служебные каталоги
  { path: 'ru/ru_RU/irina/medium/samples/sentence_0.wav', size: 1000, type: 'file' },
  { path: '_script/prepare.py', size: 100, type: 'file' },
  { path: 'README.md', size: 100, type: 'file' },
];

interface TreeEntry {
  path: string;
  size: number;
  type: string;
}

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
      if (url.includes('/tree/main')) {
        return new Response(JSON.stringify(SAMPLE_TREE), { status: 200 });
      }
      // Metadata endpoint отдаёт один объект репозитория с тегами языков
      return new Response(
        JSON.stringify({ id: 'rhasspy/piper-voices', tags: ['onnx', 'ru', 'en'] }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;

    await refreshIndex();

    expect(calledUrls.some((u) => u.includes('/tree/main'))).toBe(true);
    const voices = loadCachedVoices();
    expect(voices).toHaveLength(2);
    // Установленных нет → сортировка по языку, потом по имени: en перед ru
    expect(voices.map((v) => v.id)).toEqual(['en/en_US/amy/medium', 'ru/ru_RU/irina/medium']);
    const irina = voices.find((v) => v.id === 'ru/ru_RU/irina/medium')!;
    expect(irina.language).toBe('ru');
    expect(irina.languageName).toBe('Russian');
    expect(irina.quality).toBe('medium');
    expect(irina.name).toContain('irina');
    expect(irina.file).toBe('ru_RU-irina-medium.onnx');
    expect(irina.downloadUrl).toContain('ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx');
    expect(irina.size).toBe(46000000);
    expect(irina.installed).toBe(false);
  });

  it('walks paginated tree responses via the Link header', async () => {
    // Две страницы: на первой — irina, на второй — amy; link есть только у первой
    let treeCall = 0;
    const pages: TreeEntry[][] = [[SAMPLE_TREE[0]!, SAMPLE_TREE[1]!], [SAMPLE_TREE[2]!]];
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      // Tree-запросы: первая страница и страница по cursor из Link header
      if (url.includes('/tree/main')) {
        const page = pages[treeCall++]!;
        const headers: Record<string, string> =
          treeCall < pages.length
            ? {
                link: '<https://hf-mirror.com/api/models/rhasspy/piper-voices/tree/main?cursor=abc>; rel="next"',
              }
            : {};
        return new Response(JSON.stringify(page), { status: 200, headers });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await refreshIndex();
    const voices = loadCachedVoices();
    expect(voices.map((v) => v.id).sort()).toEqual([
      'en/en_US/amy/medium',
      'ru/ru_RU/irina/medium',
    ]);
    expect(treeCall).toBe(2); // обе страницы прочитаны
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
      'ru',
      'ru_RU',
      'irina',
      'medium',
    );
    fs.mkdirSync(voiceDir, { recursive: true });
    fs.writeFileSync(path.join(voiceDir, 'ru_RU-irina-medium.onnx'), Buffer.from('fake'));

    await refreshIndex();
    const voices = loadCachedVoices();
    const irina = voices.find((v) => v.id === 'ru/ru_RU/irina/medium');
    expect(irina?.installed).toBe(true);
    const amy = voices.find((v) => v.id === 'en/en_US/amy/medium');
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
