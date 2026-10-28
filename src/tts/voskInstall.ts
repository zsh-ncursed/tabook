import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  downloadFile,
  formatBytes,
  type DownloadOptions,
  type DownloadResult,
} from './download.js';
import { commandAvailable, expandPath } from './modelPaths.js';
import { validateVoskModel } from './vosk.js';
import type { TtsVoiceInstallProgress } from './backend.js';
import type { VoskCatalogModel } from './voskIndex.js';

/**
 * Установка TTS-модели Vosk из zip-архива.
 *
 * Порядок: скачать во временный `.zip.part` → сверить md5 потоком →
 * распаковать во временный каталог → проверить раскладку модели → атомарно
 * переименовать в `<models_dir>/<id>`. Финальный каталог появляется только
 * после валидации; при любой ошибке/отмене временные файлы удаляются, а
 * ранее установленная модель остаётся нетронутой.
 */

export interface InstallVoskModelOptions {
  id: string;
  model: VoskCatalogModel;
  modelsDir: string;
  onProgress: (p: TtsVoiceInstallProgress) => void;
  signal?: AbortSignal;
  /** Подмена скачивания (тесты). */
  download?: (opts: DownloadOptions) => Promise<DownloadResult>;
  /** Подмена распаковки (тесты). */
  extract?: (zip: string, dest: string, signal?: AbortSignal) => Promise<void>;
}

/** Каталог моделей Vosk: `models_dir` из конфига либо ~/.local/share/vosk. */
export function voskModelsDir(configured = ''): string {
  const expanded = expandPath(configured);
  return expanded ? resolve(expanded) : join(homedir(), '.local', 'share', 'vosk');
}

/** Установить модель; возвращает значение для `tts.voice` (`id#0`). */
export async function installVoskModel(opts: InstallVoskModelOptions): Promise<string> {
  const { id, model, modelsDir, onProgress, signal } = opts;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Invalid Vosk model id: ${id}`);

  const dest = join(modelsDir, id);
  if (validateVoskModel(dest) === null) {
    onProgress({ phase: 'validate', message: `Already installed: ${id}` });
    return `${id}#0`;
  }

  mkdirSync(modelsDir, { recursive: true });
  ensureDiskSpace(modelsDir, (model.size ?? 0) + 100 * 1024 * 1024);

  const zip = join(modelsDir, `.${id}.zip.part`);
  const tmp = join(modelsDir, `.tmp-${id}-${process.pid}-${rand()}`);
  try {
    throwIfAborted(signal);
    onProgress({ phase: 'download', done: 0, total: model.size });
    const download = opts.download ?? downloadFile;
    await download({
      url: model.url,
      dest: zip,
      expectedSize: model.size,
      signal,
      timeoutMs: 60 * 60 * 1000,
      onProgress: (done, total) =>
        onProgress({ phase: 'download', done, total: total ?? model.size }),
    });

    throwIfAborted(signal);
    onProgress({ phase: 'verify' });
    if (model.md5) {
      const actual = await md5File(zip, signal);
      if (actual !== model.md5) {
        throw new Error(
          `Vosk model checksum mismatch for ${id}: expected ${model.md5}, got ${actual}`,
        );
      }
    }

    throwIfAborted(signal);
    mkdirSync(tmp, { recursive: true });
    onProgress({ phase: 'extract' });
    await (opts.extract ?? extractZip)(zip, tmp, signal);

    throwIfAborted(signal);
    const extracted = findExtractedModel(tmp, id);
    onProgress({ phase: 'validate' });
    const missing = validateVoskModel(extracted);
    if (missing) {
      throw new Error(`Downloaded Vosk model ${id} is invalid (missing ${missing})`);
    }

    throwIfAborted(signal);
    const old = join(modelsDir, `.old-${id}-${rand()}`);
    const hadOld = existsSync(dest);
    if (hadOld) renameSync(dest, old);
    try {
      renameSync(extracted, dest);
    } catch (err) {
      // Не оставить пользователя без ранее работавшей модели.
      if (hadOld && existsSync(old) && !existsSync(dest)) renameSync(old, dest);
      throw err;
    }
    rmrf(old);
    onProgress({ phase: 'validate', message: `Installed: ${id}` });
    return `${id}#0`;
  } finally {
    // На успехе zip уже не нужен; на ошибке/отмене — тоже (повтор скачает заново).
    rmrf(zip);
    rmrf(tmp);
  }
}

/** Потоковый md5 файла (модели весят сотни мегабайт — в память не читаем). */
export function md5File(path: string, signal?: AbortSignal): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash('md5');
    const stream = createReadStream(path);
    const onAbort = (): void => {
      stream.destroy(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = (err: Error | null, value?: string): void => {
      signal?.removeEventListener('abort', onAbort);
      if (err) rej(err);
      else res(value ?? '');
    };
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (err) => done(err));
    stream.on('end', () => done(null, hash.digest('hex')));
  });
}

/**
 * Распаковать zip: `bsdtar` (libarchive есть в базовом Arch), иначе `unzip`.
 * Ни один не найден — ошибка с подсказкой, а не «тихая» пустая установка.
 */
export async function extractZip(zip: string, dest: string, signal?: AbortSignal): Promise<void> {
  const tools: string[][] = [];
  if (commandAvailable('bsdtar')) tools.push(['bsdtar', '-xf', zip, '-C', dest]);
  if (commandAvailable('unzip')) tools.push(['unzip', '-q', zip, '-d', dest]);
  if (tools.length === 0) {
    throw new Error('Cannot extract Vosk model: install libarchive (bsdtar) or unzip');
  }
  let last: unknown = null;
  for (const [bin, ...args] of tools) {
    try {
      await runCommand(bin!, args, signal);
      return;
    } catch (err) {
      if (isAbort(err)) throw err;
      last = err;
    }
  }
  const reason = last instanceof Error ? last.message : String(last);
  throw new Error(`Failed to extract Vosk model: ${reason}`);
}

/** Проверить свободное место (statfs); если недоступен — пропустить проверку. */
function ensureDiskSpace(dir: string, needed: number): void {
  try {
    const fs = statfsSync(dir);
    const available = Number(fs.bavail) * Number(fs.bsize);
    if (available > 0 && available < needed) {
      throw new Error(
        `Not enough disk space for Vosk model: need ${formatBytes(needed)}, available ${formatBytes(available)}`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Not enough disk space')) throw err;
    // statfs недоступен на платформе — установку не блокируем.
  }
}

/** Найти каталог модели внутри распакованного tmp. */
function findExtractedModel(tmp: string, id: string): string {
  const direct = join(tmp, id);
  if (isDir(direct)) return direct;
  if (validateVoskModel(tmp) === null) return tmp;
  const dirs = safeReaddir(tmp).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  if (dirs.length === 1) return join(tmp, dirs[0]!.name);
  throw new Error(
    `Unexpected archive layout for ${id}: expected directory "${id}" or a single top-level directory`,
  );
}

function runCommand(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-1024);
    });
    child.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort);
      rej(e);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        rej(abortError());
        return;
      }
      if (code !== 0) {
        rej(new Error(`${bin} exited with ${code}${err ? `: ${err.trim()}` : ''}`));
        return;
      }
      res();
    });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const err = new Error('Download cancelled');
  err.name = 'AbortError';
  return err;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function rmrf(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Уборка не должна затенять исходную ошибку установки.
  }
}

function rand(): string {
  return Math.random().toString(36).slice(2);
}
