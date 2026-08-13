# Architecture

`tabook` is a TypeScript TUI e-book reader. It parses FB2 and EPUB into a
format-neutral block model, lays that model out into styled lines, and renders
them with React + Ink. A SQLite database backs the library, reading progress,
bookmarks and statistics.

The hot paths — format parsing, layout, in-book search and the **database** —
live in a **Rust core** (`crates/tabook-native`) exposed as a napi binding;
`src/native.ts` delegates to it when available and falls back to the pure-TS
implementations otherwise.

- Runtime: Node.js ≥ 18
- UI: React 18 + Ink
- Native core: Rust (napi cdylib, `crates/tabook-native`)
- Formats: `fast-xml-parser`, `adm-zip`, custom encoding detection
- Storage: SQLite via `rusqlite` (bundled) in the Rust core
- Config: TOML (`smol-toml`)
- Tests: Vitest + `cargo test`; style: ESLint + Prettier; build: `tsc`

## Module map

```
src/
  index.ts          Public package entry (re-exports for embedding)
  cli/              Commander arg parsing, Ink render, process lifecycle
  config/           Defaults, TOML parsing, keybinding normalization
  db/               SQLite facade (native rusqlite; better-sqlite3 dev fallback)
  formats/          Format parsers and the shared document model
    model.ts        Block / Inline types shared by all parsers
    inline.ts       Inline-style parsing (bold, italic, links, ...)
    xml.ts          XML helpers on top of fast-xml-parser
    encoding.ts     BOM / declared-encoding detection, decoding
    fb2/            FB2 (and .fb2.zip) parser
    epub/           EPUB 2/3 parser, XHTML block conversion
  native.ts         napi binding loader + delegation (TS fallbacks)
  renderer/         Document → screen layout
    layout.ts       Block → wrapped, styled lines (measure, hyphenation)
    blocks.ts       Block → plain text helpers
    simplify.ts     Simplified-mode flattening
  search/           In-book full-text index with Unicode folding
  themes/           Built-in color themes
  tui/              Ink components (the app itself)
  utils/            text, paths, zip, errors
crates/
  tabook-native/    Rust core: FB2/EPUB parsers, layout, search (napi)
    src/fb2/        FB2 parser
    src/epub/       EPUB 2/3 parser
    src/renderer/   Layout engine (port of src/renderer/layout.ts)
    src/search.rs   In-book search index (port of src/search/index.ts)
```

## Data flow

```
file on disk
  → cli/main.ts (Commander options, config, theme)
  → formats/parseBookFile()          (detect FB2 / FB2.zip / EPUB)
  → formats/*/parser.ts              (XML → Block model; native when the
  |                                  binding is present)
  → renderer/layout.ts BookLayout    (Block + config → wrapped lines; native
  |                                  BookLayout class when available)
  → tui/reader/readerModel.ts        (viewport, pages, search, progress)
  → tui/renderLines.tsx              (styled line → Ink <Text>)
  → Ink render
```

### The document model

Parsers normalize everything into a small, format-neutral model
(`src/formats/model.ts`):

- **Blocks:** `paragraph`, `heading`, `quote`, `epigraph`, `annotation`,
  `list` (with nesting), `table`, `poem` (stanzas of lines), `image`, `empty`.
- **Inlines:** `text`, `bold`, `italic`, `underline`, `strike`, `link`, `code`,
  `image`, `lineBreak`.

A `Book` is the parsed result: metadata (title, authors, series, genres,
annotation, cover), `content: Block[]`, a table of contents and a resources
map (image key → bytes). All parsers (FB2, EPUB) produce this same shape, so
downstream code — layout, search, rendering — never touches XML.

## Rendering pipeline

`BookLayout` (`src/renderer/layout.ts`) is the core engine:

1. `layoutBlock()` converts each `Block` into wrapped text lines, applying the
   configured `measure`, `line_spacing`, `paragraph_indent` and `paragraph_spacing`.
2. `wrapSpans()` breaks long lines at word boundaries, optionally hyphenating
   (a vowel→consonant heuristic when `typography.hyphenation` is on). It
   returns both the styled lines and `originalLengths`, so callers can map
   display positions back to offsets in the original text.
3. The reader (`src/tui/reader/readerModel.ts`) holds the layout, the current
   line and the viewport size. It renders only the visible slice of lines and
   keeps a per-block highlight map for search matches — highlights are
   computed lazily for on-screen blocks only.
4. `renderLines.tsx` maps each styled line to an Ink `<Text>` with the theme
   colors; `imageLayer.ts` draws book images over the viewport through
   `ueberzugpp` when the terminal supports it.

### Page model

The reader works in **lines**, not pages: `pageHeight()` derives from the
terminal height, `viewportLines()` returns the slice for the current position.
`goToPercent()` maps a percentage to an exact char offset and jumps to the
block containing it. Progress is stored as a char offset, so reopening a book
restores the same text position regardless of terminal size.

## TUI structure

The app is a single Ink tree rooted at `src/tui/App.tsx`:

- `App.tsx` — top-level state: active view (library / reader), theme, live
  config, session lifecycle. Handles `:config edit` (temporarily leaves raw
  mode to run `$EDITOR`, then reloads the config live).
- `library/LibraryView.tsx` — book cards, search/filter, grouping by series,
  book detail modal.
- `reader/ReaderView.tsx` — one always-on `useInput` that dispatches keys
  through a ref (`dispatchRef`) by current mode; `keymap.ts` resolves key
  sequences (`gg`, `Ctrl+D`, …) to actions.
- `components/` — `Modal`, `ListModal` (TOC/bookmarks), `TextPrompt`,
  `StatusBar`.
- `screenRefresh.ts` — `forceRedraw()` workaround for Ink's logUpdate
  suppressing byte-identical closing frames.

Input flows: raw keypress → `ReaderView.handleMainInput` → `dispatchChunk`
(code-point safe) → `keymap.createActionResolver().feed()` → `KeyAction` →
session methods → `forceTick()` re-render.

## Search

`BookSearchIndex` (`src/search/index.ts`) builds a fold map per book: each
character is lowercased, NFKD-decomposed and stripped of combining marks, so
`İstanbul` matches `istanbul`. All match offsets are stored in original-text
coordinates; highlights are generated per block on demand. Searching is
in-memory and instantaneous after the first index build. With the native
binding present the index lives in Rust (`crates/tabook-native/src/search.rs`)
and offsets are char-based, so multi-byte scripts (Cyrillic) match correctly.

## Native core

The Rust core is a napi cdylib built by `npm run build:native` into
`crates/tabook-native/index.linux-x64-gnu.node`. `src/native.ts` tries to load
it and exposes `native` (or `null`). Callers gate on it:

- `formats/index.ts` → `parseBookFile`/`parseFb2Buffer`/`parseEpubBuffer`
- `renderer/layout.ts` → `BookLayout` (napi class) vs `TsBookLayout`
- `search/index.ts` → `BookSearchIndex` (napi class) vs TS index
- `opds/parser.ts` → `parseOpdsAtom` (OPDS feed parsing)

Each native implementation keeps a byte-for-byte-compatible TS fallback, so
the app runs everywhere Node does — just slower. Rust behavior is pinned by
`cargo test` (`npm run test:native`); the TS coverage thresholds assume the
core paths are covered there.

## Config & keybindings

`src/config/config.ts`:

1. `defaultConfig()` — full defaults (`src/config/defaults.ts`).
2. `parseTomlConfig()` — overlays the TOML file, clamps numeric ranges,
   validates actions, collects warnings (unknown keys, unknown themes,
   ignored values).
3. `normalizeKeybindings()` — case-insensitive key normalization; a key bound
   twice to different actions raises `KeybindingConflictError`.
4. `serializeConfig()` — round-trips a config back to TOML (used by `:theme`
   persistence and `:config edit` reload).

## Database

`src/db/db.ts` exposes a `LibraryDb` facade. With the native module present it
delegates to the rusqlite-backed `LibraryDb` in the Rust core; otherwise it
falls back to a better-sqlite3 implementation (kept for development and for
runners without a prebuilt `.node`):

- **books** — metadata, file path, added/updated timestamps.
- **bookmarks** — position (char offset), label, created_at.
- **reading_sessions** — start/end times, pages read (stats per book).
- **history** — open events and last-opened tracking.

Reading progress is flushed on close and on SIGTERM/SIGHUP/SIGINT, so a
killed process does not lose the current position.

## Error handling

`src/utils/errors.ts` defines a small hierarchy over `AppError`:
`ParseError` (bad books), `ConfigError` (bad config/keybindings),
`DatabaseError` (DB failures). `messageOf()` defensively extracts messages
from arbitrary thrown values. Bad books fail with a descriptive message
instead of crashing; the CLI prints it and exits non-zero.

## Testing conventions

Vitest with colocated `*.test.ts` files:

- `formats/*.test.ts` — parser units (FB2/EPUB/XML/encoding) against fixtures
  in `formats/test-utils.ts`.
- `renderer/*.test.ts` — layout/simplify/blocks behavior.
- `tui/reader/readerModel.test.ts`, `tui/library/LibraryView.test.tsx` —
  session navigation, grouping, search offsets.
- `db/db.test.ts` — in-memory schema and queries.
- `config/config.test.ts` — TOML parsing, clamping, keybinding conflicts.
- `utils/*.test.ts` — text/zip/paths helpers.

Run: `npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run build`.

## Build & distribution

`npm run build` compiles to `dist/`; `npm run build:native` compiles the Rust
core into the napi binding (a cargo release build, no Node tooling needed).
The `bin` field exposes `tabook`. `PKGBUILD` + `.github/workflows/aur-publish.yml`
publish to AUR on `v*` tags; the AUR build compiles the native module from
source per architecture; `docs/AUR.md` documents the release process.
