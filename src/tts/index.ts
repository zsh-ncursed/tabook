import { PiperBackend } from './piper.js';
import { EspeakBackend } from './espeak.js';
import { TtsManager } from './manager.js';
import type { AudioPlayer } from './backend.js';

export { TtsManager } from './manager.js';
export type { TtsStatusListener, TtsAdvance, TtsManagerOptions } from './manager.js';
export type { TtsBackend, AudioPlayer, WavSource } from './backend.js';
export type { TtsChunk, TtsStatus, TtsCapabilities, TtsVoiceOptions } from './types.js';
export { SystemPlayer } from './player.js';
export { buildChunks, isSpeakable, type ChunkSource, type ChunkBuildOptions } from './chunking.js';
export { PiperBackend } from './piper.js';
export { EspeakBackend } from './espeak.js';
export { commandAvailable } from './bincheck.js';

/**
 * Создать TTS-менеджер с бэкендами по умолчанию (piper + espeak fallback).
 * Ничего не скачивает: бэкенды проверяют наличие движка в момент запуска.
 * `command` — полный путь к бинарнику движка ([tts] command), если его нет в PATH.
 */
export function createDefaultTtsManager(opts: {
  player?: AudioPlayer;
  command?: string;
} = {}) {
  const mgr = new TtsManager({ player: opts.player });
  mgr.register(new PiperBackend(opts.command ?? ''));
  mgr.register(new EspeakBackend());
  return mgr;
}
