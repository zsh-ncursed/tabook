import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadFile, formatBytes } from './download.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { testTmpdir } from '../testutil/tmpdir.js';

/** Путь к файлу внутри свежей тестовой директории (на диске, не в /tmp-RAM). */
const tmp = () => path.join(testTmpdir('tabook-dl-test'), 'voice.onnx');

describe('formatBytes', () => {
  it('formats bytes/KB/MB/GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(1073741824)).toBe('1.00 GB');
  });
});

describe('downloadFile', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Node 18+ has a global fetch; guard for older runtimes.
    if (typeof originalFetch !== 'function') {
      throw new Error('global fetch is required for these tests');
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('streams body to disk and reports progress', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const dest = tmp();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const c of chunks) controller.enqueue(c);
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-length': '5' } },
        ),
    ) as unknown as typeof globalThis.fetch;

    const onProgress = vi.fn();
    const result = await downloadFile({ url: 'http://x/y.onnx', dest, onProgress });

    expect(result.size).toBe(5);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).size).toBe(5);
    expect(onProgress).toHaveBeenCalled();
    // Last progress call should report the full size
    const last = onProgress.mock.calls.at(-1)!;
    expect(last[0]).toBe(5);
    expect(last[1]).toBe(5);
    fs.unlinkSync(dest);
  });

  it('rejects on HTTP error and deletes the partial file', async () => {
    const dest = tmp();
    globalThis.fetch = vi.fn(
      async () => new Response('not found', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof globalThis.fetch;

    await expect(downloadFile({ url: 'http://x/missing.onnx', dest })).rejects.toThrow(/HTTP 404/);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('rejects when the body is missing', async () => {
    const dest = tmp();
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    await expect(downloadFile({ url: 'http://x/empty.onnx', dest })).rejects.toThrow(
      /No response body/,
    );
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('creates the destination directory tree', async () => {
    const dest = path.join(testTmpdir('tabook-dl-tree'), 'nested', 'dir', 'voice.onnx');
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([9]));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof globalThis.fetch;

    const result = await downloadFile({ url: 'http://x/v.onnx', dest });
    expect(result.size).toBe(1);
    expect(fs.existsSync(dest)).toBe(true);
    fs.unlinkSync(dest);
  });
});
