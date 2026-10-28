import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testTmpdir } from '../testutil/tmpdir.js';
import { VoskWorker, voskPythonCandidates } from './voskWorker.js';

const FAKE = `#!/bin/sh
printf '%s\\n' '{"event":"ready"}'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\\([0-9][0-9]*\\).*/\\1/p')
  case "$line" in
    *boom*) printf '{"id":%s,"ok":false,"error":"KeyError: boom"}\\n' "$id" ;;
    *slow*) sleep 1; printf '{"id":%s,"ok":true}\\n' "$id" ;;
    *) printf '{"id":%s,"ok":true}\\n' "$id" ;;
  esac
done
`;

function fakeWorker(): string {
  const dir = testTmpdir('vosk-worker');
  const path = join(dir, 'fake-python');
  writeFileSync(path, FAKE);
  chmodSync(path, 0o755);
  return path;
}

function request(text: string): Parameters<VoskWorker['synthesize']>[0] {
  return { model: '/m', key: '/m', speaker: 0, rate: 1, text, output: '/out.wav' };
}

describe('voskPythonCandidates', () => {
  it('prefers VOSK_TTS_PYTHON, then the binary shebang', () => {
    const dir = testTmpdir('vosk-candidates');
    const bin = join(dir, 'vosk-tts');
    writeFileSync(bin, '#!/opt/vosk-venv/bin/python\n');
    const list = voskPythonCandidates(bin, {
      VOSK_TTS_PYTHON: '/custom/python3',
    } as NodeJS.ProcessEnv);
    expect(list[0]).toBe('/custom/python3');
    expect(list[1]).toBe('/opt/vosk-venv/bin/python');
    expect(list.at(-1)).toBe('python3');
  });

  it('resolves env-based shebangs and the venv sibling', () => {
    const dir = testTmpdir('vosk-candidates-env');
    const bin = join(dir, 'vosk-tts');
    writeFileSync(bin, '#!/usr/bin/env -S python3 -u\n');
    const list = voskPythonCandidates(bin, {} as NodeJS.ProcessEnv);
    expect(list).toContain('python3');
    expect(list).toContain(join(dir, 'python'));
  });
});

describe('VoskWorker', () => {
  it('synthesizes over the JSON-lines protocol and reuses the process', async () => {
    const worker = new VoskWorker('', { python: fakeWorker(), script: 'ignored' });
    try {
      await worker.synthesize(request('раз'));
      await worker.synthesize(request('два'));
    } finally {
      worker.dispose();
    }
  });

  it('surfaces Python errors with the engine prefix', async () => {
    const worker = new VoskWorker('', { python: fakeWorker(), script: 'ignored' });
    try {
      await expect(worker.synthesize(request('boom'))).rejects.toThrow(
        'Vosk synthesis failed: KeyError: boom',
      );
    } finally {
      worker.dispose();
    }
  });

  it('times out a stuck synthesis and keeps the queue usable', async () => {
    const worker = new VoskWorker('', {
      python: fakeWorker(),
      script: 'ignored',
      loadTimeoutMs: 2000,
      synthTimeoutMs: 50,
    });
    try {
      await worker.synthesize(request('раз'));
      await expect(worker.synthesize(request('slow'))).rejects.toThrow('Vosk synthesis timed out');
    } finally {
      worker.dispose();
    }
  });

  it('rejects pending work and refuses to restart after dispose', async () => {
    const worker = new VoskWorker('', {
      python: fakeWorker(),
      script: 'ignored',
      synthTimeoutMs: 5000,
    });
    await worker.synthesize(request('раз'));
    const pending = worker.synthesize(request('slow'));
    worker.dispose();
    await expect(pending).rejects.toThrow('Vosk worker stopped');
    await expect(worker.synthesize(request('раз'))).rejects.toThrow('Vosk worker stopped');
  });

  it('reports a missing interpreter', async () => {
    const dir = testTmpdir('vosk-missing-python');
    mkdirSync(dir, { recursive: true });
    const worker = new VoskWorker('', { python: join(dir, 'nope') });
    try {
      await expect(worker.synthesize(request('раз'))).rejects.toThrow(
        'Python interpreter not found',
      );
    } finally {
      worker.dispose();
    }
  });
});
