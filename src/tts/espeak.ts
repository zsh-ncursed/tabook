import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TtsBackend, WavSource } from './backend.js';
import type { TtsChunk, TtsVoiceOptions } from './types.js';
import { commandAvailable } from './bincheck.js';

/**
 * Бэкенд eSpeak NG — компактный системный синтезатор (fallback).
 * Требует `espeak-ng` в PATH (есть в репозиториях большинства дистрибутивов).
 * Качество роботизированное, зато работает без моделей и почти без ресурсов.
 */
export class EspeakBackend implements TtsBackend {
  readonly id = 'espeak';
  readonly label = 'eSpeak NG (compact system fallback)';
  readonly capabilities = {
    languages: ['ru', 'en', 'de', 'es', 'fr', 'it', 'pt', 'pl', 'hu', 'ja', 'zh', ...MORE],
    offline: true,
    rateControl: false,
    pitchControl: true,
  } as const;

  async check(): Promise<string | null> {
    if (!commandAvailable('espeak-ng')) {
      return [
        'espeak-ng not found in PATH.',
        '',
        'To fix:',
        '  1. Install:  sudo pacman -S espeak-ng   (Debian/Ubuntu: apt install espeak-ng)',
        '  2. Enable TTS: :tts config  →  set Engine to espeak, or add to config.toml:',
        '',
        '     [tts]',
        '     mode = "active"',
        '     engine = "espeak"',
      ].join('\n');
    }
    return null;
  }

  async synthesize(chunk: TtsChunk, opts: TtsVoiceOptions): Promise<WavSource> {
    const voice = opts.voice ?? 'ru';
    const out = join(
      tmpdir(),
      `tabook-espeak-${process.pid}-${Math.random().toString(36).slice(2)}.wav`,
    );
    const rateArg = opts.rate && opts.rate !== 1 ? ['-s', String(Math.round(opts.rate * 175))] : [];
    // espeak-ng pitch: 0–100, default 50 → наш множитель 1.0 == 50.
    const pitchArg =
      opts.pitch && opts.pitch !== 1 ? ['-p', String(Math.round((opts.pitch - 1) * 50 + 50))] : [];
    await textToWavEspeak(voice, [...rateArg, ...pitchArg], chunk.text, out);
    return { kind: 'file', path: out };
  }

  dispose(): void {
    /* разовый процесс на синтез */
  }
}

const MORE = ['cs', 'da', 'el', 'eo', 'fi', 'hr', 'hu', 'nl', 'no', 'ro', 'sk', 'sl', 'sv', 'tr'];

function textToWavEspeak(
  voice: string,
  rateArg: string[],
  text: string,
  out: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('espeak-ng', ['-v', voice, '-w', out, ...rateArg], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-512);
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        // stderr может содержать ANSI-коды и несколько строк — сжимаем в
        // одну, чтобы индикатор ошибки не разорвал экран TUI.
        const summary =
          err
            .replace(/\x1b\[[0-9;]*m/g, '')
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
            .slice(-1)[0] ?? '';
        reject(new Error(`espeak-ng failed (${code}): ${summary.slice(0, 200)}`));
        return;
      }
      resolve();
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}
