import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  TtsBackend,
  TtsEnginePaths,
  TtsInstallHint,
  TtsVoiceEntry,
  TtsVoiceInstallProgress,
  WavSource,
} from './backend.js';
import type { TtsChunk, TtsVoiceOptions } from './types.js';
import { commandAvailable, expandPath, modelSearchDirs } from './modelPaths.js';
import { loadVoskCatalog } from './voskIndex.js';
import { installVoskModel, voskModelsDir } from './voskInstall.js';
import { prepareVoskText } from './voskText.js';
import { VoskWorker } from './voskWorker.js';

/** Модель, которую ТЗ (§19.3) закрепляет как дефолтную. */
const RECOMMENDED_MODEL = 'vosk-model-tts-ru-0.4-irina';

/**
 * Бэкенд Vosk TTS (https://github.com/alphacep/vosk-tts): Python + onnxruntime,
 * только русский язык. Модели — zip-архивы с alphacephei.com, каталог
 * `model-list.json`. Движок ставится пользователем (`pipx install vosk-tts`).
 *
 * Синтез идёт через долгоживущий worker (`voskWorker.ts`): CLI пакета 0.3.61
 * грузит модель на каждый запуск и всегда подаёт ONNX-вход `sid`, которого
 * нет у моделей 0.1/0.4. Worker грузит модель один раз и подменяет сессию
 * прокси, отбрасывающим неизвестные графу входы.
 */
export class VoskBackend implements TtsBackend {
  readonly id = 'vosk';
  readonly label = 'Vosk TTS (ONNX, RU)';
  readonly capabilities = {
    languages: ['ru'],
    offline: true,
    rateControl: true,
    pitchControl: false,
  } as const;

  private bin = '';
  private modelsDir = '';
  private model = '';
  private worker: VoskWorker | null = null;
  private workerBin = '';
  /** Предупреждение последнего voiceCatalog(): сеть недоступна, отдан кеш. */
  catalogWarning: string | null = null;

  constructor(command = '') {
    this.bin = command;
  }

  configure(paths: TtsEnginePaths): void {
    if (paths.command) this.bin = paths.command;
    this.modelsDir = paths.modelsDir;
    if (paths.model) this.model = paths.model;
  }

  installHint(): TtsInstallHint {
    return {
      package: 'vosk-tts',
      install: 'sudo pacman -S pipx && pipx install vosk-tts',
      notes:
        'Then download a model: :tts config → Voice ' +
        '(recommended: vosk-model-tts-ru-0.4-irina, ~116 MB)',
    };
  }

  /** Явная модель из конфига; иначе рекомендованная ТЗ 0.4-irina. */
  defaultVoice(): string {
    return `${this.model || RECOMMENDED_MODEL}#0`;
  }

  /** Установленные модели и их спикеры — офлайн, без сети. */
  async listVoices(): Promise<TtsVoiceEntry[]> {
    const out: TtsVoiceEntry[] = [];
    const seen = new Set<string>();
    for (const dir of this.modelDirs()) {
      for (const candidate of modelDirsIn(dir)) {
        const name = basename(candidate);
        if (seen.has(name) || validateVoskModel(candidate) !== null) continue;
        if (!voskDictionaryCompatible(candidate)) continue;
        seen.add(name);
        const speakers = readSpeakerCount(candidate);
        for (let i = 0; i < speakers; i++) {
          out.push({
            id: `${name}#${i}`,
            label: speakers > 1 ? `${name} · speaker ${i}` : name,
            language: 'ru',
            installed: true,
            speakers,
          });
        }
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Онлайн-каталог моделей (alphacephei.com). Установленные локальные модели
   * помечаются `installed`; модели вне каталога (скачанные вручную) остаются
   * в списке, чтобы их можно было выбрать без сети.
   */
  async voiceCatalog(signal?: AbortSignal): Promise<TtsVoiceEntry[]> {
    const local = this.installedModels(await this.listVoices());
    const { models, warning } = await loadVoskCatalog({ signal });
    this.catalogWarning = warning ?? null;
    const seen = new Set<string>();
    const out: TtsVoiceEntry[] = [];
    for (const m of models) {
      seen.add(m.id);
      out.push({
        id: m.id,
        label: m.label,
        language: m.language,
        size: m.size,
        speakers: m.speakers,
        installed: local.has(m.id),
      });
    }
    for (const [id, entry] of local) {
      if (!seen.has(id)) out.push(entry);
    }
    return out.sort((a, b) => {
      if (Boolean(a.installed) !== Boolean(b.installed)) return a.installed ? -1 : 1;
      if ((a.language ?? '') !== (b.language ?? '')) {
        return (a.language ?? '') < (b.language ?? '') ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }

  /** Скачать и установить модель из каталога; возвращает `id#0`. */
  async installVoice(
    voiceId: string,
    onProgress: (p: TtsVoiceInstallProgress) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const id = voiceId.split('#')[0] ?? voiceId;
    const { models } = await loadVoskCatalog({ signal });
    const model = models.find((m) => m.id === id);
    if (!model) throw new Error(`Vosk model "${id}" is not in the current catalog`);
    return installVoskModel({
      id,
      model,
      modelsDir: voskModelsDir(this.modelsDir),
      onProgress,
      signal,
    });
  }

  async check(): Promise<string | null> {
    const bin = this.resolveBin();
    if (!bin) {
      const hint = this.installHint();
      return [
        'vosk-tts not found — install: pipx install vosk-tts',
        '',
        'Install:',
        `  ${hint.install ?? ''}`,
        '',
        `Then download a model: ${hint.notes ?? ':tts config → Voice'}`,
      ].join('\n');
    }
    const dir = this.resolveModelDir(this.model);
    if (!dir) {
      return [
        'Vosk model not found — download it in :tts config → Voice',
        '',
        'Recommended: vosk-model-tts-ru-0.4-irina (~116 MB) in :tts config → Voice.',
        '',
        'Or set the model directory in config.toml:',
        '',
        '  [tts.engines.vosk]',
        '  models_dir = "~/.local/share/vosk"',
        '  model = "vosk-model-tts-ru-0.4-irina"',
      ].join('\n');
    }
    const missing = validateVoskModel(dir);
    if (missing) {
      return [
        `Vosk model is incomplete: ${dir} (missing ${missing})`,
        '',
        'Reinstall the model in :tts config → Voice, or fix [tts.engines.vosk].',
      ].join('\n');
    }
    if (!voskDictionaryCompatible(dir)) {
      return [
        `Vosk model is incompatible: ${dir}`,
        '',
        '0.1 models ship a dictionary without phoneme durations, which vosk-tts',
        'cannot read (ValueError on "!SIL"). Use 0.4-irina or 0.9-multi:',
        ':tts config → Voice.',
      ].join('\n');
    }
    return null;
  }

  async synthesize(chunk: TtsChunk, opts: TtsVoiceOptions): Promise<WavSource> {
    const bin = this.resolveBin();
    if (!bin) {
      throw new Error('vosk-tts binary not found — install: pipx install vosk-tts');
    }
    const { model, speaker } = parseVoskVoice(opts.voice ?? '', this.model);
    const dir = this.resolveModelDir(model);
    if (!dir) {
      throw new Error(
        `Vosk model "${model || '(default)'}" not found — download it in :tts config → Voice`,
      );
    }
    const missing = validateVoskModel(dir);
    if (missing) throw new Error(`Vosk model is incomplete: ${dir} (missing ${missing})`);
    if (!voskDictionaryCompatible(dir)) {
      throw new Error(
        `Vosk model is incompatible: ${dir} (0.1 dictionary has no phoneme durations; use 0.4-irina or 0.9-multi)`,
      );
    }
    // Верхняя граница иначе уронит ONNX-сессию; нижнюю уже отсекает парсер.
    const speakerId = Math.min(speaker, readSpeakerCount(dir) - 1);
    // G2P Vosk падает KeyError на латинице, цифрах и типографских кавычках.
    const text = prepareVoskText(chunk.text);
    if (!text) throw new Error('Vosk: chunk has no Russian text to synthesize');
    const out = join(tmpdir(), `tabook-vosk-${process.pid}-${rand()}.wav`);
    await this.getWorker(bin).synthesize({
      model: dir,
      key: modelKey(dir),
      speaker: speakerId,
      rate: clampRate(opts.rate ?? 1),
      text,
      output: out,
    });
    return { kind: 'file', path: out };
  }

  dispose(): void {
    this.worker?.dispose();
    this.worker = null;
  }

  // ---- внутреннее ----

  private getWorker(bin: string): VoskWorker {
    if (this.worker && this.workerBin !== bin) {
      this.worker.dispose();
      this.worker = null;
    }
    this.workerBin = bin;
    this.worker ??= new VoskWorker(bin);
    return this.worker;
  }

  /** Установленные модели по id (без спикеров) — для каталога. */
  private installedModels(voices: TtsVoiceEntry[]): Map<string, TtsVoiceEntry> {
    const map = new Map<string, TtsVoiceEntry>();
    for (const v of voices) {
      const id = v.id.split('#')[0] ?? v.id;
      if (map.has(id)) continue;
      map.set(id, { ...v, id, label: id, installed: true });
    }
    return map;
  }

  private resolveBin(): string {
    const explicit = expandPath(this.bin);
    if (explicit && existsSync(explicit)) return explicit;
    const fromEnv = expandPath(
      process.env.VOSK_TTS_COMMAND ?? process.env.TABOOK_TTS_COMMAND ?? '',
    );
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    if (commandAvailable('vosk-tts')) return 'vosk-tts';
    for (const c of voskBinCandidates()) {
      if (existsSync(c)) return c;
    }
    return '';
  }

  private modelDirs(): string[] {
    return modelSearchDirs({
      modelsDir: this.modelsDir,
      envVars: ['VOSK_MODEL_PATH'],
      standardDirs: standardModelDirs(),
    });
  }

  /** Каталог модели: явный путь/id, иначе первая валидная установленная. */
  private resolveModelDir(wanted: string): string | null {
    const dirs = this.modelDirs();
    const raw = expandPath(wanted);
    if (raw) {
      if (existsSync(raw) && statSync(raw).isDirectory()) return resolve(raw);
      for (const d of dirs) {
        // VOSK_MODEL_PATH иногда указывает прямо на каталог модели.
        if (basename(d) === raw) return d;
        const direct = join(d, raw);
        if (existsSync(direct) && statSync(direct).isDirectory()) return direct;
        for (const sub of safeReaddir(d)) {
          if (sub.isDirectory() && sub.name === raw) return join(d, sub.name);
        }
      }
      return null;
    }
    // Сначала ищем валидную модель; если таких нет, но есть каталог с
    // model.onnx (недокачанная/битая модель), возвращаем его — check()
    // сообщит, какого файла не хватает, вместо общего «model not found».
    let incomplete: string | null = null;
    for (const d of dirs) {
      for (const candidate of modelDirsIn(d)) {
        if (validateVoskModel(candidate) === null && voskDictionaryCompatible(candidate)) {
          return candidate;
        }
        if (!incomplete && existsSync(join(candidate, 'model.onnx'))) incomplete = candidate;
      }
    }
    return incomplete;
  }
}

/** Каталоги моделей Vosk по умолчанию (плюс models_dir и VOSK_MODEL_PATH). */
function standardModelDirs(): string[] {
  const home = process.env.HOME ?? homedir();
  return [
    join(home, '.local', 'share', 'vosk'),
    join(home, '.local', 'share', 'tabook', 'vosk'),
    join(home, '.cache', 'vosk'),
    join(home, 'vosk-models'),
  ];
}

/**
 * Кандидаты на бинарник vosk-tts: pipx-venv, ~/.local/bin и venv рядом с
 * tabook (dev-окружения). Экспортировано для тестов.
 */
export function voskBinCandidates(): string[] {
  const home = process.env.HOME ?? '';
  const out: string[] = [];
  const push = (p: string): void => {
    if (p) out.push(p);
  };
  push(join(home, '.local', 'bin', 'vosk-tts'));
  // pipx: актуальный XDG-путь и старый ~/.local/pipx.
  push(join(home, '.local', 'share', 'pipx', 'venvs', 'vosk-tts', 'bin', 'vosk-tts'));
  push(join(home, '.local', 'pipx', 'venvs', 'vosk-tts', 'bin', 'vosk-tts'));
  const start = process.argv[1] ? resolve(process.argv[1]) : resolve(process.cwd());
  let dir: string | null = dirname(start);
  for (let i = 0; i < 6 && dir; i++) {
    push(join(dir, '.tts-venv', 'bin', 'vosk-tts'));
    push(join(dir, 'venv', 'bin', 'vosk-tts'));
    const parent = dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return out;
}

/** `model#speaker` → { model, speaker }. Без `#` — спикер 0. */
export function parseVoskVoice(
  voice: string,
  fallbackModel: string,
): { model: string; speaker: number } {
  const hash = voice.indexOf('#');
  const model = (hash >= 0 ? voice.slice(0, hash) : voice).trim() || fallbackModel;
  let speaker = hash >= 0 ? Number.parseInt(voice.slice(hash + 1), 10) : 0;
  if (!Number.isFinite(speaker) || speaker < 0) speaker = 0;
  return { model, speaker };
}

/** Число спикеров из config.json; fallback по имени каталога. */
export function readSpeakerCount(modelDir: string): number {
  const cfg = readVoskConfig(modelDir);
  const candidates = [
    cfg?.['num_speakers'],
    cfg?.['n_speakers'],
    nested(cfg, 'data', 'n_speakers'),
    nested(cfg, 'model', 'n_speakers'),
    Array.isArray(cfg?.['speaker_id_map']) ? cfg['speaker_id_map'].length : undefined,
  ];
  for (const value of candidates) {
    const n = typeof value === 'number' ? value : Number.NaN;
    if (Number.isFinite(n) && n >= 1) return clampSpeakerCount(n);
  }
  return basename(modelDir).includes('-multi') ? 5 : 1;
}

/**
 * Проверить раскладку модели. Возвращает имя отсутствующего файла или null.
 * `bert/` обязателен только для `model_type: multistream_*` (0.9-multi).
 */
export function validateVoskModel(modelDir: string): string | null {
  for (const file of ['model.onnx', 'config.json', 'dictionary']) {
    if (!existsSync(join(modelDir, file))) return file;
  }
  const cfg = readVoskConfig(modelDir);
  const type = typeof cfg?.['model_type'] === 'string' ? cfg['model_type'] : '';
  if (type.startsWith('multistream_')) {
    if (!existsSync(join(modelDir, 'bert', 'model.onnx'))) return 'bert/model.onnx';
    if (!existsSync(join(modelDir, 'bert', 'vocab.txt'))) return 'bert/vocab.txt';
  }
  return null;
}

/**
 * Словарь 0.1-моделей хранит фонемы без длительностей (`!SIL SIL`), а
 * vosk-tts 0.3.61 ждёт три колонки (`!SIL 1 SIL`) и падает ValueError.
 */
export function voskDictionaryCompatible(modelDir: string): boolean {
  try {
    const text = readFileSync(join(modelDir, 'dictionary'), 'utf8');
    const line = text.split('\n').find((l) => l.trim());
    if (!line) return false;
    const cols = line.trim().split(/\s+/);
    return cols.length >= 3 && Number.isFinite(Number(cols[1]));
  } catch {
    return false;
  }
}

/** Идентификатор содержимого модели: переустановка меняет mtime/size. */
function modelKey(dir: string): string {
  try {
    const st = statSync(join(dir, 'model.onnx'));
    return `${dir}:${st.size}:${st.mtimeMs}`;
  } catch {
    return dir;
  }
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(4, Math.max(0.25, rate));
}

function clampSpeakerCount(n: number): number {
  return Math.min(20, Math.max(1, Math.floor(n)));
}

function readVoskConfig(modelDir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(modelDir, 'config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function nested(cfg: Record<string, unknown> | null, a: string, b: string): unknown {
  const inner = cfg?.[a];
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>)[b] : undefined;
}

function safeReaddir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Подкаталоги-модели в каталоге + сам каталог (валидность проверяет вызывающий). */
function modelDirsIn(dir: string): string[] {
  const out = [dir];
  for (const entry of safeReaddir(dir)) {
    if (!entry.isDirectory()) continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

function rand(): string {
  return Math.random().toString(36).slice(2);
}

/** Для тестов/отладки: валидный ли каталог и сколько спикеров. */
export function inspectVoskModel(modelDir: string): {
  valid: boolean;
  missing: string | null;
  speakers: number;
} {
  const missing = validateVoskModel(modelDir);
  return { valid: missing === null, missing, speakers: readSpeakerCount(modelDir) };
}
