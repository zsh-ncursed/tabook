import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { TtsBackend, WavSource } from './backend.js';
import type { TtsChunk, TtsVoiceOptions } from './types.js';
import { commandAvailable } from './bincheck.js';
import { downloadFile } from './download.js';
import { HF_RESOLVE } from './hf.js';

/**
 * Бэкенд Piper (https://github.com/rhasspy/piper).
 * Ожидает установленный `piper`/`piper-speak` в PATH и голос `.onnx` на диске.
 * Ничего не скачивает сам — только вызывает локальный движок.
 *
 * Установка (вне tabook): `pipx install piper-tts`, голоса — на HF
 * (rhasspy/piper-voices), русский, напр. `ru_RU-irina-medium`.
 */
export class PiperBackend implements TtsBackend {
  readonly id = 'piper';
  readonly label = 'Piper (local neural voices)';
  readonly capabilities = {
    languages: ['ru', 'en', 'de', 'es', 'fr', 'it', 'pl', 'pt', 'uk', 'sv', ...MORE_LANGS],
    offline: true,
    rateControl: false,
    // Piper не умеет менять pitch через CLI — только length_scale (rate).
    pitchControl: false,
  } as const;

  private bin: string;
  constructor(command = '') {
    this.bin = command;
  }

  async check(): Promise<string | null> {
    if (!this.bin && !commandAvailable('piper') && !commandAvailable('piper-speak')) {
      return [
        'piper not found — TTS engine not installed.',
        '',
        'Install piper-tts:',
        '  AUR:  yay -S piper-tts',
        '  pipx: pipx install piper-tts',
        '',
        'Then download a voice: :tts config → Voice → pick one (e.g. ru_RU-irina-medium)',
      ].join('\n');
    }
    return null;
  }

  async synthesize(chunk: TtsChunk, opts: TtsVoiceOptions): Promise<WavSource> {
    const voice = opts.voice ?? 'ru_RU-irina-medium';
    const out = join(
      tmpdir(),
      `tabook-piper-${process.pid}-${Math.random().toString(36).slice(2)}.wav`,
    );
    const rate =
      opts.rate && opts.rate !== 1 ? [`--length_scale=${(1 / opts.rate).toFixed(2)}`] : [];
    const model = await ensureOnnx(voice);
    const bin = resolvePiperBin(this.bin);
    await pipeTextToWav(bin, model, rate, sanitizeTtsText(chunk.text), out);
    return { kind: 'file', path: out };
  }

  dispose(): void {
    /* piper — разовый процесс на синтез, свободных ресурсов нет */
  }
}

// Дополнительные языки (полный список piper-голосов большой; этих достаточно для
// «любых языков» по умолчанию, остальные добавляются самим пользователем).
const MORE_LANGS = [
  'ar',
  'ca',
  'cs',
  'cy',
  'da',
  'el',
  'eo',
  'et',
  'fi',
  'hu',
  'is',
  'ka',
  'lb',
  'lt',
  'lv',
  'mt',
  'nl',
  'no',
  'ro',
  'sk',
  'sl',
  'sr',
  'sw',
  'vi',
];

/**
 * Очистить текст перед подачей в piper. Контрольные символы (особенно NUL)
 * роняют piper-фонематизатор с Python traceback; вырезаем всё, что не
 * печатаемое, оставляя перевод строки и табуляцию.
 */
export function sanitizeTtsText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
}

/** Какой бинарник запускать: явный [tts] command, иначе piper/piper-speak из PATH. */
function resolvePiperBin(command: string): string {
  if (command) return command;
  if (process.env.TABOOK_TTS_COMMAND) return process.env.TABOOK_TTS_COMMAND;
  if (commandAvailable('piper')) return 'piper';
  if (commandAvailable('piper-speak')) return 'piper-speak';
  // Автообнаружение в типичных местах установки piper-tts (pipx/pip venv),
  // чтобы не требовать ручной настройки.
  for (const candidate of autoPiperCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  // Ничего нет — отдаём 'piper'; spawn выведет понятную ошибку ENOENT,
  // которую менеджер покажет пользователю.
  return 'piper';
}

/**
 * Список путей-кандидатов для автопоиска бинаря piper. Экспортирован для
 * тестов (проверяем, что актуальные места установки не потеряны).
 */
export function piperBinCandidates(): string[] {
  return autoPiperCandidates();
}

/** Типичные пути, куда pipx/pip ставит piper-tts. */
function autoPiperCandidates(): string[] {
  const home = process.env.HOME ?? '';
  const out: string[] = [];
  const push = (p: string): void => {
    if (p) out.push(p);
  };
  push(join(home, '.local', 'bin', 'piper'));
  // pipx venv: XDG-путь ~/.local/share/pipx/venvs (актуальный) и старый
  // ~/.local/pipx/venvs (встречался в ранних pipx). Симлинк в ~/.local/bin
  // часто отваливается после обновления Python — venv надо искать сам.
  push(join(home, '.local', 'share', 'pipx', 'venvs', 'piper-tts', 'bin', 'piper'));
  push(join(home, '.local', 'pipx', 'venvs', 'piper-tts', 'bin', 'piper'));
  // Standalone-распаковка из архива rhasspy/piper releases (piper_linux_x86_64.tar.gz):
  // внутри — piper/piper; Readme советует симлинк в ~/.local/bin, кладём на случай,
  // если его не сделали.
  push(join(home, '.local', 'share', 'piper-tts', 'piper', 'piper'));
  push(join(home, '.venv', 'bin', 'piper'));
  push(join(home, '.tts-venv', 'bin', 'piper'));
  // venv рядом с табуком (dev/тестовые окружения): поднимаемся от запускаемого
  // файла к корню пакета и ищем .tts-venv/bin/piper на каждом уровне.
  const start = process.argv[1] ? resolve(process.argv[1]) : resolve(process.cwd());
  let dir: string | null = dirname(start);
  for (let i = 0; i < 6 && dir; i++) {
    push(join(dir, '.tts-venv', 'bin', 'piper'));
    push(join(dir, 'venv', 'bin', 'piper'));
    const parent = dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return out;
}

/** Гарантировать, что имя голоса TTS — это путь к .onnx + рядом лежит конфиг. */
async function ensureOnnx(voice: string): Promise<string> {
  // Явный путь к существующему .onnx — как есть.
  if (voice.endsWith('.onnx')) {
    const p = resolve(voice);
    if (existsSync(p)) {
      await ensureConfigNextToModel(p);
      return p;
    }
  }
  // Короткое имя голоса (напр. 'ru_RU-irina-medium') — ищем .onnx в известных
  // каталогах с моделями piper.
  const base = voice.endsWith('.onnx') ? voice : `${voice}.onnx`;
  const hit = findModel(base);
  if (hit) {
    await ensureConfigNextToModel(hit);
    return hit;
  }
  // Ничего не нашли — отдаём как есть; piper выведет понятную ошибку.
  return base;
}

/**
 * Piper требует рядом с моделью её конфиг <model>.onnx.json, иначе падает с
 * FileNotFoundError. Голоса, скачанные старой версией tabook, конфига не имеют
 * — докачиваем его автоматически (это 5 КБ, не 60 МБ модели).
 */
async function ensureConfigNextToModel(modelPath: string): Promise<void> {
  const cfgPath = `${modelPath}.json`;
  if (existsSync(cfgPath)) return;
  const rel = relative(piperVoiceRoot(), modelPath);
  if (!rel) return; // модель вне каталога голосов — URL не вычислить
  const url = `${HF_RESOLVE}/${rel}.json`;
  try {
    await downloadFile({ url, dest: cfgPath });
  } catch {
    // Не получилось скачать конфиг — piper скажет, чего не хватает; лучше
    // понятная ошибка, чем тихая поломка.
  }
}

/** Корень каталога голосов piper (от него вычисляем путь для HF URL). */
function piperVoiceRoot(): string {
  return process.env.PIPER_MODELS_DIR ?? join(homedir(), '.local', 'share', 'piper', 'voices');
}

/** Каталоги, где piper-голоса обычно лежат (плюс piper --data-dir по умолчанию). */
function modelDirs(): string[] {
  const home = process.env.HOME ?? '~';
  const dirs = [
    join(home, '.local/share/piper'),
    join(home, '.local/share/piper/voices'),
    join(home, '.config/piper'),
    join(home, 'piper-voices'),
    join(home, 'tts-models'),
    join(home, '.local/share/piper/models'),
  ];
  if (process.env.PIPER_MODELS_DIR) dirs.unshift(process.env.PIPER_MODELS_DIR);
  // Модели рядом с найденным бинарем или корнем пакета (dev/тестовые окружения).
  const bin = resolvePiperBin('');
  if (bin.includes('/')) {
    const binDir = dirname(resolve(bin));
    dirs.unshift(join(binDir, '..', 'models'), join(binDir, '..', '.tts-models'));
  }
  const start = process.argv[1] ? resolve(process.argv[1]) : resolve(process.cwd());
  let dir: string | null = dirname(start);
  for (let i = 0; i < 6 && dir; i++) {
    dirs.unshift(join(dir, '.tts-models'), join(dir, 'tts-models'));
    const parent = dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return dirs.filter((d) => existsSync(d));
}

/** Рекурсивно найти голос по имени в каталогах моделей (глубина 4). */
function findModel(base: string, dir?: string, depth = 4): string | null {
  const dirs = dir === undefined ? modelDirs() : [dir];
  for (const d of dirs) {
    const direct = join(d, base);
    if (existsSync(direct)) return direct;
    if (depth > 0) {
      for (const sub of readdirSync(d, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          const hit = findModel(base, join(d, sub.name), depth - 1);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

/**
 * Сжать stderr дочернего процесса до одной человекочитаемой строки.
 *
 * Piper сыпет в stderr ANSI-раскрашенные warning'и onnxruntime и полный
 * Python-traceback. В терминале tabook (raw mode, TUI) многострочный вывод с
 * escape-последовательностями разрывает экран и оставляет артефакты поверх
 * текста книги. Поэтому: вырезаем ANSI, выбрасываем служебные строки логов и
 * берём последнюю значимую строку — обычно это строка исключения.
 */
export function summarizeStderr(raw: string): string {
  const noAnsi = raw.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = noAnsi
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // Служебный шум, который piper/onnxruntime сыплют в stderr: телеметрия
    // (всегда с временной меткой), обвязка Python-traceback и скобки.
    .filter(
      (l) =>
        !/\d{4}-\d{2}-\d{2}|onnxruntime|telemetry|^Traceback|^ {2}File |^\s*~+|^sys\.exit|\{$|\}$/i.test(
          l,
        ),
    );
  // Последняя значимая строка трейсбека — само исключение (ValueError: ...).
  // Если после фильтра ничего не осталось (чистый шум) — пустая строка.
  return (lines[lines.length - 1] ?? '').slice(0, 200);
}

/** Прогнать piper: текст в stdin -> wav-файл; резолвится по завершении. */
function pipeTextToWav(
  bin: string,
  model: string,
  extraArgs: string[],
  text: string,
  out: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['--model', model, '--output_file', out, ...extraArgs], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-1024);
    });
    child.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            `piper binary not found: "${bin}". Install: yay -S piper-tts (AUR) or pipx install piper-tts`,
          ),
        );
        return;
      }
      reject(e);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`piper failed (${code}): ${summarizeStderr(err)}`));
        return;
      }
      resolve();
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}
