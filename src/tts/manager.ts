import type { TtsBackend, AudioPlayer, WavSource } from './backend.js';
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

/** Сколько секунд индикатор держит ошибку на экране, прежде чем вернуться в idle. */
const ERROR_HOLD_MS = 4000;

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
  /**
   * Буфер предзагруженных (prefetch) WAV: индекс чанка → готовый источник.
   * Следующий чанк синтезируется, пока играется текущий, поэтому на стыке
   * абзацев нет тишины на время запуска piper/espeak и самого синтеза.
   */
  private pendingWavs = new Map<number, WavSource>();
  // Несколько слушателей: индикатор в ReaderView, karaoke/follow в App и т.д.
  // Одиночный слушатель означал, что подписка одного компонента молча
  // отвязывала предыдущего — индикатор TTS переставал обновляться.
  private statusListeners = new Set<TtsStatusListener>();
  private advanceListeners = new Set<(a: TtsAdvance) => void>();
  private status: TtsStatus = { state: 'idle' };
  /**
   * Монотонный счётчик «поколений» воспроизведения. Прежде здесь стоял булев
   * `stopping`, но stop() выставлял его в true и тут же синхронно сбрасывал в
   * false, поэтому все гварды `if (this.stopping) return` в async-колбэках
   * никогда не срабатывали: стоп во время синтеза всё равно включал звук, а
   * `:tts` + быстрый `:tts stop` успевали запустить проигрывание после стопа.
   * Счётчик однозначен: каждая отложенная операция помнит своё поколение и
   * выполняется, только если оно всё ещё актуально.
   */
  private gen = 0;
  private errorTimer: NodeJS.Timeout | undefined;

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

  /** Pre-flight проверка движка TTS. Возвращает текст проблемы или null. */
  async check(engineId?: string): Promise<string | null> {
    const engine = this.resolveBackend(engineId);
    if (!engine) return `TTS engine "${engineId ?? 'auto'}" not registered`;
    return engine.check();
  }

  // ---- подписки ----

  onStatus(listener: TtsStatusListener): void {
    this.statusListeners.add(listener);
    listener(this.status); // сразу отрапортовать текущее состояние
  }

  /** Отписаться от статуса (компонент демонтируется). */
  offStatus(listener: TtsStatusListener): void {
    this.statusListeners.delete(listener);
  }

  onAdvance(listener: (a: TtsAdvance) => void): void {
    this.advanceListeners.add(listener);
  }

  /** Отписаться от advance-событий. */
  offAdvance(listener: (a: TtsAdvance) => void): void {
    this.advanceListeners.delete(listener);
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
    const gen = this.gen; // поколение, установленное stop() выше — наше «текущее»
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
        // Список доступных берём у самого менеджера: когда добавляется
        // новый бекенд, указание списка не растёт.
        message: `TTS engine "${this.engine ?? 'auto'}" not registered. Available: ${
          this.engines.map((e) => e.id).join(', ') || 'none'
        }. Run :tts config to pick one.`,
      });
      return;
    }
    // Pre-flight: проверяем движок ДО синтеза, чтобы пользователь увидел
    // понятное «espeak-ng not found — установите пакет», а не сырой ENOENT
    // из глубины spawn посреди воспроизведения.
    void engine.check().then((problem) => {
      if (gen !== this.gen) return; // пока check() висел, пользователь нажал stop
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
    // Инвалидируем всё, что было запущено раньше: любой отложенный check()/
    // synthesize()/setTimeout увидит несовпадение поколения и не тронет плеер.
    this.gen++;
    clearTimeout(this.errorTimer);
    this.errorTimer = undefined;
    this.player.stop();
    this.chunks = [];
    this.index = 0;
    this.pendingWavs.clear();
    this.setStatus({ state: 'idle' });
  }

  /** Убить плеер/процессы и снять подписки (при выходе из ридера). */
  dispose(): void {
    clearTimeout(this.errorTimer);
    this.errorTimer = undefined;
    this.player.stop();
    this.player.dispose();
    this.statusListeners.clear();
    this.advanceListeners.clear();
    this.chunks = [];
    this.pendingWavs.clear();
  }

  // ---- внутреннее ----

  private currentChar(): number {
    const c = this.chunks[this.index];
    return c ? c.startChar : 0;
  }

  private setStatus(s: TtsStatus): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
    // Ошибка не должна висеть в индикаторе вечно: пользователь увидел — и через
    // пару секунд возвращаемся в idle, чтобы текст не залипал поверх книги.
    if (s.state === 'error') {
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => {
        if (this.status.state === 'error') {
          this.setStatus({ state: 'idle' });
        }
      }, ERROR_HOLD_MS);
    }
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
    const gen = this.gen;
    const engine = this.resolveBackend(this.engine ?? undefined);
    if (!engine) {
      this.startChunk(idx);
      this.setStatus({ state: 'error', message: 'no tts engine registered' });
      return;
    }
    // объявляем чанк текущим (статус, advance, prefetch следующего) сразу
    this.startChunk(idx);
    engine
      .synthesize(chunk, this.voiceOpts)
      .then((wav) => {
        // Стоп во время синтеза: wav выкидываем, звук не включаем.
        if (gen !== this.gen) return;
        this.player.play(wav);
      })
      .catch((e) => {
        // Ошибка устаревшего воспроизведения не должна перебивать текущее.
        if (gen !== this.gen) return;
        this.setStatus({
          state: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
      });
  }

  /**
   * Сделать чанк `idx` «текущим»: обновить статус/advance и начать предзагрузку
   * следующего. Вызывается и для обычного пути (синтез), и для уже готового wav.
   */
  private startChunk(idx: number): void {
    const chunk = this.chunks[idx];
    if (!chunk) return;
    this.index = idx;
    this.setStatus({
      state: 'playing',
      currentChar: chunk.startChar,
      chunkIndex: idx,
      total: this.chunks.length,
    });
    for (const l of this.advanceListeners) {
      l({
        startChar: chunk.startChar,
        chunkIndex: idx,
        total: this.chunks.length,
      });
    }
    this.prefetchNext(idx);
  }

  /** Играть `idx` без пересинтеза: статус/advance + готовый wav сразу. */
  private playReadyChunk(idx: number, wav: WavSource): void {
    this.startChunk(idx);
    this.player.play(wav);
  }

  /**
   * Начать синтез чанка `idx+1` заранее, пока играется `idx`. Результат попадёт
   * в `pendingWavs` и будет использован на `onChunkEnded` для бесшовного handoff —
   * без паузы и без ожидания синтеза. Если предзагрузка не успела (медленный
   * движок/короткий чанк), дальше сработает обычная очередь.
   */
  private prefetchNext(idx: number): void {
    const next = idx + 1;
    if (next >= this.chunks.length || this.pendingWavs.has(next)) return;
    const chunk = this.chunks[next];
    if (!chunk) return;
    const gen = this.gen;
    const engine = this.resolveBackend(this.engine ?? undefined);
    if (!engine) return;
    engine
      .synthesize(chunk, this.voiceOpts)
      .then((wav) => {
        if (gen !== this.gen) return; // остановили/перезапустили — результат не нужен
        this.pendingWavs.set(next, wav);
      })
      .catch(() => {
        // Предзагрузка не критична: собственный синтез чанка на месте воспроизведения
        // покажет корректную ошибку пользователю.
      });
  }

  private onChunkEnded(): void {
    const gen = this.gen;
    const next = this.index + 1;
    if (next >= this.chunks.length) {
      // не оставлять лишние wav в буфере (после последнего чанка синтеза не было)
      this.pendingWavs.clear();
      this.setStatus({ state: 'idle' });
      return;
    }
    // Prefetch уже подготовил следующий чанк — играем сразу, без тишины.
    // Это и есть «бесшовная» озвучка: синтез шёл в фоне во время игры текущего.
    const ready = this.pendingWavs.get(next);
    if (ready) {
      this.pendingWavs.delete(next);
      this.playReadyChunk(next, ready);
      return;
    }
    // Предзагрузка не успела (короткий чанк / медленный движок) — старый путь.
    const pauseMs = this.opts.interChunkPauseMs;
    if (pauseMs > 0) {
      setTimeout(() => {
        if (gen !== this.gen) return; // остановлено, пока шла пауза
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
