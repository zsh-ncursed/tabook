import type { LineRole } from '../renderer/layout.js';
import type { TtsCapabilities, TtsChunk, TtsVoiceOptions } from './types.js';

/**
 * Источник звука: готовый WAV (Buffer) либо путь к временному файлу.
 * Плеер сам решает, как отдать его в звуковую систему.
 */
export type WavSource = { kind: 'buffer'; buffer: Buffer } | { kind: 'file'; path: string };

/** Обратный вызов при смене состояния плеера (для статус-бара). */
export interface AudioPlayerCallbacks {
  /** Чанк доигрался — менеджер может перейти к следующему. */
  onEnded(): void;
  /** Произошла ошибка воспроизведения. */
  onError(message: string): void;
}

/**
 * Плеер: тонкая обёртка над переносом WAV в звуковую систему
 * (PulseAudio/PipeWire через `aplay`/`paplay`), без сторонних пакетов.
 * Воспроизведение — асинхронное и всегда останавливаемое.
 */
export interface AudioPlayer {
  /** Играет (заменяет текущее) данный источник. */
  play(source: WavSource): void;
  /** Пауза (для потоковых источников, где это возможно) либо запрос позиции. */
  pause(): void;
  /** Возобновить. */
  resume(): void;
  /** Остановить полностью. */
  stop(): void;
  /** Подключить колбэки состояния. */
  onCallbacks(cb: AudioPlayerCallbacks): void;
  /** Освободить ресурсы (убить дочерние процессы). */
  dispose(): void;
}

/**
 * Контракт TTS-бэкенда. Каждый движок (piper, espeak, silero, kokoro, remote)
 * реализует этот интерфейс — единый способ подключения любого языка/движка.
 */
export interface TtsBackend {
  /** Логическое имя, совпадает с `tts.engine` в конфиге. */
  readonly id: string;
  /** Человекочитаемое название для списка движков. */
  readonly label: string;
  readonly capabilities: TtsCapabilities;

  /**
   * Проверить доступность ДО старта (найден ли бинарник/модель, есть ли сеть).
   * Возвращает null, если движок можно использовать, либо текст ошибки.
   */
  check(): Promise<string | null>;

  /**
   * Синтезировать чанк в WAV. Реализация отвечает за локальный движок или
   * облачный API. `voice` — из TtsVoiceOptions.
   */
  synthesize(chunk: TtsChunk, opts: TtsVoiceOptions): Promise<WavSource>;

  /** Роль → желаемая пауза (в секундах) перед этим типом строки. */
  pauseBefore?(role: LineRole | undefined): number;

  /** Освободить ресурсы бэкенда (дочерние процессы). */
  dispose(): void;
}
