import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { VoiceManager } from './voiceManager.js';
import { refreshIndex, piperVoiceDir } from './voiceIndex.js';
import { testTmpdir } from '../testutil/tmpdir.js';

// Piper требует модель и её .onnx.json-конфиг рядом: проверяем, что
// downloadVoice качает оба файла и не считает голос установанным без конфига.
const tmpHome = () => path.join(testTmpdir('tabook-vm-home'), 'home');

const SAMPLE_TREE = [
  { path: 'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx', size: 46000000, type: 'file' },
  { path: 'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json', size: 2000, type: 'file' },
  { path: 'en/en_US/amy/medium/en_US-amy-medium.onnx', size: 52000000, type: 'file' },
];

const RESOLVE_PREFIX = 'https://hf-mirror.com/rhasspy/piper-voices/resolve/main/';

describe('VoiceManager', () => {
  let originalHome: string | undefined;
  let home: string;
  let fetchedUrls: string[];

  beforeEach(() => {
    originalHome = process.env.HOME;
    home = tmpHome();
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, '.config', 'tabook'), { recursive: true });
    fetchedUrls = [];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
  });

  /**
   * Мокаем fetch: tree/metadata отдают индекс, а resolve/main «скачивает»
   * файл — пишем его на диск по тому же пути, куда его положит VoiceManager,
   * чтобы установленные голоса потом находились на диске.
   */
  function mockFetch(): void {
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/tree/main')) {
        return new Response(JSON.stringify(SAMPLE_TREE), { status: 200 });
      }
      if (url.startsWith(RESOLVE_PREFIX)) {
        fetchedUrls.push(url);
        const rel = url.slice(RESOLVE_PREFIX.length);
        const parts = rel.split('/');
        const fileName = parts[parts.length - 1]!;
        const voiceId = parts.slice(0, -1).join('/');
        const dest = path.join(piperVoiceDir(), voiceId, fileName);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(
          dest,
          Buffer.from(fileName.endsWith('.json') ? '{"audio": {}}' : 'FAKE-ONNX'),
        );
        // streaming-читатель downloadFile тянет тело через response.body
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(fileName.endsWith('.json') ? [123, 125] : [70]));
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-length': '2' },
        });
      }
      // metadata endpoint
      return new Response(JSON.stringify({ tags: ['ru', 'en'] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
  }

  it('downloads both the .onnx model and its .onnx.json config', async () => {
    mockFetch();
    await refreshIndex();
    const mgr = new VoiceManager({});

    await mgr.downloadVoice('ru/ru_RU/irina/medium');

    const dir = path.join(
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
    expect(fs.existsSync(path.join(dir, 'ru_RU-irina-medium.onnx'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'ru_RU-irina-medium.onnx.json'))).toBe(true);

    expect(fetchedUrls).toContain(`${RESOLVE_PREFIX}ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx`);
    expect(fetchedUrls).toContain(
      `${RESOLVE_PREFIX}ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json`,
    );
  });

  it('installedVoices requires both model and config', async () => {
    mockFetch();
    await refreshIndex();
    const mgr = new VoiceManager({});

    const dir = path.join(
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
    fs.mkdirSync(dir, { recursive: true });

    // Только модель — не установлено: piper не запустится без конфига
    fs.writeFileSync(path.join(dir, 'ru_RU-irina-medium.onnx'), Buffer.from('x'));
    expect(mgr.installedVoices().find((v) => v.id === 'ru/ru_RU/irina/medium')?.installed).toBe(
      false,
    );

    // Добавили конфиг — установлено
    fs.writeFileSync(path.join(dir, 'ru_RU-irina-medium.onnx.json'), Buffer.from('{}'));
    expect(mgr.installedVoices().find((v) => v.id === 'ru/ru_RU/irina/medium')?.installed).toBe(
      true,
    );
  });
});
