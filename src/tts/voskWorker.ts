import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { summarizeEngineStderr } from './stderr.js';

/**
 * Долгоживущий Python-процесс поверх `vosk_tts`: грузит модель один раз и
 * синтезирует чанки по JSON-строкам через stdin/stdout.
 *
 * Зачем worker, а не CLI на каждый чанк:
 *   - загрузка ONNX-графа стоит секунды (0.4) — на каждый абзац это неприемлемо;
 *   - CLI пакета 0.3.61 всегда передаёт в ONNX вход `sid`, которого нет у
 *     моделей 0.1/0.4 → `Invalid input name: sid`. Worker подменяет сессию
 *     прокси, отбрасывающим входы, которых нет у графа.
 *
 * Протокол: одна JSON-строка на запрос/ответ. Служебный stdout занят
 * протоколом, всё остальное (логи, traceback) Python пишет в stderr.
 */

export interface VoskWorkerRequest {
  /** Каталог модели. */
  model: string;
  /** Идентификатор содержимого модели — перезагрузка после переустановки. */
  key: string;
  speaker: number;
  rate: number;
  text: string;
  output: string;
}

export interface VoskWorkerOptions {
  /** Явный путь к Python (иначе — shebang бинарника vosk-tts / pipx-venv). */
  python?: string;
  /** Для тестов: заменить встроенный скрипт worker'а. */
  script?: string;
  /** Таймаут первого запроса к модели (её загрузка может идти минутами). */
  loadTimeoutMs?: number;
  /** Таймаут синтеза после загрузки модели. */
  synthTimeoutMs?: number;
  /** Таймаут ожидания ready после старта процесса. */
  readyTimeoutMs?: number;
}

/** 0.9-multi на слабом CPU грузится ~140 с; запас на медленные диски/машины. */
const LOAD_TIMEOUT_MS = 10 * 60 * 1000;
const SYNTH_TIMEOUT_MS = 2 * 60 * 1000;
const READY_TIMEOUT_MS = 30 * 1000;

const WORKER_PY = String.raw`
import sys, json, traceback

proto = sys.stdout
sys.stdout = sys.stderr


def emit(obj):
    proto.write(json.dumps(obj, ensure_ascii=False) + "\n")
    proto.flush()


from vosk_tts.model import Model
from vosk_tts.synth import Synth


class CompatSession:
    """vosk-tts 0.3.61 подаёт ONNX вход 'sid' всем моделям, но графы 0.1/0.4
    его не принимают. Пропускаем только те входы, что реально есть у модели."""

    def __init__(self, session):
        self._session = session
        self._inputs = {i.name for i in session.get_inputs()}

    def get_inputs(self):
        return self._session.get_inputs()

    def run(self, output_names, input_feed, run_options=None):
        feed = {k: v for k, v in input_feed.items() if k in self._inputs}
        return self._session.run(output_names, feed, run_options)


current_key = None
current_synth = None

emit({"event": "ready"})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req_id = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        key = req.get("key", req["model"])
        if key != current_key:
            model = Model(req["model"])
            model.onnx = CompatSession(model.onnx)
            current_synth = Synth(model)
            current_key = key
        current_synth.synth(
            req["text"],
            req["output"],
            speaker_id=int(req.get("speaker", 0)),
            speech_rate=float(req.get("rate", 1.0)),
        )
        emit({"id": req_id, "ok": True})
    except Exception as e:
        traceback.print_exc()
        emit({"id": req_id, "ok": False, "error": type(e).__name__ + ": " + str(e)})
`;

/**
 * Кандидаты в интерпретатор Python для worker'а. Порядок: явный env-оверрайд,
 * shebang установленного `vosk-tts` (pipx-venv), python из того же каталога,
 * затем python3 из PATH.
 */
export function voskPythonCandidates(bin: string, env = process.env): string[] {
  const out: string[] = [];
  const push = (p: string | null | undefined): void => {
    const value = (p ?? '').trim();
    if (value && !out.includes(value)) out.push(value);
  };
  push(env.VOSK_TTS_PYTHON);
  // `vosk-tts` из PATH — это имя, а не путь: без резолва shebang pipx-venv не
  // прочитать, и worker уйдёт на системный python3 без пакета vosk_tts.
  const resolved = locateExecutable(bin, env);
  push(readShebang(resolved));
  if (resolved) {
    push(join(dirname(resolved), 'python'));
    push(join(dirname(resolved), 'python3'));
  }
  push(env.PYTHON);
  push('python3');
  return out;
}

/** Имя команды → первый исполняемый файл в PATH. */
function locateExecutable(bin: string, env: NodeJS.ProcessEnv): string {
  if (!bin) return '';
  if (bin.includes('/')) return existsSync(bin) ? bin : '';
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

interface Pending {
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class VoskWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;
  private pending = new Map<number, Pending>();
  private loaded = new Set<string>();
  private stderr = '';
  /** Поколение процесса: ответы старого worker'а после dispose игнорируются. */
  private gen = 0;
  private stopped = false;
  private readonly opts: Required<
    Pick<VoskWorkerOptions, 'loadTimeoutMs' | 'synthTimeoutMs' | 'readyTimeoutMs'>
  > &
    Pick<VoskWorkerOptions, 'python' | 'script'>;

  constructor(
    private bin: string,
    opts: VoskWorkerOptions = {},
  ) {
    this.opts = {
      loadTimeoutMs: opts.loadTimeoutMs ?? LOAD_TIMEOUT_MS,
      synthTimeoutMs: opts.synthTimeoutMs ?? SYNTH_TIMEOUT_MS,
      readyTimeoutMs: opts.readyTimeoutMs ?? READY_TIMEOUT_MS,
      python: opts.python,
      script: opts.script,
    };
  }

  /** Синтез одного чанка; запросы выполняются строго по очереди. */
  synthesize(req: VoskWorkerRequest): Promise<void> {
    // Очередь не должна «залипать» на ошибке одного запроса.
    const run = this.queue.then(() => this.request(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    this.gen++;
    this.stopped = true;
    this.loaded.clear();
    this.queue = Promise.resolve();
    this.failAll('Vosk worker stopped');
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill();
  }

  // ---- внутреннее ----

  private async request(req: VoskWorkerRequest): Promise<void> {
    await this.ensureStarted();
    const child = this.child;
    if (!child) throw new Error('Vosk worker is not running');
    const id = ++this.seq;
    const timeout = this.loaded.has(req.key) ? this.opts.synthTimeoutMs : this.opts.loadTimeoutMs;
    const result = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Vosk synthesis timed out after ${Math.round(timeout / 1000)}s`));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
    const line = JSON.stringify({ id, ...req }) + '\n';
    child.stdin.write(line);
    await result;
    this.loaded.add(req.key);
  }

  private ensureStarted(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Vosk worker stopped'));
    if (this.child) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async start(): Promise<void> {
    if (this.stopped) throw new Error('Vosk worker stopped');
    const python = this.opts.python ? [this.opts.python] : voskPythonCandidates(this.bin);
    const script = this.opts.script ?? WORKER_PY;
    let lastError = '';
    for (const candidate of python) {
      try {
        await this.spawnWorker(candidate, script);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(
      'Vosk worker could not start' +
        (lastError ? `: ${lastError}` : ' — Python with the vosk-tts package was not found') +
        '\n\nInstall: pipx install vosk-tts (or set VOSK_TTS_PYTHON).',
    );
  }

  private spawnWorker(python: string, script: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(python, ['-u', '-c', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const gen = ++this.gen;
      this.stderr = '';
      let buffer = '';
      let ready = false;

      const timer = setTimeout(() => {
        if (ready) return;
        cleanup();
        child.kill();
        reject(
          new Error(
            `no ready handshake from "${python}"${this.stderr ? `: ${summarizeEngineStderr(this.stderr)}` : ''}`,
          ),
        );
      }, this.opts.readyTimeoutMs);
      timer.unref?.();

      const cleanup = (): void => {
        clearTimeout(timer);
        child.stdout.removeAllListeners('data');
        child.stderr.removeAllListeners('data');
        child.removeAllListeners('error');
        child.removeAllListeners('close');
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        buffer += data;
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          const msg = parseMessage(line);
          if (!msg) continue;
          if (msg.event === 'ready' && !ready) {
            ready = true;
            clearTimeout(timer);
            if (gen !== this.gen || this.stopped) {
              cleanup();
              child.kill();
              reject(new Error('Vosk worker stopped'));
              return;
            }
            this.child = child;
            this.attachLifecycle(child, gen);
            resolve();
          } else if (typeof msg.id === 'number') {
            this.settle(msg.id, msg);
          }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data: string) => {
        this.stderr = (this.stderr + data).slice(-4096);
      });
      // Смерть worker'а закрывает stdin: без обработчика 'error' на потоке
      // Node валит процесс необработанным исключением.
      child.stdin.on('error', () => undefined);
      child.on('error', (e: NodeJS.ErrnoException) => {
        cleanup();
        this.child = null;
        reject(
          new Error(
            e.code === 'ENOENT'
              ? `Python interpreter not found: ${python}`
              : `${python}: ${e.message}`,
          ),
        );
      });
      child.on('close', (code) => {
        if (this.child === child) this.child = null;
        if (!ready) {
          cleanup();
          reject(
            new Error(
              `"${python}" exited (${code}) before ready${this.stderr ? `: ${summarizeEngineStderr(this.stderr)}` : ''}`,
            ),
          );
        }
      });
    });
  }

  /** После ready: падение процесса не должно оставлять вечные ожидания. */
  private attachLifecycle(child: ChildProcessWithoutNullStreams, gen: number): void {
    child.on('close', () => {
      if (gen !== this.gen) return;
      this.child = null;
      this.loaded.clear();
      this.failAll(
        `Vosk worker exited${this.stderr ? `: ${summarizeEngineStderr(this.stderr)}` : ''}`,
      );
    });
  }

  private settle(id: number, msg: { ok?: unknown; error?: unknown }): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (msg.ok === true) {
      pending.resolve();
      return;
    }
    const error = typeof msg.error === 'string' ? msg.error : 'unknown error';
    pending.reject(new Error(`Vosk synthesis failed: ${error}`));
  }

  private failAll(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

interface WorkerMessage {
  event?: string;
  id?: number;
  ok?: boolean;
  error?: string;
}

function parseMessage(line: string): WorkerMessage | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? (parsed as WorkerMessage) : null;
  } catch {
    return null;
  }
}

/** Первая строка `#!…` исполняемого файла → путь к интерпретатору. */
function readShebang(file: string): string | null {
  if (!file || !existsSync(file)) return null;
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(256);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (n < 3 || buf[0] !== 0x23 || buf[1] !== 0x21) return null;
    const line = buf.subarray(2, n).toString('utf8').split('\n')[0]!.trim();
    if (!line) return null;
    const parts = line.split(/\s+/);
    const exe = parts[0]!;
    if (basename(exe) === 'env') {
      const arg = parts.slice(1).find((p) => !p.startsWith('-'));
      return arg ?? null;
    }
    return exe;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
