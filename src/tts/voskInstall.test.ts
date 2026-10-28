import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { extractZip, installVoskModel, md5File, voskModelsDir } from './voskInstall.js';
import type { VoskCatalogModel } from './voskIndex.js';
import { commandAvailable } from './modelPaths.js';
import { testTmpdir } from '../testutil/tmpdir.js';

const ARCHIVE = Buffer.from('fake zip payload');

function model(overrides: Partial<VoskCatalogModel> = {}): VoskCatalogModel {
  return {
    id: 'vosk-model-tts-ru-0.4-irina',
    label: 'Vosk TTS RU 0.4-irina',
    language: 'ru',
    size: ARCHIVE.length,
    md5: createHash('md5').update(ARCHIVE).digest('hex'),
    url: 'https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.4-irina.zip',
    speakers: 1,
    version: '0.4-irina',
    ...overrides,
  };
}

/** Создать раскладку валидной модели; multistream требует ещё bert/. */
function writeModel(dir: string, { multistream = false } = {}): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'model.onnx'), 'x');
  fs.writeFileSync(join(dir, 'dictionary'), 'x');
  fs.writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ model_type: multistream ? 'multistream_v1' : 'vits', num_speakers: 1 }),
  );
  if (multistream) {
    fs.mkdirSync(join(dir, 'bert'), { recursive: true });
    fs.writeFileSync(join(dir, 'bert', 'model.onnx'), 'x');
    fs.writeFileSync(join(dir, 'bert', 'vocab.txt'), 'x');
  }
}

/** Скачивание-заглушка: кладёт bytes в dest и рапортует прогресс. */
function fakeDownload(bytes: Uint8Array = ARCHIVE) {
  return vi.fn(async (opts: { dest: string; onProgress?: (d: number, t?: number) => void }) => {
    fs.writeFileSync(opts.dest, bytes);
    opts.onProgress?.(bytes.length, bytes.length);
    return { path: opts.dest, size: bytes.length };
  });
}

/** Распаковка-заглушка: раскладывает модель `<dest>/<id>`. */
function fakeExtract(id = 'vosk-model-tts-ru-0.4-irina', opts: { multistream?: boolean } = {}) {
  return vi.fn(async (_zip: string, dest: string) => {
    writeModel(join(dest, id), opts);
  });
}

describe('voskModelsDir', () => {
  it('defaults to ~/.local/share/vosk and expands the configured path', () => {
    const prev = process.env.HOME;
    process.env.HOME = '/home/test';
    try {
      expect(voskModelsDir('')).toBe(join('/home/test', '.local', 'share', 'vosk'));
      expect(voskModelsDir('~/models')).toBe(join('/home/test', 'models'));
    } finally {
      process.env.HOME = prev;
    }
  });
});

describe('md5File', () => {
  it('hashes a file without loading it whole', async () => {
    const dir = testTmpdir('vosk-md5');
    const file = join(dir, 'blob');
    fs.writeFileSync(file, ARCHIVE);
    expect(await md5File(file)).toBe(createHash('md5').update(ARCHIVE).digest('hex'));
  });
});

describe('installVoskModel', () => {
  it('returns early when a valid model is already installed', async () => {
    const dir = testTmpdir('vosk-install-ready');
    const models = join(dir, 'models');
    writeModel(join(models, model().id));
    const download = fakeDownload();
    const extract = fakeExtract();
    const progress: string[] = [];
    const voice = await installVoskModel({
      id: model().id,
      model: model(),
      modelsDir: models,
      onProgress: (p) => progress.push(p.phase),
      download,
      extract,
    });
    expect(voice).toBe(`${model().id}#0`);
    expect(download).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(progress).toContain('validate');
  });

  it('downloads, verifies md5, extracts, validates and renames atomically', async () => {
    const dir = testTmpdir('vosk-install-ok');
    const models = join(dir, 'models');
    const phases = new Set<string>();
    const download = fakeDownload();
    const extract = fakeExtract();
    const voice = await installVoskModel({
      id: model().id,
      model: model(),
      modelsDir: models,
      onProgress: (p) => phases.add(p.phase),
      download,
      extract,
    });
    expect(voice).toBe(`${model().id}#0`);
    expect(fs.existsSync(join(models, model().id, 'model.onnx'))).toBe(true);
    // Временный zip и tmp не должны пережить установку.
    const leftovers = fs.readdirSync(models).filter((n) => n.startsWith('.'));
    expect(leftovers).toEqual([]);
    expect([...phases]).toEqual(
      expect.arrayContaining(['download', 'verify', 'extract', 'validate']),
    );
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ url: model().url, timeoutMs: 60 * 60 * 1000 }),
    );
  });

  it('extracts a real zip through bsdtar or unzip', async () => {
    // На машинах без архиваторов ветка extractZip покрыта тестом-подсказкой.
    if (!commandAvailable('bsdtar') && !commandAvailable('unzip')) return;
    const dir = testTmpdir('vosk-install-realzip');
    const models = join(dir, 'models');
    const id = model().id;
    const zip = new AdmZip();
    zip.addFile(`${id}/model.onnx`, Buffer.from('x'));
    zip.addFile(`${id}/dictionary`, Buffer.from('x'));
    zip.addFile(
      `${id}/config.json`,
      Buffer.from(JSON.stringify({ model_type: 'vits', num_speakers: 1 })),
    );
    const bytes = zip.toBuffer();
    const voice = await installVoskModel({
      id,
      model: model({ size: bytes.length, md5: createHash('md5').update(bytes).digest('hex') }),
      modelsDir: models,
      onProgress: () => {},
      download: fakeDownload(bytes),
    });
    expect(voice).toBe(`${id}#0`);
    expect(fs.existsSync(join(models, id, 'config.json'))).toBe(true);
    expect(fs.readdirSync(models).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('accepts an archive with a single top-level dir that differs from the id', async () => {
    const dir = testTmpdir('vosk-install-singledir');
    const models = join(dir, 'models');
    const extract = vi.fn(async (_zip: string, dest: string) => {
      writeModel(join(dest, 'vosk-model-tts-ru-0.9-multi'), { multistream: true });
    });
    const voice = await installVoskModel({
      id: 'vosk-model-tts-ru-0.9-multi',
      model: model({ id: 'vosk-model-tts-ru-0.9-multi', speakers: 5 }),
      modelsDir: models,
      onProgress: () => {},
      download: fakeDownload(),
      extract,
    });
    expect(voice).toBe('vosk-model-tts-ru-0.9-multi#0');
    expect(fs.existsSync(join(models, 'vosk-model-tts-ru-0.9-multi', 'bert', 'model.onnx'))).toBe(
      true,
    );
  });

  it('rejects a checksum mismatch and cleans temporary files', async () => {
    const dir = testTmpdir('vosk-install-md5');
    const models = join(dir, 'models');
    const progress: string[] = [];
    await expect(
      installVoskModel({
        id: model().id,
        model: model({ md5: '00000000000000000000000000000000' }),
        modelsDir: models,
        onProgress: (p) => progress.push(p.phase),
        download: fakeDownload(),
        extract: fakeExtract(),
      }),
    ).rejects.toThrow(/checksum mismatch/);
    expect(fs.existsSync(join(models, model().id))).toBe(false);
    expect(fs.readdirSync(models).filter((n) => n.startsWith('.'))).toEqual([]);
    expect(progress).toContain('verify');
  });

  it('rejects an archive without a model directory and cleans up', async () => {
    const dir = testTmpdir('vosk-install-layout');
    const models = join(dir, 'models');
    await expect(
      installVoskModel({
        id: model().id,
        model: model(),
        modelsDir: models,
        onProgress: () => {},
        download: fakeDownload(),
        extract: async () => {},
      }),
    ).rejects.toThrow(/Unexpected archive layout/);
    expect(fs.existsSync(join(models, model().id))).toBe(false);
    expect(fs.readdirSync(models).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('rejects a model missing required files and keeps the old one', async () => {
    const dir = testTmpdir('vosk-install-invalid');
    const models = join(dir, 'models');
    const dest = join(models, model().id);
    writeModel(dest);
    fs.rmSync(join(dest, 'dictionary'));

    await expect(
      installVoskModel({
        id: model().id,
        model: model(),
        modelsDir: models,
        onProgress: () => {},
        download: fakeDownload(),
        extract: vi.fn(async (_zip: string, tmp: string) => {
          const m = join(tmp, model().id);
          writeModel(m);
          fs.rmSync(join(m, 'dictionary'));
        }),
      }),
    ).rejects.toThrow(/invalid \(missing dictionary\)/);
    // Старая (пусть и неполная) модель осталась на месте.
    expect(fs.existsSync(join(dest, 'model.onnx'))).toBe(true);
    expect(fs.readdirSync(models).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
  });

  it('replaces an existing model only after the new one is validated', async () => {
    const dir = testTmpdir('vosk-install-replace');
    const models = join(dir, 'models');
    writeModel(join(models, model().id));
    const newId = 'vosk-model-tts-ru-0.9-multi';
    const voice = await installVoskModel({
      id: newId,
      model: model({ id: newId, speakers: 5 }),
      modelsDir: models,
      onProgress: () => {},
      download: fakeDownload(),
      extract: fakeExtract(newId),
    });
    expect(voice).toBe(`${newId}#0`);
    expect(fs.existsSync(join(models, newId, 'model.onnx'))).toBe(true);
    expect(fs.readdirSync(models).filter((n) => n.startsWith('.old-'))).toEqual([]);
  });

  it('aborts cleanly when the signal fires before download', async () => {
    const dir = testTmpdir('vosk-install-abort');
    const models = join(dir, 'models');
    const ctl = new AbortController();
    ctl.abort();
    const download = fakeDownload();
    await expect(
      installVoskModel({
        id: model().id,
        model: model(),
        modelsDir: models,
        onProgress: () => {},
        download: download as never,
        extract: fakeExtract(),
        signal: ctl.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(download).not.toHaveBeenCalled();
    expect(fs.existsSync(join(models, model().id))).toBe(false);
  });
});

describe('extractZip', () => {
  it('explains what to install when no archive tool is available', async () => {
    const dir = testTmpdir('vosk-extract-no-tools');
    const prevPath = process.env.PATH;
    process.env.PATH = dir;
    try {
      await expect(extractZip(join(dir, 'a.zip'), dir)).rejects.toThrow(
        /install libarchive \(bsdtar\) or unzip/,
      );
    } finally {
      process.env.PATH = prevPath;
    }
  });
});
