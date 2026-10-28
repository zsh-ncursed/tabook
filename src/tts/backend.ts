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
 * Пользовательские пути к движку и его голосам — из секции
 * `[tts.engines.<id>]` конфига. Позволяют указать движок, установленный не в
 * PATH (venv, ручная распаковка, AUR-пакет с нестандартным префиксом).
 */
export interface TtsEnginePaths {
  /** Полный путь к бинарнику движка (пусто = автопоиск). */
  command: string;
  /** Каталог с голосами/моделями (пусто = стандартные места). */
  modelsDir: string;
  /** Явный голос/модель по умолчанию (пусто = дефолт бэкенда). */
  model: string;
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
 * Один голос/модель, найденный на диске или в онлайн-каталоге (для списка в
 * модалке настроек). Бэкенды без `listVoices()`/`voiceCatalog()` (espeak)
 * просто не показывают голоса — там голос задаётся кодом языка.
 */
export interface TtsVoiceEntry {
  /** Идентификатор для `TtsVoiceOptions.voice` (напр. путь к .onnx или имя). */
  id: string;
  /** Человекочитаемое имя для списка. */
  label: string;
  /** Язык, если бэкенд его знает (для группировки/подсказки). */
  language?: string;
  /**
   * Установлен ли голос/модель. Для `listVoices()` по умолчанию true
   * (голос найден на диске), для каталога вычисляется бэкендом.
   */
  installed?: boolean;
  /** Размер архива/файла в байтах (для каталога). */
  size?: number;
  /** Число спикеров; > 1 включает пикер спикера. */
  speakers?: number;
  /**
   * Значение для `tts.voice`, если пикер спикера не нужен.
   * По умолчанию равен id (piper: basename .onnx без расширения).
   */
  configVoice?: string;
}

/** Этап установки голоса — для прогресса в футере пикера. */
export type TtsVoiceInstallPhase = 'download' | 'verify' | 'extract' | 'validate';

/** Прогресс установки голоса/модели. */
export interface TtsVoiceInstallProgress {
  phase: TtsVoiceInstallPhase;
  /** Для phase='download' — байты. */
  done?: number;
  total?: number;
  /** Готовая строка для футера (необязательно). */
  message?: string;
}

/**
 * Как установить движок, если его нет в системе. Показывается рядом с
 * недоступным движком, чтобы пользователю не искать пакет самому.
 */
export interface TtsInstallHint {
  /** Имя пакета в AUR/репозиториях (Arch: `yay -S <name>`). */
  package?: string;
  /** Команда установки, если отличается от `yay -S <package>`. */
  install?: string;
  /** Дополнительные шаги после установки (напр. скачать модель). */
  notes?: string;
}

/**
 * Контракт TTS-бэкенда. Каждый движок (piper, espeak, sherpa, silero, remote)
 * реализует этот интерфейс — единый способ подключения любого языка/движка.
 *
 * Обязательны только id/label/capabilities/check/synthesize/dispose; остальное
 * опционально, поэтому сторонний бэкенд остаётся минимальным и всё равно
 * работает.
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

  /**
   * Настроить пути к движку и его голосам (из `[tts.engines.<id>]`).
   * Вызывается при создании менеджера и при смене настроек; бэкенд без этого
   * метода игнорирует пользовательские пути и работает по своему автопоиску.
   */
  configure?(paths: TtsEnginePaths): void;

  /**
   * Голоса, найденные на диске. Нужен движкам с файловыми моделями, чтобы
   * модалка показывала локальные голоса, а не только скачивание из сети.
   */
  listVoices?(): Promise<TtsVoiceEntry[]>;

  /**
   * Онлайн-каталог голосов/моделей (может ходить в сеть). Если метод есть,
   * модалка показывает его вместо `listVoices()` и разрешает установку через
   * `installVoice()`. `check()` и `listVoices()` при этом сеть не трогают.
   */
  voiceCatalog?(signal?: AbortSignal): Promise<TtsVoiceEntry[]>;

  /**
   * Предупреждение последнего `voiceCatalog()` (например, каталог не
   * ответил и отдан просроченный кеш). Модалка показывает его в футере.
   */
  readonly catalogWarning?: string | null;

  /**
   * Установить голос/модель по id из каталога. Возвращает значение для
   * `tts.voice` (напр. basename .onnx или `model#0`).
   */
  installVoice?(
    voiceId: string,
    onProgress: (p: TtsVoiceInstallProgress) => void,
    signal?: AbortSignal,
  ): Promise<string>;

  /** Голос по умолчанию для нового движка (синхронно, без I/O). */
  defaultVoice?(): string;

  /** Подсказка «как поставить», если движок не найден (показывается в UI). */
  installHint?(): TtsInstallHint | null;

  /** Освободить ресурсы бэкенда (дочерние процессы). */
  dispose(): void;
}
