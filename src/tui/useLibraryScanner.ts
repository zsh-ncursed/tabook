import { useCallback, useEffect, useRef } from 'react';
import * as fs from 'node:fs';
import type { LibraryDb } from '../db/db.js';
import { resolveFolderPath, scanLibraryFolder, folderNeedsRescan } from '../db/scan.js';
import type { AppScreen } from './runCommand.js';

// Library scanning, extracted from App.tsx: runLibraryScan (serialized,
// queued), attachLibraryFolder (resolve + attach + scan), and the automatic
// stale-folder rescan that runs whenever the library screen is shown.
export function useLibraryScanner(opts: {
  db: LibraryDb;
  notify: (message: string) => void;
  screen: AppScreen;
  setLibraryRefresh: (fn: (c: number) => number) => void;
}): {
  runLibraryScan: (folderOnly?: string | string[], silentWhenEmpty?: boolean) => Promise<void>;
  attachLibraryFolder: (rawPath: string) => void;
} {
  const { db, notify, screen, setLibraryRefresh } = opts;

  // Guards against overlapping scans (auto-scan on startup + manual :library
  // scan + :library add can otherwise race on the same folder). Requests that
  // arrive mid-scan are accumulated and re-run after the current one
  // finishes: explicit folder scans accumulate their paths, and an explicit
  // full rescan (:library scan) supersedes them.
  const scanBusyRef = useRef(false);
  const pendingScanRef = useRef<{ all: boolean; folders: Set<string> } | null>(null);

  // Scan attached library folders, optionally just one. Progress is surfaced
  // via notify(); the library view is refreshed when done. Serialized through
  // scanBusyRef so concurrent triggers (startup + command) don't overlap.
  const runLibraryScan = useCallback(
    (folderOnly?: string | string[], silentWhenEmpty = false): Promise<void> => {
      if (scanBusyRef.current) {
        const pending = pendingScanRef.current ?? { all: false, folders: new Set<string>() };
        if (folderOnly === undefined) {
          pending.all = true;
          pending.folders.clear();
        } else if (!pending.all) {
          for (const p of Array.isArray(folderOnly) ? folderOnly : [folderOnly]) {
            pending.folders.add(p);
          }
        }
        pendingScanRef.current = pending;
        notify('A library scan is already running; queued');
        return Promise.resolve();
      }
      scanBusyRef.current = true;
      const folderList =
        folderOnly === undefined
          ? db.listLibraryFolders().map((f) => f.path)
          : Array.isArray(folderOnly)
            ? folderOnly
            : [folderOnly];
      const targets = folderList.map((p) => ({ path: p }));
      return (async () => {
        if (targets.length === 0) {
          // The startup auto-scan is silent when nothing is attached yet;
          // the hint belongs in the empty library view instead.
          if (!silentWhenEmpty) {
            notify('No folders attached. Add one with :library add <path>');
          }
          return;
        }
        for (const folder of targets) {
          notify(`Scanning ${folder.path}…`);
          try {
            const summary = await scanLibraryFolder(db, folder.path, (done, total) => {
              if (done === total || done % 25 === 0) {
                notify(`Scanning ${folder.path}: ${done}/${total}`);
              }
            });
            const errors = summary.failed > 0 ? `, ${summary.failed} failed` : '';
            notify(
              `${folder.path}: +${summary.added} new, ${summary.updated} updated, ` +
                `${summary.removed} removed${errors}`,
            );
          } catch (err) {
            notify(
              `Cannot scan ${folder.path}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      })().finally(() => {
        scanBusyRef.current = false;
        setLibraryRefresh((c) => c + 1);
        const pending = pendingScanRef.current;
        pendingScanRef.current = null;
        if (pending) {
          if (pending.all) {
            // Full rescan — db.listLibraryFolders() is re-read at run time,
            // so folders attached during the previous scan are included.
            void runLibraryScan(undefined, true);
          } else if (pending.folders.size > 0) {
            void runLibraryScan([...pending.folders], true);
          }
        }
      });
    },
    [db, notify, setLibraryRefresh],
  );

  // Attach a folder and scan it in one step. Called by :library add and by
  // the CLI when the positional argument is a directory.
  const attachLibraryFolder = useCallback(
    (rawPath: string): void => {
      let resolved: string;
      try {
        resolved = resolveFolderPath(rawPath);
        if (!fs.statSync(resolved).isDirectory()) {
          notify(`Not a directory: ${rawPath}`);
          return;
        }
      } catch (err) {
        notify(
          `Cannot attach folder ${rawPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      if (db.getLibraryFolderByPath(resolved)) {
        notify(`Folder already attached: ${resolved}`);
        return;
      }
      db.addLibraryFolder(resolved);
      notify(`Attached folder: ${resolved}`);
      void runLibraryScan(resolved);
    },
    [db, notify, runLibraryScan],
  );

  // On startup and every time the library view is entered (returning from
  // the reader or OPDS), rescan only folders whose files changed since the
  // last scan — a cheap mtime-based dirty check, no parsing for clean
  // folders. All stale folders are aggregated into one scan call so the
  // pending queue stays targeted (no force-all rescan of clean folders).
  // Explicit :library scan still forces a full rescan. The dirty check runs
  // asynchronously (chunked walk), so entering the library never blocks on
  // large folders; the checks are cancelled if the user leaves the view
  // before they finish.
  useEffect(() => {
    if (screen !== 'library') return;
    let cancelled = false;
    void (async () => {
      const stale: string[] = [];
      for (const folder of db.listLibraryFolders()) {
        if (cancelled) return;
        if (await folderNeedsRescan(db, folder)) stale.push(folder.path);
      }
      if (!cancelled && stale.length > 0) {
        void runLibraryScan(stale);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, db, runLibraryScan]);

  return { runLibraryScan, attachLibraryFolder };
}
