import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DownloadQueue } from './downloadQueue.js';
import type { OpdsEntry } from './model.js';

vi.mock('./download.js', () => ({
  downloadAndSave: vi.fn(),
}));

import { downloadAndSave, type DownloadResult } from './download.js';
import type { DownloadProgress } from './client.js';

const mockedDownload = vi.mocked(downloadAndSave);

const dbStub = { addBook: () => 1 } as never;

function entry(title: string): OpdsEntry {
  const link = {
    rel: 'http://opds-spec.org/acquisition',
    href: `https://x/${title}.fb2`,
    type: 'text/fb2+xml',
  };
  return {
    id: `urn:${title}`,
    title,
    updated: '',
    authors: [],
    categories: [],
    links: [link],
    acquisitionLinks: [link],
    isAcquisition: true,
    isNavigation: false,
  };
}

const result = (bookId: number, title: string): DownloadResult => ({
  bookId,
  filePath: `/downloads/${title}.fb2`,
  title,
});

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('DownloadQueue', () => {
  beforeEach(() => {
    mockedDownload.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('processes queued jobs sequentially', async () => {
    const releases: Array<(r: DownloadResult) => void> = [];
    mockedDownload.mockImplementation(
      () =>
        new Promise<DownloadResult>((res) => {
          releases.push(res);
        }),
    );
    const queue = new DownloadQueue();
    const j1 = queue.enqueue({ entry: entry('A'), db: dbStub, auth: {} });
    const j2 = queue.enqueue({ entry: entry('B'), db: dbStub, auth: {} });

    await tick();
    expect(j1.status).toBe('downloading');
    expect(j2.status).toBe('queued');
    expect(mockedDownload).toHaveBeenCalledTimes(1);

    releases[0]!(result(1, 'A'));
    await tick();
    expect(j1.status).toBe('done');
    expect(j1.result?.bookId).toBe(1);
    expect(j2.status).toBe('downloading');
    expect(mockedDownload).toHaveBeenCalledTimes(2);

    releases[1]!(result(2, 'B'));
    await tick();
    expect(j2.status).toBe('done');
  });

  it('reports byte progress via onProgress', async () => {
    let progressCb: ((p: DownloadProgress) => void) | undefined;
    let release: (r: DownloadResult) => void = () => {};
    mockedDownload.mockImplementationOnce((_entry, opts) => {
      progressCb = opts.onProgress;
      return new Promise<DownloadResult>((res) => {
        release = res;
      });
    });
    const queue = new DownloadQueue();
    const job = queue.enqueue({ entry: entry('A'), db: dbStub, auth: {} });

    await tick();
    expect(job.status).toBe('downloading');
    progressCb!({ received: 10, total: 100 });
    progressCb!({ received: 55, total: 100 });
    expect(job.received).toBe(55);
    expect(job.total).toBe(100);

    release(result(1, 'A'));
    await tick();
    expect(job.status).toBe('done');
    expect(job.received).toBe(55);
  });

  it('marks a failed job and continues with the next', async () => {
    mockedDownload.mockRejectedValueOnce(new Error('boom'));
    mockedDownload.mockResolvedValueOnce(result(2, 'B'));
    const queue = new DownloadQueue();
    const j1 = queue.enqueue({ entry: entry('A'), db: dbStub, auth: {} });
    const j2 = queue.enqueue({ entry: entry('B'), db: dbStub, auth: {} });

    await tick();
    await tick();
    expect(j1.status).toBe('failed');
    expect(j1.error).toBe('boom');
    expect(j2.status).toBe('done');
    expect(j2.result?.bookId).toBe(2);
  });

  it('cancel drops a queued job without downloading it', async () => {
    const releases: Array<(r: DownloadResult) => void> = [];
    mockedDownload.mockImplementation(
      () =>
        new Promise<DownloadResult>((res) => {
          releases.push(res);
        }),
    );
    const queue = new DownloadQueue();
    const j1 = queue.enqueue({ entry: entry('A'), db: dbStub, auth: {} });
    const j2 = queue.enqueue({ entry: entry('B'), db: dbStub, auth: {} });

    await tick();
    queue.cancel(j2.id);
    expect(j2.status).toBe('cancelled');
    expect(mockedDownload).toHaveBeenCalledTimes(1);

    releases[0]!(result(1, 'A'));
    await tick();
    expect(j1.status).toBe('done');
  });

  it('cancel aborts an in-flight download', async () => {
    mockedDownload.mockImplementationOnce(
      (_entry, opts) =>
        new Promise<DownloadResult>((_res, rej) => {
          opts.signal?.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    const queue = new DownloadQueue();
    const job = queue.enqueue({ entry: entry('A'), db: dbStub, auth: {} });

    await tick();
    expect(job.status).toBe('downloading');
    queue.cancel(job.id);
    await tick();
    expect(job.status).toBe('cancelled');
  });

  it('calls onDone with the finished job', async () => {
    mockedDownload.mockResolvedValueOnce(result(7, 'A'));
    const queue = new DownloadQueue();
    const onDone = vi.fn();
    queue.enqueue({ entry: entry('A'), db: dbStub, auth: {}, onDone });

    await tick();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]![0]).toMatchObject({
      status: 'done',
      result: { bookId: 7 },
    });
  });

  it('tracks active/current/pending across states', async () => {
    const releases: Array<(r: DownloadResult) => void> = [];
    mockedDownload.mockImplementation(
      () =>
        new Promise<DownloadResult>((res) => {
          releases.push(res);
        }),
    );
    const queue = new DownloadQueue();
    expect(queue.active).toBe(false);

    const j1 = queue.enqueue({ entry: entry('A'), db: dbStub, auth: {} });
    const j2 = queue.enqueue({ entry: entry('B'), db: dbStub, auth: {} });
    await tick();
    expect(queue.active).toBe(true);
    expect(queue.current?.id).toBe(j1.id);
    expect(queue.pendingCount).toBe(1);

    releases[0]!(result(1, 'A'));
    await tick();
    expect(queue.current?.id).toBe(j2.id);
    expect(queue.pendingCount).toBe(0);

    releases[1]!(result(2, 'B'));
    await tick();
    expect(queue.active).toBe(false);
    expect(queue.current).toBeNull();
  });
});
