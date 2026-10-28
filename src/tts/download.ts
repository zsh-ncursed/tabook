/**
 * Скачивание файла (Piper .onnx voice) со стрим-прогрессом.
 * Использует нативный fetch + File System WriteStream — без тяжёлых библиотек.
 */

import { createWriteStream, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export interface DownloadOptions {
  /** Куда сохранить. */
  dest: string;
  /** URL для скачивания. */
  url: string;
  /** Размер файла в байтах (для прогресса в %). */
  expectedSize?: number;
  /** Вызывается по мере скачивания: (bytesDone, totalBytes) => void */
  onProgress?: (done: number, total: number | undefined) => void;
  /** Прерываемый AbortSignal (напр. при отмене). */
  signal?: AbortSignal;
  /** Таймаут в мс (по умолчанию 5 минут). */
  timeoutMs?: number;
}

export interface DownloadResult {
  path: string;
  size: number;
}

/**
 * Скачать файл стримом. Показывает прогресс через onProgress.
 * При ошибке partial-файл удаляется.
 */
export async function downloadFile(opts: DownloadOptions): Promise<DownloadResult> {
  const { dest, url, expectedSize, onProgress, signal, timeoutMs = 5 * 60 * 1000 } = opts;

  // Создать директорию назначения
  mkdirSync(dirname(dest), { recursive: true });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  let totalBytes = expectedSize ?? 0;
  let doneBytes = 0;

  try {
    const res = await fetch(url, {
      signal: combinedSignal,
      headers: { Accept: 'application/octet-stream' },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }

    // Content-Length может отсутствовать при chunked encoding
    const contentLength = res.headers.get('content-length');
    if (contentLength) totalBytes = parseInt(contentLength, 10);

    if (!res.body) throw new Error('No response body');

    // pipeline (а не ручной цикл write/destroy) сам уничтожает поток при
    // отмене и доводит 'error' до промиса: ручной destroy() ронял процесс
    // с ERR_STREAM_DESTROYED, если запись уже была в полёте.
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        doneBytes += chunk.length;
        onProgress?.(doneBytes, totalBytes || undefined);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
      counter,
      createWriteStream(dest),
    );

    return { path: dest, size: doneBytes };
  } catch (err) {
    // Удалить partial file
    try {
      unlinkSync(dest);
    } catch {
      // ignore
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Download cancelled');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Форматировать байты в человекочитаемую строку. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
