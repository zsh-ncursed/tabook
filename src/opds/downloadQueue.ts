// Background OPDS download queue.
//
// Pressing `d` on several entries queues them all; downloads run one at a
// time while the user keeps navigating (input is never blocked). Each job
// reports byte progress via the streaming fetch; the queue survives leaving
// the OPDS view (module-level singleton), so a download started in the
// catalog finishes and lands in the library even if the user navigates away.
import { createContext, useContext } from 'react';
import type { OpdsEntry } from './model.js';
import type { OpdsAuth, DownloadProgress } from './client.js';
import type { LibraryDb } from '../db/db.js';
import { downloadAndSave, type DownloadResult } from './download.js';

export type DownloadJobStatus = 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled';

/** Public view of a job (no internals like the entry or AbortController). */
export interface DownloadJob {
  id: number;
  title: string;
  status: DownloadJobStatus;
  /** Bytes received so far (final size once done). */
  received: number;
  /** Total bytes when the server sent Content-Length. */
  total?: number;
  error?: string;
  result?: DownloadResult;
}

interface PendingJob extends DownloadJob {
  entry: OpdsEntry;
  auth: OpdsAuth;
  db: LibraryDb;
  base?: string;
  signal: AbortController;
  onDone?: (job: DownloadJob) => void;
}

type Listener = () => void;

export class DownloadQueue {
  private jobs: PendingJob[] = [];
  private nextId = 1;
  private running = false;
  private listeners = new Set<Listener>();

  /** True while any job is queued or in flight. */
  get active(): boolean {
    return this.jobs.some((j) => j.status === 'queued' || j.status === 'downloading');
  }

  /** The job currently being downloaded, if any. */
  get current(): DownloadJob | null {
    return this.jobs.find((j) => j.status === 'downloading') ?? null;
  }

  get pendingCount(): number {
    return this.jobs.filter((j) => j.status === 'queued').length;
  }

  enqueue(params: {
    entry: OpdsEntry;
    auth: OpdsAuth;
    db: LibraryDb;
    base?: string;
    onDone?: (job: DownloadJob) => void;
  }): DownloadJob {
    const job: PendingJob = {
      id: this.nextId++,
      title: params.entry.title,
      status: 'queued',
      received: 0,
      entry: params.entry,
      auth: params.auth,
      db: params.db,
      base: params.base,
      signal: new AbortController(),
      onDone: params.onDone,
    };
    this.jobs.push(job);
    this.notify();
    void this.pump();
    return job;
  }

  /** Cancel a queued or in-flight job. */
  cancel(id: number): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      this.notify();
    } else if (job.status === 'downloading') {
      job.signal.abort(); // pump() marks it cancelled when the fetch rejects
    }
  }

  /** Drop a job from the list entirely (terminal states only). */
  remove(id: number): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'queued' || job.status === 'downloading') {
      this.cancel(id);
    }
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.notify();
  }

  /** Subscribe to any change (progress, status transitions). Returns unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Snapshot of the public job list (stable copies, internals stripped). */
  snapshot(): DownloadJob[] {
    return this.jobs.map((job) => {
      const { id, title, status, received, total, error, result } = job;
      return { id, title, status, received, total, error, result };
    });
  }

  /** Test hook: abort everything and clear the queue. */
  reset(): void {
    for (const job of this.jobs) job.signal.abort();
    this.jobs = [];
    this.nextId = 1;
    this.running = false;
    this.notify();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find((j) => j.status === 'queued');
        if (!job) break;
        job.status = 'downloading';
        this.notify();
        try {
          const result = await downloadAndSave(job.entry, {
            auth: job.auth,
            db: job.db,
            base: job.base,
            signal: job.signal.signal,
            onProgress: (p: DownloadProgress) => {
              job.received = p.received;
              job.total = p.total;
              this.notify();
            },
          });
          job.status = 'done';
          job.result = result;
          job.onDone?.(job);
        } catch (err) {
          if (job.signal.signal.aborted) {
            job.status = 'cancelled';
          } else {
            job.status = 'failed';
            job.error = err instanceof Error ? err.message : String(err);
          }
        }
        this.notify();
      }
    } finally {
      this.running = false;
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Shared queue used by the OPDS view — survives leaving the view. */
export const opdsDownloadQueue = new DownloadQueue();

// Dependency injection: views read the queue from React context instead of
// importing the module singleton, so a test can render with an isolated
// DownloadQueue instance. Defaults to the shared singleton.
export const DownloadQueueContext = createContext<DownloadQueue>(opdsDownloadQueue);

export function useDownloadQueue(): DownloadQueue {
  return useContext(DownloadQueueContext);
}
