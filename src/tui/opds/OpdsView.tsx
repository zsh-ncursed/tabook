import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config } from '../../config/defaults.js';
import type { LibraryDb, CatalogRecord } from '../../db/db.js';
import { resolveKeyName } from '../keymap.js';
import { StatusBar } from '../components/StatusBar.js';
import { TextPrompt } from '../components/TextPrompt.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { forceRedraw } from '../screenRefresh.js';
import { truncateW } from '../../utils/text.js';
import { fetchFeed, fetchOpenSearch, catalogAuth, OpdsError } from '../../opds/client.js';
import { downloadAndSave } from '../../opds/download.js';
import { parseOpenSearch, buildSearchUrl } from '../../opds/opensearch.js';
import type { OpdsFeed, OpdsEntry, OpdsFacet } from '../../opds/model.js';
import { pickAcquisitionLink } from '../../opds/model.js';

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

type Mode = 'catalog-list' | 'browsing' | 'search' | 'loading' | 'error' | 'entry-detail' | 'auth-username' | 'auth-password';

interface FeedHistoryEntry {
  feed: OpdsFeed;
  cursor: number;
  scrollOffset: number;
}

export function OpdsView(props: OpdsViewProps): React.JSX.Element {
  const { db, theme, notify, onExit, onHelp, onOpenDownloaded, inputDisabled = false } = props;
  const [width, height] = useTerminalSize();
  const [mode, setMode] = useState<Mode>('catalog-list');
  const [catalogs, setCatalogs] = useState<CatalogRecord[]>([]);
  const [catalogCursor, setCatalogCursor] = useState(0);
  const [activeCatalog, setActiveCatalog] = useState<CatalogRecord | null>(null);
  const [feedStack, setFeedStack] = useState<FeedHistoryEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<OpdsEntry | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [authCatalog, setAuthCatalog] = useState<CatalogRecord | null>(null);
  const [authUsername, setAuthUsername] = useState('');
  const [authUrl, setAuthUrl] = useState('');

  const loadCatalogs = useCallback(() => {
    setCatalogs(db.listCatalogs());
  }, [db]);

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs, refreshTrigger]);

  const currentFeedEntry = feedStack.length > 0 ? feedStack[feedStack.length - 1] : null;
  const currentFeed = currentFeedEntry?.feed ?? null;

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

  const loadFeed = useCallback(
    async (href: string, base?: string, catalog?: CatalogRecord | null) => {
      const cat = catalog ?? activeCatalog;
      if (!cat) return;
      setMode('loading');
      try {
        const feed = await fetchFeed(href, { auth: catalogAuth(cat), base });
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
      void loadFeed(catalog.url, undefined, catalog);
    },
    [loadFeed],
  );

  const goBack = useCallback(() => {
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
      const searchHref = currentFeed.searchHref;
      if (!searchHref) {
        notify('This feed has no search capability');
        return;
      }
      setMode('loading');
      try {
        const osdXml = await fetchOpenSearch(searchHref, {
          auth: catalogAuth(activeCatalog),
          base: currentFeed?.url,
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
          base: currentFeed?.url,
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
    [activeCatalog, currentFeed, notify],
  );

  const downloadEntry = useCallback(
    async (entry: OpdsEntry) => {
      if (!activeCatalog) return;
      const link = pickAcquisitionLink(entry.acquisitionLinks);
      if (!link) {
        notify('No downloadable format (EPUB/FB2) for this entry');
        return;
      }
      setDownloading(true);
      try {
        const result = await downloadAndSave(entry, {
          auth: catalogAuth(activeCatalog),
          db,
          base: currentFeed?.url,
        });
        notify(`Downloaded: ${result.title}`);
        onOpenDownloaded(result.bookId, result.filePath);
      } catch (err) {
        notify(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setDownloading(false);
      }
    },
    [activeCatalog, currentFeed, db, notify, onOpenDownloaded],
  );

  const handleSelect = useCallback(() => {
    if (mode === 'catalog-list') {
      const cat = catalogs[catalogCursor];
      if (cat) void openCatalog(cat);
      return;
    }
    if (mode === 'browsing' && currentFeed) {
      const row = rows[cursor];
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
  }, [mode, catalogs, catalogCursor, openCatalog, rows, cursor, currentFeed, activeCatalog, loadFeed]);

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
      if (inputDisabled || downloading) return;
      const keyName = resolveKeyName(input, key);
      if (keyName === null) return;

      if (keyName === 'escape') {
        goBack();
        return;
      }
      if (keyName === '?' || (keyName === 'shift+/' && input === '/')) {
        onHelp();
        return;
      }

      if (mode === 'catalog-list') {
        switch (keyName) {
          case 'j':
          case 'down':
            setCatalogCursor((c) => (catalogs.length === 0 ? 0 : Math.min(catalogs.length - 1, c + 1)));
            break;
          case 'k':
          case 'up':
            setCatalogCursor((c) => Math.max(0, c - 1));
            break;
          case 'enter':
            handleSelect();
            break;
          case 'q':
            onExit();
            break;
          default:
            break;
        }
        return;
      }

      if (mode === 'browsing') {
        switch (keyName) {
          case 'j':
          case 'down':
            saveCurrentPosition();
            setCursor((c) => Math.min(rows.length - 1, c + 1));
            break;
          case 'k':
          case 'up':
            saveCurrentPosition();
            setCursor((c) => Math.max(0, c - 1));
            break;
          case 'g':
            saveCurrentPosition();
            setCursor(0);
            break;
          case 'G':
            saveCurrentPosition();
            setCursor(rows.length - 1);
            break;
          case 'pagedown':
          case 'space':
            saveCurrentPosition();
            setCursor((c) => Math.min(rows.length - 1, c + Math.max(1, height - 6)));
            break;
          case 'pageup':
            saveCurrentPosition();
            setCursor((c) => Math.max(0, c - Math.max(1, height - 6)));
            break;
          case 'enter':
            handleSelect();
            break;
          case '/':
            if (currentFeed?.searchHref) {
              setMode('search');
            } else {
              notify('No search available in this feed');
            }
            break;
          case 'd':
            if (rows[cursor]?.kind === 'entry') {
              const entry = rows[cursor]!.entry;
              if (entry.isAcquisition) {
                void downloadEntry(entry);
              }
            }
            break;
          case 'u':
            goBack();
            break;
          case 'c':
            saveCurrentPosition();
            setFeedStack([]);
            setActiveCatalog(null);
            setMode('catalog-list');
            setRefreshTrigger((r) => r + 1);
            break;
          case 'n':
            if (currentFeed?.nextHref) {
              void loadFeed(currentFeed.nextHref, currentFeed?.url, activeCatalog);
            }
            break;
          case 'q':
            onExit();
            break;
          default:
            break;
        }
        return;
      }

      if (mode === 'entry-detail') {
        switch (keyName) {
          case 'enter':
          case 'd':
            if (selectedEntry) {
              void downloadEntry(selectedEntry);
              setSelectedEntry(null);
              setMode('browsing');
            }
            break;
          default:
            break;
        }
        return;
      }
    },
    [
      inputDisabled,
      downloading,
      mode,
      catalogs.length,
      rows,
      cursor,
      height,
      currentFeed,
      activeCatalog,
      selectedEntry,
      goBack,
      onHelp,
      onExit,
      handleSelect,
      saveCurrentPosition,
      downloadEntry,
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
    !inputDisabled && mode !== 'search' && mode !== 'loading' && mode !== 'auth-username' && mode !== 'auth-password',
  );
  dispatchRef.current = (input: string, key: Key) => opdsInputRef.current(input, key);

  useEffect(() => {
    forceRedraw();
  }, [mode, feedStack.length]);

  const visibleCount = Math.max(3, height - 6);
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleCount / 2), Math.max(0, rows.length - visibleCount)),
  );
  const visibleRows = rows.slice(start, start + visibleCount);

  const header = activeCatalog ? activeCatalog.name : 'OPDS Catalogs';
  const subHeader = currentFeed?.title;
  const statusLeft = mode === 'catalog-list' ? 'OPDS' : activeCatalog?.name ?? 'OPDS';

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text color={theme.colors.heading} bold>
            {header}
          </Text>
          {subHeader ? (
            <Text color={theme.colors.dim}>
              {' '}
              · {subHeader}
            </Text>
          ) : null}
          {currentFeed?.entries.length ? (
            <Text color={theme.colors.dim}>
              {' '}
              · {currentFeed.entries.length} entries
            </Text>
          ) : null}
          {downloading ? <Text color={theme.colors.accent}> · downloading…</Text> : null}
        </Box>
      </Box>

      {mode === 'catalog-list' ? (
        <CatalogList
          catalogs={catalogs}
          cursor={catalogCursor}
          theme={theme}
          width={width}
        />
      ) : mode === 'loading' ? (
        <Box paddingX={2} paddingY={1}>
          <Text color={theme.colors.dim}>Loading…</Text>
        </Box>
      ) : mode === 'error' ? (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <Text color={theme.colors.error ?? theme.colors.accent}>Error: {errorMsg}</Text>
          <Text color={theme.colors.dim}>esc — back</Text>
        </Box>
      ) : mode === 'entry-detail' && selectedEntry ? (
        <EntryDetail entry={selectedEntry} theme={theme} width={width} height={height} />
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
                <Text key={`f-${absolute}`} color={selected ? theme.colors.accent : theme.colors.dim} bold={selected}>
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
                {authorTrunc ? (
                  <Text color={theme.colors.dim}> — {authorTrunc}</Text>
                ) : null}
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
            onCancel={() => setMode('browsing')}
          />
        </Box>
      ) : null}

      {mode === 'auth-username' ? (
        <Box paddingX={1} flexDirection="column">
          <Text color={theme.colors.accent} bold>
            Authentication required (HTTP 401)
          </Text>
          <Text color={theme.colors.dim}>
            Catalog: {authCatalog?.name ?? 'Unknown'}
          </Text>
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
            }}
          />
        </Box>
      ) : null}

      <StatusBar
        theme={theme}
        left={statusLeft}
        right={
          mode === 'catalog-list'
            ? 'j/k navigate · enter open · q quit'
            : mode === 'browsing'
              ? 'j/k navigate · enter open · d download · / search · u up · n next · c catalogs'
              : mode === 'entry-detail'
                ? 'enter/d download · esc back'
                : ''
        }
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
        <Text color={theme.colors.dim}>
          Add one via SQLite or a future :opds add command.
        </Text>
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
            {cat.username ? (
              <Text color={theme.colors.dim}> · 🔒</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
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