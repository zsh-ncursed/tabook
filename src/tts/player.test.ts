import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SystemPlayer } from './player.js';
import { testTmpdir } from '../testutil/tmpdir.js';

describe('SystemPlayer temp wav cleanup', () => {
  // Регрессия: ensureWavFile был свободной функцией вне класса, поэтому пути
  // piper-овских wav (kind:'file') никуда не попадали, tmpFiles оставался пустым,
  // и каждый чанк оставлял файл в /tmp до конца жизни машины.
  it('deletes the wav it played on stop()', () => {
    const dir = testTmpdir('tts-player');
    const wav = join(dir, 'chunk.wav');
    writeFileSync(wav, 'RIFF');

    const p = new SystemPlayer();
    p.onCallbacks({ onEnded: () => {}, onError: () => {} });
    p.play({ kind: 'file', path: wav });
    expect(existsSync(wav)).toBe(true);

    p.stop();
    expect(existsSync(wav)).toBe(false);
  });

  it('does not leak the wav when playback is replaced by the next chunk', () => {
    const dir = testTmpdir('tts-player');
    const first = join(dir, 'one.wav');
    const second = join(dir, 'two.wav');
    writeFileSync(first, 'RIFF');
    writeFileSync(second, 'RIFF');

    const p = new SystemPlayer();
    p.onCallbacks({ onEnded: () => {}, onError: () => {} });
    p.play({ kind: 'file', path: first });
    p.play({ kind: 'file', path: second });

    // Прежний чанк убран сразу, не дожидаясь dispose() — иначе за час озвучки
    // в /tmp копится сотня файлов.
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);

    p.dispose();
    expect(existsSync(second)).toBe(false);
  });

  it('keeps the file across pause/resume so resume can replay it', () => {
    const dir = testTmpdir('tts-player');
    const wav = join(dir, 'chunk.wav');
    writeFileSync(wav, 'RIFF');

    const p = new SystemPlayer();
    p.onCallbacks({ onEnded: () => {}, onError: () => {} });
    p.play({ kind: 'file', path: wav });

    // pause() без живого процесса — no-op, но файл обязан остаться: resume
    // перезапускает плеер с того же пути.
    p.pause();
    expect(existsSync(wav)).toBe(true);

    p.dispose();
    expect(existsSync(wav)).toBe(false);
  });
});
