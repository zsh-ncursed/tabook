import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config } from '../../config/defaults.js';
import type { LibraryDb, CatalogRecord } from '../../db/db.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { Spinner } from '../components/Spinner.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { useMouseClicks } from '../mouse.js';
import { forceRedraw } from '../screenRefresh.js';
import { truncateW } from '../../utils/text.js';
import { fetchFeed, fetchOpenSearch, catalogAuth, OpdsError } from '../../opds/client.js';
import { parseOpenSearch, buildSearchUrl } from '../../opds/opensearch.js';
import type { OpdsFeed, OpdsEntry, OpdsFacet } from '../../opds/model.js';
import { pickAcquisitionLink } from '../../opds/model.js';
import { opdsDownloadQueue, type DownloadJob } from '../../opds/downloadQueue.js';

export interface OpdsViewProps {
  db: LibraryDb;
  config: Config;
  theme: Theme;
  notify: (message: string) => void;
  onExit: () => void;
  onHelp: () => void;
  onOpenDownloaded: (bookId: number, filePath: string) => void;
  inputDisabled?: boolean;
}

type Mode =
  | 'catalog-list'
  | 'browsing'
  | 'search'
  | 'loading'
  | 'error'
  | 'entry-detail'
  | 'downloads'
  | 'auth-username'
  | 'auth-password';

interface FeedHistoryEntry {
  feed: OpdsFeed;
  cursor: number;
  scrollOffset: number;
}

export function OpdsView(props: OpdsViewProps): React.JSX.Element {
  const {
    db,
    config,
    theme,
    notify,
    onExit,
    onHelp,
    onOpenDownloaded,
    inputDisabled = false,
  } = props;
  const [width, height] = useTerminalSize();
  // Navigation keys resolve through the configurable keymap like every other
  // view; only feed-specific verbs (d download, n next page, c catalogs, u
  // back) stay on fixed keys — they have no KeyAction.
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const [mode, setMode] = useState<Mode>('catalog-list');
  const [catalogs, setCatalogs] = useState<CatalogRecord[]>([]);
  const [catalogCursor, setCatalogCursor] = useState(0);
  const [activeCatalog, setActiveCatalog] = useState<CatalogRecord | null>(null);
  const [feedStack, setFeedStack] = useState<FeedHistoryEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<OpdsEntry | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // Re-render whenever the shared download queue changes (progress/status).
  const [, setQueueTick] = useState(0);
  const [downloadsCursor, setDownloadsCursor] = useState(0);
  const [downloadsReturn, setDownloadsReturn] = useState<Mode>('browsing');
  // OpenSearch discovery: sub-feeds often omit the rel="search" link while
  // the catalog root carries it. Captured from the first (root) feed of the
  // session so `/` keeps working deep inside a catalog.
  const [rootSearch, setRootSearch] = useState<{ href: string; base?: string } | undefined>(
    undefined,
  );
  const [authCatalog, setAuthCatalog] = useState<CatalogRecord | null>(null);
  const [authUsername, setAuthUsername] = useState('');
  const [authUrl, setAuthUrl] = useState('');

  const loadCatalogs = useCallback(() => {
    setCatalogs(db.listCatalogs());
  }, [db]);

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs, refreshTrigger]);

  useEffect(() => {
    return opdsDownloadQueue.subscribe(() => setQueueTick((t) => t + 1));
  }, []);

  const currentFeedEntry = feedStack.length > 0 ? feedStack[feedStack.length - 1] : null;
  const currentFeed = currentFeedEntry?.feed ?? null;

  // Live view of the shared background download queue.
  const queueJobs = opdsDownloadQueue.snapshot();
  const queueActive = opdsDownloadQueue.active;
  const currentJob = opdsDownloadQueue.current;
  const pendingCount = opdsDownloadQueue.pendingCount;

  const downloadsLabel = (() => {
    const cur = currentJob;
    if (cur) {
      const pct =
        cur.total && cur.total > 0 ? `${Math.floor((cur.received / cur.total) * 100)}% ` : '';
      const suffix = pendingCount > 0 ? ` (+${pendingCount})` : '';
      return `↓ ${pct}${truncateW(cur.title, 22)}${suffix}`;
    }
    return pendingCount > 0 ? `↓ ${pendingCount} queued` : undefined;
  })();

  // Flatten facets + entries into displayable rows
  const rows = useMemo(() => {
    if (!currentFeed) return [];
    const result: Array<
      | { kind: 'facet-group'; label: string }
      | { kind: 'facet'; facet: OpdsFacet }
      | { kind: 'entry'; entry: OpdsEntry }
    > = [];

    const grouped = new Map<string, OpdsFacet[]>();
    for (const facet of currentFeed.facets) {
      const arr = grouped.get(facet.group) ?? [];
      arr.push(facet);
      grouped.set(facet.group, arr);
    }
    for (const [group, facets] of grouped) {
      result.push({ kind: 'facet-group', label: group });
      for (const f of facets) {
        result.push({ kind: 'facet', facet: f });
      }
    }

    for (const entry of currentFeed.entries) {
      result.push({ kind: 'entry', entry });
    }
    return result;
  }, [currentFeed]);

  useEffect(() => {
    if (cursor >= rows.length && rows.length > 0) {
      setCursor(rows.length - 1);
    } else if (rows.length === 0) {
      setCursor(0);
    }
  }, [rows.length, cursor]);

  useEffect(() => {
    if (downloadsCursor >= queueJobs.length && queueJobs.length > 0) {
      setDownloadsCursor(queueJobs.length - 1);
    } else if (queueJobs.length === 0) {
      setDownloadsCursor(0);
    }
  }, [queueJobs.length, downloadsCursor]);

  const loadFeed = useCallback(
    async (href: string, base?: string, catalog?: CatalogRecord | null) => {
      const cat = catalog ?? activeCatalog;
      if (!cat) return;
      setMode('loading');
      try {
        const feed = await fetchFeed(href, { auth: catalogAuth(cat), base });
        // The first feed loaded for a catalog is its root — remember its
        // OpenSearch link so searches work from sub-feeds that omit it.
        setRootSearch(
          (prev) =>
            prev ?? (feed.searchHref ? { href: feed.searchHref, base: feed.url } : undefined),
        );
        setFeedStack((s) => [...s, { feed, cursor: 0, scrollOffset: 0 }]);
        setCursor(0);
        setScrollOffset(0);
        setMode('browsing');
      } catch (err) {
        if (err instanceof OpdsError && err.statusCode === 401) {
          setAuthCatalog(cat);
          setAuthUrl(href);
          setAuthUsername('');
          setMode('auth-username');
        } else {
          setErrorMsg(formatError(err));
          setMode('error');
        }
      }
    },
    [activeCatalog],
  );

  const retryWithAuth = useCallback(
    async (username: string, password: string) => {
      const cat = authCatalog;
      if (!cat) return;
      // Update the catalog credentials in DB so future requests use them
      db.updateCatalog(cat.id, { username, password });
      const updated = db.getCatalog(cat.id);
      if (updated) {
        setActiveCatalog(updated);
        setAuthCatalog(updated);
      }
      setMode('loading');
      try {
        const feed = await fetchFeed(authUrl, { auth: { username, password } });
        setRootSearch(
          (prev) =>
            prev ?? (feed.searchHref ? { href: feed.searchHref, base: feed.url } : undefined),
        );
        setFeedStack((s) => [...s, { feed, cursor: 0, scrollOffset: 0 }]);
        setCursor(0);
        setScrollOffset(0);
        setMode('browsing');
      } catch (err) {
        setErrorMsg(formatError(err));
        setMode('error');
      }
      setAuthCatalog(null);
      setAuthUsername('');
      setAuthUrl('');
    },
    [authCatalog, authUrl, db],
  );

  const openCatalog = useCallback(
    (catalog: CatalogRecord) => {
      setActiveCatalog(catalog);
      setFeedStack([]);
      // New catalog, new root: drop the previous catalog's search discovery.
      setRootSearch(undefined);
      void loadFeed(catalog.url, undefined, catalog);
    },
    [loadFeed],
  );

  const goBack = useCallback(() => {
    // Synchronous clear BEFORE the state change. Ink paints the new frame in
    // the same commit, so clear() here resets logUpdate's previousOutput and
    // guarantees the closing frame is always written (ponytail). Calling it
    // from a useEffect instead would run AFTER the paint and erase the fresh
    // frame, leaving a blank screen until the next keypress.
    forceRedraw();
    if (mode === 'entry-detail') {
      setSelectedEntry(null);
      setMode('browsing');
      return;
    }
    if (mode === 'search') {
      setMode('browsing');
      return;
    }
    if (mode === 'error') {
      setMode(feedStack.length > 0 ? 'browsing' : 'catalog-list');
      setErrorMsg('');
      return;
    }
    if (feedStack.length > 1) {
      // feedStack is a useCallback dep, so this closure is fresh; reading prev
      // here keeps the state update free of side effects (updaters must be pure).
      const prev = feedStack[feedStack.length - 2];
      setFeedStack((s) => s.slice(0, -1));
      if (prev) {
        setCursor(prev.cursor);
        setScrollOffset(prev.scrollOffset);
      }
      setMode('browsing');
    } else if (feedStack.length === 1) {
      setFeedStack([]);
      setActiveCatalog(null);
      setMode('catalog-list');
    } else {
      onExit();
    }
  }, [mode, feedStack, onExit]);

  const doSearch = useCallback(
    async (query: string) => {
      if (!activeCatalog || !currentFeed) return;
      // Prefer the current feed's own OpenSearch link; fall back to the one
      // discovered on the catalog root (many catalogs only advertise search
      // there). Relative hrefs/templates resolve against the feed that
      // advertised them.
      const search =
        currentFeed.searchHref !== undefined
          ? { href: currentFeed.searchHref, base: currentFeed?.url }
          : rootSearch;
      if (!search) {
        notify('This catalog has no search capability');
        return;
      }
      setMode('loading');
      try {
        const osdXml = await fetchOpenSearch(search.href, {
          auth: catalogAuth(activeCatalog),
          base: search.base,
        });
        const osd = parseOpenSearch(osdXml);
        const url = buildSearchUrl(osd, query);
        if (!url) {
          notify('Could not build search URL');
          setMode('browsing');
          return;
        }
        const feed = await fetchFeed(url, {
          auth: catalogAuth(activeCatalog),
          base: search.base,
        });
        setFeedStack((s) => [...s, { feed, cursor: 0, scrollOffset: 0 }]);
        setCursor(0);
        setScrollOffset(0);
        setMode('browsing');
      } catch (err) {
        setErrorMsg(formatError(err));
        setMode('error');
      }
    },
    [activeCatalog, currentFeed, rootSearch, notify],
  );

  // Adds a book to the shared background download queue. Never blocks input:
  // several entries can be queued and they download sequentially while the
  // user keeps browsing. Completion/failure surfaces via notify() (called from
  // the queue's onDone callback).
  const enqueueDownload = useCallback(
    (entry: OpdsEntry) => {
      if (!activeCatalog) return;
      const link = pickAcquisitionLink(entry.acquisitionLinks);
      if (!link) {
        notify('No downloadable format (EPUB/FB2) for this entry');
        return;
      }
      opdsDownloadQueue.enqueue({
        entry,
        auth: catalogAuth(activeCatalog),
        db,
        base: currentFeed?.url,
        onDone: (job) => {
          if (job.status === 'done') {
            notify(`Downloaded: ${job.result?.title ?? entry.title}`);
          } else if (job.status === 'failed') {
            notify(`Download failed: ${job.error ?? 'unknown error'}`);
          }
        },
      });
    },
    [activeCatalog, currentFeed, db, notify],
  );

  // `index` lets mouse double-clicks target a specific row directly (the
  // cursor state would be stale inside the synchronous click handler); callers
  // without an index use the current cursor.
  const handleSelect = useCallback(
    (index?: number) => {
      const idx = index ?? cursor;
      if (mode === 'catalog-list') {
        const cat = catalogs[idx];
        if (cat) void openCatalog(cat);
        return;
      }
      if (mode === 'browsing' && currentFeed) {
        const row = rows[idx];
        if (!row) return;
        if (row.kind === 'facet') {
          void loadFeed(row.facet.href, currentFeed?.url, activeCatalog);
          return;
        }
        if (row.kind === 'entry') {
          const entry = row.entry;
          if (entry.isAcquisition) {
            setSelectedEntry(entry);
            setMode('entry-detail');
          } else if (entry.subsectionHref) {
            void loadFeed(entry.subsectionHref, currentFeed?.url, activeCatalog);
          }
        }
      }
    },
    [
      mode,
      catalogs,
      catalogCursor,
      openCatalog,
      rows,
      cursor,
      currentFeed,
      activeCatalog,
      loadFeed,
    ],
  );

  const saveCurrentPosition = useCallback(() => {
    if (feedStack.length > 0) {
      setFeedStack((s) => {
        const copy = [...s];
        copy[copy.length - 1] = { ...copy[copy.length - 1]!, cursor, scrollOffset };
        return copy;
      });
    }
  }, [feedStack, cursor, scrollOffset]);

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (inputDisabled) return;
      const keyName = resolveKeyName(input, key);
      if (keyName === null) return;

      if (mode === 'downloads') {
        // d cancels the selected queued/in-flight job; x/esc closes the panel.
        if (keyName === 'd') {
          const job = queueJobs[downloadsCursor];
          if (job && (job.status === 'queued' || job.status === 'downloading')) {
            opdsDownloadQueue.cancel(job.id);
          }
          return;
        }
        if (keyName === 'x') {
          setMode(downloadsReturn);
          forceRedraw();
          return;
        }
        const action = resolver.feed(keyName);
        switch (action) {
          case 'move_cursor_down':
            setDownloadsCursor((c) => Math.min(queueJobs.length - 1, c + 1));
            break;
          case 'move_cursor_up':
            setDownloadsCursor((c) => Math.max(0, c - 1));
            break;
          case 'go_to_start':
            setDownloadsCursor(0);
            break;
          case 'go_to_end':
            setDownloadsCursor(queueJobs.length - 1);
            break;
          case 'select':
          case 'move_cursor_right': {
            const job = queueJobs[downloadsCursor];
            if (job?.status === 'done' && job.result) {
              onOpenDownloaded(job.result.bookId, job.result.filePath);
            }
            break;
          }
          case 'move_cursor_left':
          case 'back':
            setMode(downloadsReturn);
            forceRedraw();
            break;
          case 'help':
            onHelp();
            break;
          case 'quit':
            onExit();
            break;
          default:
            break;
        }
        return;
      }

      if (mode === 'catalog-list') {
        const action = resolver.feed(keyName);
        switch (action) {
          case 'move_cursor_down':
            setCatalogCursor((c) =>
              catalogs.length === 0 ? 0 : Math.min(catalogs.length - 1, c + 1),
            );
            break;
          case 'move_cursor_up':
            setCatalogCursor((c) => Math.max(0, c - 1));
            break;
          case 'select':
            handleSelect();
            break;
          case 'back':
          case 'quit':
            onExit();
            break;
          case 'help':
            onHelp();
            break;
          default:
            break;
        }
        return;
      }

      if (mode === 'browsing') {
        // Feed-specific verbs without a KeyAction (shown in the status bar /
        // Help): d queue download, x downloads panel, n/p next/prev feed page,
        // c catalog list, u back alias.
        if (keyName === 'd' && rows[cursor]?.kind === 'entry') {
          const entry = rows[cursor]!.entry;
          if (entry.isAcquisition) {
            enqueueDownload(entry);
          }
          return;
        }
        if (keyName === 'x') {
          setDownloadsReturn('browsing');
          setDownloadsCursor(0);
          setMode('downloads');
          forceRedraw();
          return;
        }
        if (keyName === 'n') {
          if (currentFeed?.nextHref) {
            void loadFeed(currentFeed.nextHref, currentFeed?.url, activeCatalog);
          }
          return;
        }
        if (keyName === 'p') {
          if (currentFeed?.prevHref) {
            void loadFeed(currentFeed.prevHref, currentFeed?.url, activeCatalog);
          }
          return;
        }
        if (keyName === 'c') {
          saveCurrentPosition();
          setFeedStack([]);
          setActiveCatalog(null);
          setMode('catalog-list');
          setRefreshTrigger((r) => r + 1);
          forceRedraw();
          return;
        }
        if (keyName === 'u') {
          goBack();
          return;
        }
        const action = resolver.feed(keyName);
        switch (action) {
          case 'move_cursor_down':
            saveCurrentPosition();
            setCursor((c) => Math.min(rows.length - 1, c + 1));
            break;
          case 'move_cursor_up':
            saveCurrentPosition();
            setCursor((c) => Math.max(0, c - 1));
            break;
          case 'go_to_start':
            saveCurrentPosition();
            setCursor(0);
            break;
          case 'go_to_end':
            saveCurrentPosition();
            setCursor(rows.length - 1);
            break;
          case 'page_down':
            saveCurrentPosition();
            setCursor((c) => Math.min(rows.length - 1, c + Math.max(1, height - 6)));
            break;
          case 'page_up':
            saveCurrentPosition();
            setCursor((c) => Math.max(0, c - Math.max(1, height - 6)));
            break;
          case 'select':
          case 'move_cursor_right':
            handleSelect();
            break;
          case 'move_cursor_left':
          case 'back':
            goBack();
            break;
          case 'search':
            // Allow the prompt even when only the root feed advertises search;
            // doSearch falls back to the root's OpenSearch link.
            if (currentFeed?.searchHref || rootSearch) {
              setMode('search');
            } else {
              notify('No search available in this catalog');
            }
            break;
          case 'help':
            onHelp();
            break;
          case 'quit':
            onExit();
            break;
          default:
            break;
        }
        return;
      }

      if (mode === 'entry-detail') {
        // d stays a fixed download verb (no KeyAction).
        if (keyName === 'd') {
          if (selectedEntry) {
            enqueueDownload(selectedEntry);
          }
          return;
        }
        if (keyName === 'x') {
          setDownloadsReturn('entry-detail');
          setDownloadsCursor(0);
          setMode('downloads');
          forceRedraw();
          return;
        }
        const action = resolver.feed(keyName);
        switch (action) {
          case 'select':
          case 'move_cursor_right':
            if (selectedEntry) {
              enqueueDownload(selectedEntry);
            }
            break;
          case 'move_cursor_left':
          case 'back':
            goBack();
            break;
          case 'help':
            onHelp();
            break;
          default:
            break;
        }
        return;
      }

      // 'error' mode: back returns to the previous view, help opens help.
      if (mode === 'error') {
        const action = resolver.feed(keyName);
        if (action === 'back') goBack();
        else if (action === 'help') onHelp();
        return;
      }
    },
    [
      inputDisabled,
      mode,
      resolver,
      catalogs.length,
      rows,
      cursor,
      height,
      currentFeed,
      activeCatalog,
      selectedEntry,
      queueJobs,
      downloadsCursor,
      downloadsReturn,
      rootSearch,
      goBack,
      onHelp,
      onExit,
      handleSelect,
      saveCurrentPosition,
      enqueueDownload,
      loadFeed,
      notify,
    ],
  );

  // Stable handler backed by a ref — prevents Ink useInput re-subscribe race.
  // Each cursor move would change handleInput's identity and trigger a raw-mode
  // round-trip; the ref keeps the useInput callback stable while the closure
  // always sees fresh state. Same pattern as LibraryView/ReaderView.
  const opdsInputRef = useRef(handleInput);
  opdsInputRef.current = handleInput;
  const dispatchRef = useInputDispatch(
    !inputDisabled &&
      mode !== 'search' &&
      mode !== 'loading' &&
      mode !== 'auth-username' &&
      mode !== 'auth-password',
  );
  dispatchRef.current = (input: string, key: Key) => opdsInputRef.current(input, key);

  const visibleCount = Math.max(3, height - 6);
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleCount / 2), Math.max(0, rows.length - visibleCount)),
  );
  const visibleRows = rows.slice(start, start + visibleCount);

  // Mouse: single click moves the cursor; a second click on the same row
  // within 350 ms activates it (open subsection / book / facet). Catalog list
  // and browsing rows both start one row below the 1-line header.
  const clickStateRef = useRef({ row: -1, time: 0 });
  const mouseStateRef = useRef({
    mode,
    start,
    rows,
    catalogs,
    inputDisabled,
    handleSelect,
    openCatalog,
  });
  mouseStateRef.current = {
    mode,
    start,
    rows,
    catalogs,
    inputDisabled,
    handleSelect,
    openCatalog,
  };
  useMouseClicks((click) => {
    if (click.button !== 'left' || !click.press) return;
    const s = mouseStateRef.current;
    if (s.inputDisabled) return;
    // Terminal Y is 1-based; the list starts one row below the header.
    const absolute = s.mode === 'catalog-list' ? click.y - 2 : s.start + (click.y - 2);
    const limit = s.mode === 'catalog-list' ? s.catalogs.length : s.rows.length;
    if (absolute < 0 || absolute >= limit) return;
    if (s.mode === 'browsing' && s.rows[absolute]?.kind === 'facet-group') return;
    const now = Date.now();
    const prev = clickStateRef.current;
    if (prev.row === absolute && now - prev.time < 350) {
      clickStateRef.current = { row: -1, time: 0 };
      if (s.mode === 'catalog-list') {
        s.openCatalog(s.catalogs[absolute]!);
      } else {
        setCursor(absolute);
        s.handleSelect(absolute);
      }
    } else {
      clickStateRef.current = { row: absolute, time: now };
      if (s.mode === 'catalog-list') setCatalogCursor(absolute);
      else setCursor(absolute);
    }
  });

  const header = activeCatalog ? activeCatalog.name : 'OPDS Catalogs';
  const subHeader = currentFeed?.title;
  const statusLeft = mode === 'catalog-list' ? 'OPDS' : (activeCatalog?.name ?? 'OPDS');

  // "page 2/5" indicator derived from the OpenSearch pagination metadata the
  // feed carries (startIndex is 1-based; itemsPerPage/totalResults optional).
  const pageIndicator = (() => {
    const feed = currentFeed;
    if (!feed || feed.startIndex === undefined || !feed.itemsPerPage || feed.itemsPerPage <= 0) {
      return null;
    }
    const page = Math.floor((feed.startIndex - 1) / feed.itemsPerPage) + 1;
    if (feed.totalResults !== undefined && feed.totalResults >= 0) {
      const total = Math.max(1, Math.ceil(feed.totalResults / feed.itemsPerPage));
      return `page ${page}/${total}`;
    }
    return feed.nextHref || feed.prevHref ? `page ${page}…` : `page ${page}`;
  })();

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text color={theme.colors.heading} bold>
            {header}
          </Text>
          {subHeader ? <Text color={theme.colors.dim}> · {subHeader}</Text> : null}
          {currentFeed?.entries.length ? (
            <Text color={theme.colors.dim}> · {currentFeed.entries.length} entries</Text>
          ) : null}
          {pageIndicator ? <Text color={theme.colors.dim}> · {pageIndicator}</Text> : null}
          {queueActive ? <Text color={theme.colors.accent}> · downloading…</Text> : null}
        </Box>
      </Box>

      {mode === 'downloads' ? (
        <DownloadsList
          theme={theme}
          width={width}
          height={height}
          jobs={queueJobs}
          cursor={downloadsCursor}
        />
      ) : mode === 'catalog-list' ? (
        <CatalogList catalogs={catalogs} cursor={catalogCursor} theme={theme} width={width} />
      ) : mode === 'loading' ? (
        <Box paddingX={2} paddingY={1}>
          <Spinner label="Loading" theme={theme} />
        </Box>
      ) : mode === 'error' ? (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <Text color={theme.colors.error ?? theme.colors.accent}>Error: {errorMsg}</Text>
          <Text color={theme.colors.dim}>esc — back</Text>
        </Box>
      ) : mode === 'entry-detail' && selectedEntry ? (
        <Box flexDirection="column">
          <EntryDetail entry={selectedEntry} theme={theme} width={width} height={height} />
          {currentJob?.title === selectedEntry.title ? (
            <Box paddingX={2}>
              <Spinner label="Downloading" theme={theme} />
            </Box>
          ) : null}
        </Box>
      ) : rows.length === 0 ? (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <Text color={theme.colors.text}>This feed is empty.</Text>
          <Text color={theme.colors.dim}>esc — back</Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          {visibleRows.map((row, i) => {
            const absolute = start + i;
            const selected = absolute === cursor;
            if (row.kind === 'facet-group') {
              return (
                <Text key={`fg-${absolute}`} color={theme.colors.accent} bold>
                  {' '}
                  {row.label}
                </Text>
              );
            }
            if (row.kind === 'facet') {
              const label = `${row.facet.active ? '● ' : '  '}${row.facet.title}${row.facet.count ? ` (${row.facet.count})` : ''}`;
              return (
                <Text
                  key={`f-${absolute}`}
                  color={selected ? theme.colors.accent : theme.colors.dim}
                  bold={selected}
                >
                  {selected ? '▸ ' : '  '}
                  {label}
                </Text>
              );
            }
            const entry = row.entry;
            const titleW = Math.max(10, width - 30);
            const title = truncateW(entry.title, titleW);
            const author = entry.authors.length > 0 ? entry.authors[0]!.name : '';
            const authorTrunc = truncateW(author, 20);
            const marker = entry.isAcquisition ? '📚' : '📁';
            return (
              <Box key={`e-${absolute}`} flexDirection="row">
                <Text color={selected ? theme.colors.accent : theme.colors.text} bold={selected}>
                  {selected ? '▸ ' : '  '}
                </Text>
                <Text color={selected ? theme.colors.accent : theme.colors.text} bold={selected}>
                  {marker} {title}
                </Text>
                {authorTrunc ? <Text color={theme.colors.dim}> — {authorTrunc}</Text> : null}
              </Box>
            );
          })}
        </Box>
      )}

      {mode === 'search' ? (
        <Box paddingX={1} flexDirection="column">
          <TextPrompt
            theme={theme}
            prefix="search: "
            placeholder="query"
            onSubmit={(value) => {
              void doSearch(value);
            }}
            onCancel={() => {
              setMode('browsing');
              forceRedraw();
            }}
          />
        </Box>
      ) : null}

      {mode === 'auth-username' ? (
        <Box paddingX={1} flexDirection="column">
          <Text color={theme.colors.accent} bold>
            Authentication required (HTTP 401)
          </Text>
          <Text color={theme.colors.dim}>Catalog: {authCatalog?.name ?? 'Unknown'}</Text>
          <TextPrompt
            theme={theme}
            prefix="username: "
            placeholder="username"
            initialValue={authUsername}
            onSubmit={(value) => {
              setAuthUsername(value);
              setMode('auth-password');
            }}
            onCancel={() => {
              setAuthCatalog(null);
              setMode('catalog-list');
              forceRedraw();
            }}
          />
        </Box>
      ) : null}

      {mode === 'auth-password' ? (
        <Box paddingX={1} flexDirection="column">
          <Text color={theme.colors.accent} bold>
            Password for {authUsername}
          </Text>
          <TextPrompt
            theme={theme}
            prefix="password: "
            placeholder="password (leave empty for none)"
            secret
            onSubmit={(value) => {
              void retryWithAuth(authUsername, value);
            }}
            onCancel={() => {
              setAuthCatalog(null);
              setAuthUsername('');
              setMode('catalog-list');
              forceRedraw();
            }}
          />
        </Box>
      ) : null}

      <StatusBar
        theme={theme}
        statusbar={config.statusbar}
        data={{
          title: statusLeft,
          downloads: downloadsLabel,
          hint:
            mode === 'catalog-list'
              ? 'j/k navigate · enter open · ? help · q quit'
              : mode === 'browsing'
                ? 'j/k · enter/l open · d download · x downloads · / search · u/h up · n next · p prev · c catalogs · ? help'
                : mode === 'entry-detail'
                  ? 'enter/d/l download · x downloads · h/esc back · ? help'
                  : mode === 'downloads'
                    ? 'j/k · enter open done · d cancel · x/esc close · ? help'
                    : mode === 'error'
                      ? '? help · esc back'
                      : '',
        }}
      />
    </Box>
  );
}

function CatalogList(props: {
  catalogs: CatalogRecord[];
  cursor: number;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const { catalogs, cursor, theme, width } = props;
  if (catalogs.length === 0) {
    return (
      <Box paddingX={2} paddingY={2} flexDirection="column">
        <Text color={theme.colors.text}>No OPDS catalogs configured.</Text>
        <Text color={theme.colors.dim}>Add one via SQLite or a future :opds add command.</Text>
      </Box>
    );
  }
  const nameW = Math.max(10, width - 40);
  return (
    <Box flexDirection="column" paddingX={1}>
      {catalogs.map((cat, i) => {
        const selected = i === cursor;
        const name = truncateW(cat.name, nameW);
        const url = truncateW(cat.url, 35);
        return (
          <Box key={cat.id} flexDirection="row">
            <Text color={selected ? theme.colors.accent : theme.colors.text} bold={selected}>
              {selected ? '▸ ' : '  '}
            </Text>
            <Text color={selected ? theme.colors.accent : theme.colors.text} bold={selected}>
              {name}
            </Text>
            <Text color={theme.colors.dim}> — {url}</Text>
            {cat.username ? <Text color={theme.colors.dim}> · 🔒</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

function DownloadsList(props: {
  theme: Theme;
  width: number;
  height: number;
  jobs: DownloadJob[];
  cursor: number;
}): React.JSX.Element {
  const { theme, width, height, jobs, cursor } = props;
  if (jobs.length === 0) {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column">
        <Text color={theme.colors.text}>No downloads.</Text>
        <Text color={theme.colors.dim}>Press d on a book to queue it. esc — close</Text>
      </Box>
    );
  }
  const visibleCount = Math.max(3, height - 6);
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleCount / 2), Math.max(0, jobs.length - visibleCount)),
  );
  const visible = jobs.slice(start, start + visibleCount);
  const titleW = Math.max(10, width - 40);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((job, i) => {
        const absolute = start + i;
        const selected = absolute === cursor;
        const color = selected ? theme.colors.accent : theme.colors.text;
        const status = jobStatusText(job);
        const statusColor =
          job.status === 'done'
            ? theme.colors.link
            : job.status === 'failed'
              ? (theme.colors.error ?? theme.colors.dim)
              : theme.colors.dim;
        return (
          <Box key={job.id} flexDirection="row">
            <Text color={color} bold={selected}>
              {selected ? '▸ ' : '  '}
            </Text>
            <Text color={color} bold={selected}>
              {truncateW(job.title, titleW)}
            </Text>
            <Text color={statusColor}> — {status}</Text>
            {job.error ? <Text color={theme.colors.dim}> ({truncateW(job.error, 30)})</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

function jobStatusText(job: DownloadJob): string {
  switch (job.status) {
    case 'queued':
      return 'queued';
    case 'downloading':
      if (job.total && job.total > 0) {
        return `${Math.floor((job.received / job.total) * 100)}%`;
      }
      return 'downloading…';
    case 'done':
      return '✓ done';
    case 'failed':
      return '✗ failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function EntryDetail(props: {
  entry: OpdsEntry;
  theme: Theme;
  width: number;
  height: number;
}): React.JSX.Element {
  const { entry, theme, width, height } = props;
  const textWidth = Math.max(30, width - 4);
  const lines: Array<{ label: string; value: string }> = [];
  lines.push({ label: 'Title', value: entry.title });
  if (entry.authors.length > 0) {
    lines.push({ label: 'Author', value: entry.authors.map((a) => a.name).join(', ') });
  }
  if (entry.language) lines.push({ label: 'Language', value: entry.language });
  if (entry.publisher) lines.push({ label: 'Publisher', value: entry.publisher });
  if (entry.issued) lines.push({ label: 'Year', value: entry.issued });
  if (entry.identifier) lines.push({ label: 'ISBN', value: entry.identifier });
  const acqLink = pickAcquisitionLink(entry.acquisitionLinks);
  if (acqLink?.type) {
    lines.push({ label: 'Format', value: acqLink.type });
  }
  if (entry.categories.length > 0) {
    lines.push({ label: 'Subjects', value: entry.categories.map((c) => c.term).join(', ') });
  }
  const summary = entry.summary ?? entry.content ?? '';
  const summaryLines = wrapText(summary, textWidth);
  const maxLines = Math.max(5, height - lines.length - 8);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {lines.map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text color={theme.colors.dim}>{line.label}: </Text>
          <Text color={theme.colors.text} wrap="truncate">
            {truncateW(line.value, textWidth - line.label.length - 2)}
          </Text>
        </Box>
      ))}
      {summary ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.colors.dim}>Summary:</Text>
          {summaryLines.slice(0, maxLines).map((line, i) => (
            <Text key={i} color={theme.colors.text}>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.colors.accent} bold>
          Press d or enter to download · esc to go back
        </Text>
      </Box>
    </Box>
  );
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function formatError(err: unknown): string {
  if (err instanceof OpdsError) {
    return err.statusCode ? `${err.statusCode}: ${err.message}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
