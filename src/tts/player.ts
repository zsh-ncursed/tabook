import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { AudioPlayer, AudioPlayerCallbacks, WavSource } from './backend.js';

// Кандидаты для воспроизведения WAV в Linux (PulseAudio/PipeWire/…).
// Выбираем первый доступный в PATH. Никаких новых пакетов — всё системное.
interface PlayerDef {
  cmd: string;
  args: (path: string) => string[];
}
const PLAYER_CANDIDATES: PlayerDef[] = [
  // ffplay — часть ffmpeg, есть почти везде (десктоп, серверы, контейнеры,
  // Termux, Android). Работает с PulseAudio, PipeWire, ALSA через соответствующие
  // устройства. -nodisp убирает видео-окно, -autoexit завершает сам.
  { cmd: 'ffplay', args: (p) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', p] },
  // paplay — пульсовый плеер (PulseAudio / PipeWire-pulse). Fallback на десктопе,
  // когда ffplay недоступен.
  { cmd: 'paplay', args: (p) => [p] },
  // aplay — ALSA, работает только при наличии alsa-lib. Последний fallback.
  { cmd: 'aplay', args: (p) => ['-q', p] },
];

function resolvePlayer(): PlayerDef | null {
  const pathEntries = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const cand of PLAYER_CANDIDATES) {
    for (const dir of pathEntries) {
      if (existsSync(join(dir, cand.cmd))) return cand;
    }
  }
  return null;
}

/**
 * Реальная реализация плеера: пишет WAV во временный файл и играет через
 * системный плеер. Пауза реализуется как «запомнить источник и остановить»;
 * resume — перезапуск с начала источника (для текстовых чанков приемлемо).
 */
export class SystemPlayer implements AudioPlayer {
  private cb: AudioPlayerCallbacks = {
    onEnded: () => {},
    onError: () => {},
  };
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private current: WavSource | null = null;
  private paused = false;
  private disposed = false;
  private tmpFiles: string[] = [];

  onCallbacks(cb: AudioPlayerCallbacks): void {
    this.cb = cb;
  }

  play(source: WavSource): void {
    if (this.disposed) return;
    this.stop();
    this.current = source;
    this.paused = false;
    this.startProcess(ensureWavFile(source));
  }

  pause(): void {
    if (this.paused || !this.proc) return;
    // Останавливаем процесс, но запоминаем источник → resume перезапустит.
    this.paused = true;
    this.killProc();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.current) this.startProcess(ensureWavFile(this.current));
  }

  stop(): void {
    this.paused = false;
    this.current = null;
    this.killProc();
  }

  dispose(): void {
    this.disposed = true;
    this.killProc();
    for (const f of this.tmpFiles) {
      try {
        unlinkSync(f);
      } catch {
        /* уже удалён */
      }
    }
    this.tmpFiles = [];
  }

  private startProcess(path: string): void {
    const player = resolvePlayer();
    if (!player) {
      this.cb.onError(
        'No audio player found in PATH (ffplay / paplay / aplay).\n' +
          'Install one:  sudo pacman -S ffmpeg   (or pulseaudio-alsa / alsa-utils)',
      );
      return;
    }
    const child = spawn(player.cmd, player.args(path), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = child;
    let err = '';
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-512);
    });
    child.on('error', (e) => {
      if (this.proc !== child) return;
      this.proc = null;
      this.cb.onError(`audio player error: ${e.message}`);
    });
    child.on('close', (code) => {
      if (this.proc !== child) return; // устарел (заменён/остановлен)
      this.proc = null;
      if (this.disposed) return;
      if (code !== 0 && code !== null && this.current) {
        this.cb.onError(`player exited with code ${code}: ${err.trim()}`);
        return;
      }
      this.cb.onEnded();
    });
  }

  private killProc(): void {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }
}

/** Скопировать WAV в temp-файл, если это buffer (плееру нужен путь к файлу). */
function ensureWavFile(src: WavSource): string {
  if (src.kind === 'file') return src.path;
  const tmp = join(
    tmpdir(),
    `tabook-tts-${process.pid}-${Math.random().toString(36).slice(2)}.wav`,
  );
  writeFileSync(tmp, src.buffer);
  return tmp;
}
