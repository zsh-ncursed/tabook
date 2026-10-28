import { PiperBackend } from './piper.js';
import { EspeakBackend } from './espeak.js';
import { SherpaBackend } from './sherpa.js';
import { TtsManager } from './manager.js';
import type { AudioPlayer, TtsBackend, TtsEnginePaths } from './backend.js';
import type { TtsEngineConfig } from '../config/defaults.js';

export { TtsManager } from './manager.js';
export type { TtsStatusListener, TtsAdvance, TtsManagerOptions } from './manager.js';
export type {
  TtsBackend,
  AudioPlayer,
  WavSource,
  TtsVoiceEntry,
  TtsInstallHint,
  TtsEnginePaths,
} from './backend.js';
export type { TtsChunk, TtsStatus, TtsCapabilities, TtsVoiceOptions } from './types.js';
export { SystemPlayer } from './player.js';
export { buildChunks, isSpeakable, type ChunkSource, type ChunkBuildOptions } from './chunking.js';
export { PiperBackend } from './piper.js';
export { EspeakBackend } from './espeak.js';
export { SherpaBackend } from './sherpa.js';
export { commandAvailable } from './bincheck.js';
export { expandPath, findModelFile, listModelFiles, modelSearchDirs } from './modelPaths.js';

/**
 * Создать TTS-менеджер с бэкендами по умолчанию (piper + sherpa-onnx + espeak).
 * Ничего не скачивает: бэкенды проверяют наличие движка в момент запуска, а
 * выбор движка/голоса делается в `:tts config` или через конфиг.
 *
 * `command` — общий путь к бинарнику движка (`[tts] command`), если его нет в
 * PATH. `engines` — пути к конкретным движкам из `[tts.engines.<id>]`; они
 * приоритетнее общего `command` для своего движка.
 * `interChunkPauseMs` — пауза между чанками (0 = бесшовно через prefetch).
 */
export function createDefaultTtsManager(
  opts: {
    player?: AudioPlayer;
    command?: string;
    engines?: Record<string, TtsEngineConfig>;
    interChunkPauseMs?: number;
  } = {},
) {
  const mgr = new TtsManager({
    player: opts.player,
    interChunkPauseMs: opts.interChunkPauseMs ?? 0,
  });
  const backends: TtsBackend[] = [new PiperBackend(''), new SherpaBackend(''), new EspeakBackend()];
  for (const b of backends) {
    // Бэкенд без configure() просто игнорирует пути — общий `command` тогда
    // не доедет, и он останется на своём автопоиске (так и задумано).
    const paths = resolvePaths(b.id, opts.engines ?? {}, opts.command ?? '');
    if (paths) b.configure?.(paths);
    mgr.register(b);
  }
  return mgr;
}

/**
 * Пути для конкретного движка: сначала его секция `[tts.engines.<id>]`,
 * затем общий `[tts] command` как команда для движков, которые его читают
 * (сейчас это piper). `null`, если для движка ничего не задано.
 */
function resolvePaths(
  id: string,
  engines: Record<string, TtsEngineConfig>,
  fallbackCommand: string,
): TtsEnginePaths | null {
  const own = engines[id];
  if (own && (own.command || own.modelsDir || own.model)) {
    return {
      command: own.command || fallbackCommand,
      modelsDir: own.modelsDir,
      model: own.model,
    };
  }
  if (fallbackCommand) return { command: fallbackCommand, modelsDir: '', model: '' };
  return null;
}
