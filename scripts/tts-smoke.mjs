// Smoke-тест TTS: piper -> wav -> paplay (реальный звук).
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VENV_BIN = join(ROOT, '.tts-venv', 'bin');
const MODELS = join(ROOT, '.tts-models');

// piper из venv должен быть в PATH
process.env.PATH = `${VENV_BIN}:${process.env.PATH}`;
process.env.PIPER_MODELS_DIR = MODELS;

const { PiperBackend } = await import(join(ROOT, 'dist', 'tts', 'piper.js'));
const { SystemPlayer } = await import(join(ROOT, 'dist', 'tts', 'player.js'));

const backend = new PiperBackend();
console.log('check:', await backend.check());
console.log('synthesizing...');
const wav = await backend.synthesize(
  { text: 'Привет! Это первый тест озвучивания книги в табуке.', startChar: 0 },
  { voice: 'ru_RU-irina-medium' },
);
console.log('wav:', wav);

const player = new SystemPlayer();
player.onCallbacks({ onEnded: () => console.log('ENDED'), onError: (m) => console.log('ERR', m) });
player.play(wav);
await new Promise((r) => setTimeout(r, 6000));
player.dispose();
console.log('DONE');
process.exit(0);
