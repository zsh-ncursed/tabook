import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import {
  VoskBackend,
  parseVoskVoice,
  readSpeakerCount,
  validateVoskModel,
  voskBinCandidates,
  voskDictionaryCompatible,
} from './vosk.js';
import { testTmpdir } from '../testutil/tmpdir.js';

interface ModelOptions {
  speakers?: number;
  modelType?: string;
  bert?: boolean;
  skip?: string[];
  /** 0.1-формат: словарь без длительностей фонем. */
  oldDictionary?: boolean;
}

function writeModel(dir: string, opts: ModelOptions = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const skip = new Set(opts.skip ?? []);
  if (!skip.has('model.onnx')) fs.writeFileSync(join(dir, 'model.onnx'), '');
  if (!skip.has('config.json')) {
    fs.writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        num_speakers: opts.speakers ?? 1,
        ...(opts.modelType ? { model_type: opts.modelType } : {}),
      }),
    );
  }
  if (!skip.has('dictionary')) {
    fs.writeFileSync(join(dir, 'dictionary'), opts.oldDictionary ? '!SIL SIL\n' : '!SIL 1 SIL\n');
  }
  if (opts.bert) {
    fs.mkdirSync(join(dir, 'bert'), { recursive: true });
    fs.writeFileSync(join(dir, 'bert', 'model.onnx'), '');
    fs.writeFileSync(join(dir, 'bert', 'vocab.txt'), '');
  }
  return dir;
}

function fakeBin(dir: string): string {
  const p = join(dir, 'vosk-tts');
  fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(p, 0o755);
  return p;
}

/** Изолировать HOME/PATH/env, чтобы тесты не видели реальные модели. */
async function withIsolatedEnv<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const saved = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    VOSK_MODEL_PATH: process.env.VOSK_MODEL_PATH,
    VOSK_TTS_COMMAND: process.env.VOSK_TTS_COMMAND,
    TABOOK_TTS_COMMAND: process.env.TABOOK_TTS_COMMAND,
  };
  const emptyPath = join(root, 'empty-path');
  fs.mkdirSync(emptyPath, { recursive: true });
  process.env.PATH = emptyPath;
  process.env.HOME = root;
  delete process.env.VOSK_MODEL_PATH;
  delete process.env.VOSK_TTS_COMMAND;
  delete process.env.TABOOK_TTS_COMMAND;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('parseVoskVoice', () => {
  it('parses model#speaker, bare model, empty and invalid speaker', () => {
    expect(parseVoskVoice('vosk-model#2', 'fallback')).toEqual({
      model: 'vosk-model',
      speaker: 2,
    });
    expect(parseVoskVoice('vosk-model', 'fallback')).toEqual({
      model: 'vosk-model',
      speaker: 0,
    });
    expect(parseVoskVoice('', 'fallback')).toEqual({ model: 'fallback', speaker: 0 });
    expect(parseVoskVoice('vosk-model#-3', 'fallback')).toEqual({
      model: 'vosk-model',
      speaker: 0,
    });
    expect(parseVoskVoice('vosk-model#oops', 'fallback')).toEqual({
      model: 'vosk-model',
      speaker: 0,
    });
  });
});

describe('readSpeakerCount', () => {
  it('reads num_speakers (the key real Vosk models use)', () => {
    const dir = writeModel(testTmpdir('vosk-count-num'), { speakers: 5 });
    expect(readSpeakerCount(dir)).toBe(5);
  });

  it('falls back to the speaker_id_map length', () => {
    const dir = testTmpdir('vosk-count-map');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ speaker_id_map: ['female_0', 'female_1', 'male_0'] }),
    );
    expect(readSpeakerCount(dir)).toBe(3);
  });

  it('falls back to -multi in the directory name and clamps the range', () => {
    const multi = testTmpdir('vosk-count-multi');
    fs.mkdirSync(multi, { recursive: true });
    fs.writeFileSync(join(multi, 'config.json'), '{}');
    expect(readSpeakerCount(join(multi, 'model-multi'))).toBe(5);

    const huge = writeModel(testTmpdir('vosk-count-huge'), { speakers: 99 });
    expect(readSpeakerCount(huge)).toBe(20);
  });
});

describe('validateVoskModel', () => {
  it('reports a missing model.onnx', () => {
    const dir = writeModel(testTmpdir('vosk-valid-missing'), { skip: ['model.onnx'] });
    expect(validateVoskModel(dir)).toBe('model.onnx');
  });

  it('requires bert/ only for multistream models', () => {
    const plain = writeModel(testTmpdir('vosk-valid-plain'));
    expect(validateVoskModel(plain)).toBeNull();

    const multi = writeModel(testTmpdir('vosk-valid-multi'), { modelType: 'multistream_v1' });
    expect(validateVoskModel(multi)).toBe('bert/model.onnx');

    const complete = writeModel(testTmpdir('vosk-valid-multi-bert'), {
      modelType: 'multistream_v1',
      bert: true,
    });
    expect(validateVoskModel(complete)).toBeNull();
  });
});

describe('voskDictionaryCompatible', () => {
  it('accepts three-column dictionaries and rejects the 0.1 two-column form', () => {
    expect(voskDictionaryCompatible(writeModel(testTmpdir('vosk-dict-new')))).toBe(true);
    expect(
      voskDictionaryCompatible(writeModel(testTmpdir('vosk-dict-old'), { oldDictionary: true })),
    ).toBe(false);
    expect(voskDictionaryCompatible(testTmpdir('vosk-dict-none'))).toBe(false);
  });
});

describe('VoskBackend.check', () => {
  it('points at pipx when the binary is absent', async () => {
    const root = testTmpdir('vosk-check-nobin');
    await withIsolatedEnv(root, async () => {
      const problem = await new VoskBackend('').check();
      const first = (problem ?? '').split('\n')[0] ?? '';
      expect(first).toContain('pipx install vosk-tts');
    });
  });

  it('explains that 0.1 models are incompatible with vosk-tts', async () => {
    const root = testTmpdir('vosk-check-old');
    const bin = fakeBin(root);
    const models = join(root, 'models');
    writeModel(join(models, 'vosk-model-tts-ru-0.1-tamara'), { oldDictionary: true });
    await withIsolatedEnv(root, async () => {
      const b = new VoskBackend(bin);
      b.configure({ command: bin, modelsDir: models, model: 'vosk-model-tts-ru-0.1-tamara' });
      const problem = await b.check();
      expect((problem ?? '').split('\n')[0]).toContain('Vosk model is incompatible');
      expect(problem).toContain('0.4-irina');
    });
  });

  it('asks for a model when the binary exists but no model does', async () => {
    const root = testTmpdir('vosk-check-nomodel');
    const bin = fakeBin(root);
    await withIsolatedEnv(root, async () => {
      const b = new VoskBackend(bin);
      b.configure({ command: bin, modelsDir: join(root, 'models'), model: '' });
      const problem = await b.check();
      expect((problem ?? '').split('\n')[0]).toContain('Vosk model not found');
    });
  });

  it('returns null for a complete model and reports missing files otherwise', async () => {
    const root = testTmpdir('vosk-check-ready');
    const bin = fakeBin(root);
    const models = join(root, 'models');
    const model = writeModel(join(models, 'vosk-model-tts-ru-0.4-irina'));
    await withIsolatedEnv(root, async () => {
      const b = new VoskBackend(bin);
      b.configure({ command: bin, modelsDir: models, model: '' });
      expect(await b.check()).toBeNull();

      fs.rmSync(join(model, 'dictionary'));
      const problem = await b.check();
      expect((problem ?? '').split('\n')[0]).toContain('Vosk model is incomplete');
      expect(problem).toContain('dictionary');
    });
  });
});

describe('VoskBackend.listVoices', () => {
  it('returns concrete model#speaker entries and skips broken models', async () => {
    const root = testTmpdir('vosk-list');
    const models = join(root, 'models');
    writeModel(join(models, 'vosk-model-tts-ru-0.4-irina'), { speakers: 1 });
    writeModel(join(models, 'vosk-model-tts-ru-0.9-multi'), { speakers: 3 });
    writeModel(join(models, 'broken'), { skip: ['model.onnx'] });
    writeModel(join(models, 'vosk-model-tts-ru-0.1-tamara'), { oldDictionary: true });
    await withIsolatedEnv(root, async () => {
      const b = new VoskBackend();
      b.configure({ command: '', modelsDir: models, model: '' });
      const voices = await b.listVoices();
      expect(voices.map((v) => v.id)).toEqual([
        'vosk-model-tts-ru-0.4-irina#0',
        'vosk-model-tts-ru-0.9-multi#0',
        'vosk-model-tts-ru-0.9-multi#1',
        'vosk-model-tts-ru-0.9-multi#2',
      ]);
      expect(voices[1]!.label).toContain('speaker 0');
      expect(voices.some((v) => v.id.startsWith('broken'))).toBe(false);
    });
  });
});

describe('VoskBackend metadata', () => {
  it('advertises Russian-only offline synthesis with rate but no pitch', () => {
    const b = new VoskBackend();
    expect(b.capabilities.languages).toEqual(['ru']);
    expect(b.capabilities.offline).toBe(true);
    expect(b.capabilities.rateControl).toBe(true);
    expect(b.capabilities.pitchControl).toBe(false);
  });

  it('exposes a pipx install hint and the configured default voice', () => {
    const b = new VoskBackend();
    expect(b.installHint().install).toContain('pipx install vosk-tts');
    expect(b.defaultVoice()).toBe('vosk-model-tts-ru-0.4-irina#0');
    b.configure({ command: '', modelsDir: '', model: 'vosk-model-tts-ru-0.4-irina' });
    expect(b.defaultVoice()).toBe('vosk-model-tts-ru-0.4-irina#0');
  });

  it('includes pipx venv paths in the binary candidates', () => {
    const home = process.env.HOME ?? '';
    expect(voskBinCandidates()).toContain(
      join(home, '.local', 'share', 'pipx', 'venvs', 'vosk-tts', 'bin', 'vosk-tts'),
    );
  });
});
