/**
 * Voice manager: список голосов, скачивание, проверка установленных.
 * Интегрируется с piper.ts для автоматического использования скачанных голосов.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, formatBytes } from './download.js';
import {
  type PiperVoice,
  checkAndRefresh,
  refreshIndex,
  loadCachedVoices,
  piperVoiceDir,
} from './voiceIndex.js';

export { type PiperVoice } from './voiceIndex.js';

export interface VoiceManagerOptions {
  /** Callback для отображения прогресса скачивания. */
  onProgress?: (msg: string, done?: number, total?: number) => void;
  /** AbortSignal для отмены текущего скачивания. */
  signal?: AbortSignal;
}

export class VoiceManager {
  private onProgress?: VoiceManagerOptions['onProgress'];
  private signal?: AbortSignal;

  constructor(opts: VoiceManagerOptions = {}) {
    this.onProgress = opts.onProgress;
    this.signal = opts.signal;
  }

  /** Загрузить список голосов (с кешем). */
  async getVoices(): Promise<PiperVoice[]> {
    await checkAndRefresh((msg) => this.onProgress?.(msg));
    return loadCachedVoices();
  }

  /**
   * Скачать голос по id (напр. "ru_RU/ivona/ivona-russian-medium").
   * `onBytes` — опциональный колбэк (done, total) для прогресс-бара UI.
   */
  async downloadVoice(
    voiceId: string,
    onBytes?: (done: number, total: number | undefined) => void,
  ): Promise<void> {
    const voices = loadCachedVoices();
    const voice = voices.find((v) => v.id === voiceId);
    if (!voice) throw new Error(`Voice not found: ${voiceId}`);

    const dir = piperVoiceDir();
    const destDir = join(dir, voiceId);
    const destOnnx = join(destDir, voice.file);

    // Уже установлен?
    if (existsSync(destOnnx)) {
      this.onProgress?.(`Already installed: ${voiceId}`);
      return;
    }

    this.onProgress?.(`Downloading ${voiceId} (${formatBytes(0)})…`);

    try {
      await downloadFile({
        url: voice.downloadUrl,
        dest: destOnnx,
        onProgress: (done, total) => {
          onBytes?.(done, total);
          const pct = total ? Math.round((done / total) * 100) : undefined;
          this.onProgress?.(
            `Downloading ${voiceId} (${formatBytes(done)}${total ? ` / ${formatBytes(total)}` : ''}${pct ? ` — ${pct}%` : ''})`,
            done,
            total,
          );
        },
        signal: this.signal,
      });

      this.onProgress?.(`Installed: ${voiceId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to download ${voiceId}: ${msg}`);
    }
  }

  /** Список установленных голосов (проверяет filesystem). */
  installedVoices(): PiperVoice[] {
    const all = loadCachedVoices();
    return all.map((v) => ({
      ...v,
      installed: existsSync(join(piperVoiceDir(), v.id, v.file)),
    }));
  }

  /** Проверить обновления списка голосов. */
  async updateIndex(): Promise<void> {
    await refreshIndex((msg) => this.onProgress?.(msg));
  }
}
