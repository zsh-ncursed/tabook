import type { LineRole } from '../renderer/layout.js';

/**
 * Один синтезируемый фрагмент книги вместе с его положением в тексте.
 * Позиции даны в «книжных» координатах charOffset (глобальный счётчик
 * символов книги, как в ReaderSession/layout), чтобы звук и текст были
 * синхронизированы и корректно работали навигация/прогресс.
 */
export interface TtsChunk {
  /** Чистый текст фрагмента (без стилей/разметки), уходящий в синтезатор. */
  text: string;
  /** Позиция начала фрагмента в координатах книги (charOffset). */
  startChar: number;
  /** Смысловая роль блока/строки — позволяет делать паузы/акценты. */
  role?: LineRole;
}

/** Состояние воспроизведения — источник истины для статус-бара. */
export type TtsStatus =
  | { state: 'idle' }
  | { state: 'playing'; currentChar: number; chunkIndex: number; total: number }
  | { state: 'paused'; currentChar: number }
  | { state: 'error'; message: string };

/** Возможности бэкенда — что он умеет (для списка и проверки совместимости). */
export interface TtsCapabilities {
  /** Коды языков BCP-47, поддержанные бэкендом (например 'ru', 'en'). */
  languages: readonly string[];
  /** Работает без сети? */
  offline: boolean;
  /** Умеет ли менять скорость на лету (для будущих версий). */
  rateControl: boolean;
}

/** Опции синтеза голосом. */
export interface TtsVoiceOptions {
  /** Идентификатор голоса внутри бэкенда (например 'ru_RU-irina-medium'). */
  voice?: string;
  /** Скорость воспроизведения (1.0 — норма). */
  rate?: number;
  /** Необязательный объект конфигурации провайдера (для облачных бэкендов). */
  provider?: Record<string, unknown>;
}
