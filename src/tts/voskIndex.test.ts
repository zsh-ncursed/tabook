import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import {
  VOSK_MODEL_LIST_URL,
  estimateSpeakers,
  loadVoskCatalog,
  parseVoskModelList,
  voskIndexCachePath,
} from './voskIndex.js';
import { testTmpdir } from '../testutil/tmpdir.js';

const NOW = 1_790_000_000_000;

/** Сырые записи в том виде, в каком их отдаёт alphacephei.com. */
const RAW = [
  {
    lang: 'ru',
    md5: 'B13984511676D857C626206AED23054F',
    name: 'vosk-model-tts-ru-0.1-irina',
    obsolete: 'true',
    size: 74194313,
    type: 'tts',
    url: 'https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.1-irina.zip',
    version: '0.1-irina',
  },
  {
    lang: 'ru',
    md5: '4d799f050ef931c45b522b6323c172bf',
    name: 'vosk-model-tts-ru-0.4-irina',
    obsolete: 'false',
    size: 121450024,
    type: 'tts',
    url: 'https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.4-irina.zip',
    version: '0.4-irina',
  },
  {
    lang: 'ru',
    md5: '2f8b6dbf64e912f9ee7eda50ba2d3c80',
    name: 'vosk-model-tts-ru-0.9-multi',
    obsolete: false,
    size: 782787154,
    type: 'tts',
    url: 'https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.9-multi.zip',
    version: '0.9-multi',
  },
  { name: 'vosk-model-small-ru-0.22', type: 'asr', url: 'https://example/asr.zip' },
  { name: 'no-url', type: 'tts', obsolete: 'false' },
  { name: 'vosk-model-tts-ru-0.4-irina', type: 'tts', url: 'https://example/dupe.zip' },
  null,
  'junk',
];

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

function failResponse(status = 503): Response {
  return {
    ok: false,
    status,
    statusText: 'Service Unavailable',
    json: async () => ({}),
  } as unknown as Response;
}

describe('parseVoskModelList', () => {
  it('keeps only current TTS models and tolerates junk entries', () => {
    const models = parseVoskModelList(RAW);
    expect(models.map((m) => m.id)).toEqual([
      'vosk-model-tts-ru-0.4-irina',
      'vosk-model-tts-ru-0.9-multi',
    ]);
  });

  it('excludes obsolete="true" but keeps the string "false"', () => {
    const ids = parseVoskModelList(RAW).map((m) => m.id);
    expect(ids).not.toContain('vosk-model-tts-ru-0.1-irina');
    expect(ids).toContain('vosk-model-tts-ru-0.4-irina');
  });

  it('drops 0.1 models even when not marked obsolete (dictionary incompatible with vosk-tts)', () => {
    const models = parseVoskModelList([
      {
        name: 'vosk-model-tts-ru-0.1-tamara',
        type: 'tts',
        obsolete: 'false',
        url: 'https://example/tamara.zip',
      },
    ]);
    expect(models).toEqual([]);
  });

  it('normalizes metadata: size, lowercase md5, label, multi speakers', () => {
    const multi = parseVoskModelList(RAW).find((m) => m.id === 'vosk-model-tts-ru-0.9-multi')!;
    expect(multi.size).toBe(782787154);
    expect(multi.md5).toBe('2f8b6dbf64e912f9ee7eda50ba2d3c80');
    expect(multi.language).toBe('ru');
    expect(multi.version).toBe('0.9-multi');
    expect(multi.speakers).toBe(5);
    expect(multi.label).toContain('0.9-multi');
    expect(parseVoskModelList(RAW).find((m) => m.id.endsWith('0.4-irina'))!.speakers).toBe(1);
  });

  it('returns an empty list for a non-array payload', () => {
    expect(parseVoskModelList({ models: [] })).toEqual([]);
    expect(parseVoskModelList(null)).toEqual([]);
  });
});

describe('estimateSpeakers', () => {
  it('treats -multi models as five-speaker ones', () => {
    expect(estimateSpeakers('vosk-model-tts-ru-0.9-multi')).toBe(5);
    expect(estimateSpeakers('vosk-model-tts-ru-0.4-irina')).toBe(1);
  });
});

describe('loadVoskCatalog', () => {
  it('writes a cache and does not re-fetch while it is fresh', async () => {
    const dir = testTmpdir('vosk-index-fresh');
    const cachePath = join(dir, 'index.json');
    const fetchImpl = vi.fn(async () => okResponse(RAW));
    const first = await loadVoskCatalog({
      cachePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(first.models).toHaveLength(2);
    expect(first.stale).toBe(false);
    expect(fs.existsSync(cachePath)).toBe(true);

    const second = await loadVoskCatalog({
      cachePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW + 1000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.models.map((m) => m.id)).toEqual(first.models.map((m) => m.id));
  });

  it('uses the stale cache when the network fails', async () => {
    const dir = testTmpdir('vosk-index-stale');
    const cachePath = join(dir, 'index.json');
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        updatedAt: NOW - 48 * 60 * 60 * 1000,
        models: [
          {
            id: 'vosk-model-tts-ru-0.4-irina',
            label: 'Cached',
            language: 'ru',
            url: 'https://example/cached.zip',
            speakers: 1,
          },
        ],
      }),
    );
    const out = await loadVoskCatalog({
      cachePath,
      fetchImpl: (async () => failResponse()) as typeof fetch,
      now: () => NOW,
    });
    expect(out.stale).toBe(true);
    expect(out.models[0]!.id).toBe('vosk-model-tts-ru-0.4-irina');
    expect(out.warning).toContain('cached');
  });

  it('throws when the network fails and there is no cache', async () => {
    const dir = testTmpdir('vosk-index-nocache');
    await expect(
      loadVoskCatalog({
        cachePath: join(dir, 'missing.json'),
        fetchImpl: (async () => failResponse()) as typeof fetch,
        now: () => NOW,
      }),
    ).rejects.toThrow(/catalog unavailable/);
  });

  it('treats an empty TTS section as a bad response and falls back to cache', async () => {
    const dir = testTmpdir('vosk-index-empty');
    const cachePath = join(dir, 'index.json');
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        updatedAt: NOW - 1000,
        models: [
          {
            id: 'vosk-model-tts-ru-0.4-irina',
            label: 'Cached',
            language: 'ru',
            url: 'https://example/cached.zip',
            speakers: 1,
          },
        ],
      }),
    );
    const out = await loadVoskCatalog({
      cachePath,
      fetchImpl: (async () => okResponse([{ type: 'asr' }])) as typeof fetch,
      now: () => NOW,
      ttlMs: 1, // кеш просрочен, значит пойдём в «сеть»
    });
    expect(out.stale).toBe(true);
    expect(out.models).toHaveLength(1);
  });

  it('propagates cancellation instead of falling back to cache', async () => {
    const dir = testTmpdir('vosk-index-abort');
    const cachePath = join(dir, 'index.json');
    fs.writeFileSync(cachePath, JSON.stringify({ updatedAt: 0, models: [] }));
    const err = new Error('aborted');
    err.name = 'AbortError';
    await expect(
      loadVoskCatalog({
        cachePath,
        fetchImpl: (async () => {
          throw err;
        }) as typeof fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('points at alphacephei.com and the XDG cache location', () => {
    expect(VOSK_MODEL_LIST_URL).toContain('alphacephei.com');
    expect(voskIndexCachePath()).toContain(join('.config', 'tabook', 'tts-vosk-index.json'));
  });
});
