import type { TtsBackend, AudioPlayer } from './backend.js';
import type { TtsChunk, TtsStatus, TtsVoiceOptions } from './types.js';
import { isSpeakable } from './chunking.js';
import { SystemPlayer } from './player.js';

/** Обратный вызов при смене статуса — для статус-бара/индикатора. */
export type TtsStatusListener = (status: TtsStatus) => void;

/**
 * Событие «начат/продолжен чанк» — чтобы ридер мог прокрутить текст за звуком
 * (follow-режим) и сообщить, какая позиция книги сейчас озвучивается.
 */
export interface TtsAdvance {
  startChar: number;
  chunkIndex: number;
  total: number;
}

export interface TtsManagerOptions {
  /** Системный плеер (по умолчанию создаётся SystemPlayer). */
  player?: AudioPlayer;
  /** Пауза (мс) между чанками. */
  interChunkPauseMs?: number;
  /** Разбивать длинные чанки по предложениям (далее в интеграции). */
}

/**
 * Оркестратор TTS: держит бэкенды, очередь чанков, статус воспроизведения
 * и координацию с навигацией. Не зависит от ReaderSession напрямую — чанки
 * и стартовую позицию передаёт интеграционный слой, поэтому менеджер
 * полностью юнит-тестируем.
 */
export class TtsManager {
  private backends = new Map<string, TtsBackend>();
  private player: AudioPlayer;
  private opts: { interChunkPauseMs: number };

  private chunks: TtsChunk[] = [];
  private index = 0;
  private engine: string | null = null;
  private voiceOpts: TtsVoiceOptions = {};
  private statusListener: TtsStatusListener | null = null;
  private advanceListener: ((a: TtsAdvance) => void) | null = null;
  private status: TtsStatus = { state: 'idle' };
  private stopping = false;

  constructor(opts: TtsManagerOptions = {}) {
    this.player = opts.player ?? createDefaultPlayer();
    this.opts = { interChunkPauseMs: opts.interChunkPauseMs ?? 250 };
    this.player.onCallbacks({
      onEnded: () => this.onChunkEnded(),
      onError: (m) => this.setStatus({ state: 'error', message: m }),
    });
  }

  // ---- реестр бэкендов ----

  register(b: TtsBackend): void {
    this.backends.set(b.id, b);
  }

  /** Бэкенд по id или первый зарегистрированный (если ищут 'auto'). */
  resolveBackend(id?: string): TtsBackend | null {
    if (id && this.backends.has(id)) return this.backends.get(id)!;
    if (!id || id === 'auto') return this.backends.values().next().value ?? null;
    return null;
  }

  get engines(): { id: string; label: string }[] {
    return [...this.backends.values()].map((b) => ({ id: b.id, label: b.label }));
  }

  // ---- подписки ----

  onStatus(listener: TtsStatusListener): void {
    this.statusListener = listener;
    listener(this.status); // сразу отрапортовать текущее состояние
  }

  onAdvance(listener: (a: TtsAdvance) => void): void {
    this.advanceListener = listener;
  }

  getStatus(): TtsStatus {
    return this.status;
  }

  // ---- управление ----

  /**
   * Задать список чанков и начать воспроизведение с `startIndex`.
   * Если уже играем тот же набор, просто перезапускает с указанного чанка.
   */
  play(chunks: TtsChunk[], opts: { engine?: string; voice?: TtsVoiceOptions } = {}): void {
    this.stop();
    // Пустые/whitespace-чанки и «огрызки» из одних знаков препинания нельзя
    // отдавать в движок: piper падает на тексте без фонем (Python traceback).
    this.chunks = chunks.filter((c) => c.text.trim().length > 0 && isSpeakable(c.text));
    this.index = 0;
    this.engine = opts.engine ?? this.engine;
    this.voiceOpts = opts.voice ?? this.voiceOpts;
    if (this.chunks.length === 0) {
      this.setStatus({ state: 'error', message: 'nothing to read at this position' });
      return;
    }
    const engine = this.resolveBackend(this.engine ?? undefined);
    if (!engine) {
      this.setStatus({
        state: 'error',
        message: `TTS engine "${this.engine ?? 'auto'}" not registered. Run :tts config to pick one (piper or espeak)`,
      });
      return;
    }
    // Pre-flight: проверяем движок ДО синтеза, чтобы пользователь увидел
    // понятное «espeak-ng not found — установите пакет», а не сырой ENOENT
    // из глубины spawn посреди воспроизведения.
    void engine.check().then((problem) => {
      if (this.stopping) return;
      if (problem) {
        this.setStatus({ state: 'error', message: problem });
        return;
      }
      this.playChunkFrom(0);
    });
  }

  /** Пауза/возобновление (toggle). */
  toggle(): TtsStatus {
    if (this.status.state === 'playing') {
      this.player.pause();
      this.setStatus({
        state: 'paused',
        currentChar: this.currentChar(),
      });
    } else if (this.status.state === 'paused') {
      this.player.resume();
      this.setStatus({
        state: 'playing',
        currentChar: this.currentChar(),
        chunkIndex: this.index,
        total: this.chunks.length,
      });
    }
    return this.status;
  }

  pause(): void {
    if (this.status.state === 'playing') {
      this.player.pause();
      this.setStatus({ state: 'paused', currentChar: this.currentChar() });
    }
  }

  resume(): void {
    if (this.status.state === 'paused') {
      this.player.resume();
      this.setStatus({
        state: 'playing',
        currentChar: this.currentChar(),
        chunkIndex: this.index,
        total: this.chunks.length,
      });
    }
  }

  stop(): void {
    this.stopping = true;
    this.player.stop();
    this.chunks = [];
    this.index = 0;
    this.stopping = false;
    this.setStatus({ state: 'idle' });
  }

  /** Убить плеер/процессы и снять подписки (при выходе из ридера). */
  dispose(): void {
    this.player.stop();
    this.player.dispose();
    this.statusListener = null;
    this.advanceListener = null;
    this.chunks = [];
  }

  // ---- внутреннее ----

  private currentChar(): number {
    const c = this.chunks[this.index];
    return c ? c.startChar : 0;
  }

  private setStatus(s: TtsStatus): void {
    this.status = s;
    this.statusListener?.(s);
  }

  private playChunkFrom(idx: number): void {
    if (idx >= this.chunks.length) {
      this.setStatus({ state: 'idle' });
      return;
    }
    // синтез может быть асинхронным; для простоты играем после синтеза
    this.playChunk(idx);
  }

  private playChunk(idx: number): void {
    const chunk = this.chunks[idx];
    if (!chunk) return;
    this.index = idx;
    const engine = this.resolveBackend(this.engine ?? undefined);
    if (!engine) {
      this.setStatus({ state: 'error', message: 'no tts engine registered' });
      return;
    }
    // долгий синтез не блокирует: асинхронный метод, статус «playing» ставим сразу
    this.setStatus({
      state: 'playing',
      currentChar: chunk.startChar,
      chunkIndex: idx,
      total: this.chunks.length,
    });
    this.advanceListener?.({
      startChar: chunk.startChar,
      chunkIndex: idx,
      total: this.chunks.length,
    });
    engine
      .synthesize(chunk, this.voiceOpts)
      .then((wav) => {
        if (this.stopping) return;
        this.player.play(wav);
      })
      .catch((e) => {
        this.setStatus({
          state: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
      });
  }

  private onChunkEnded(): void {
    if (this.stopping) return;
    const next = this.index + 1;
    if (next >= this.chunks.length) {
      this.setStatus({ state: 'idle' });
      return;
    }
    // небольшая пауза между чанками (тишина на стыке абзацев)
    const pauseMs = this.opts.interChunkPauseMs;
    if (pauseMs > 0) {
      setTimeout(() => {
        if (this.stopping) return;
        this.playChunk(next);
      }, pauseMs);
    } else {
      this.playChunk(next);
    }
  }
}

/** Создать системный плеер по умолчанию. */
function createDefaultPlayer(): AudioPlayer {
  return new SystemPlayer();
}
