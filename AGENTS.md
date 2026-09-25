# AGENTS.md

## Native Rust core

`crates/tabook-native` holds the Rust core — FB2/EPUB parsing, the layout
engine, in-book search and the SQLite library database (rusqlite) — exposed to
TypeScript as a napi binding
(`crates/tabook-native/index.linux-<arch>-gnu.node`, arch-specific name).
`src/native.ts` loads it and
delegates to it; when the binding is missing the pure-TS implementations in
`src/formats/`, `src/renderer/`, `src/search/` and `src/opds/parser.ts` are
used as fallbacks. The database has **no** TS fallback: the schema and
migrations live only in `crates/tabook-native/src/db.rs`, and `LibraryDb`
fails fast with a build hint when the binding is unavailable. (`better-sqlite3`
remains in devDependencies purely as a test instrument for staging legacy DB
states — it is never loaded at runtime.)

- Rebuild the binding: `npm run build:native` (cargo release build)
- Rust tests: `npm run test:native` — ALWAYS run these when touching `crates/`.
  The TS coverage thresholds in `vitest.config.ts` assume the Rust core is
  covered here (the `.node` binding is committed and loaded in tests).
- Keep the committed `.node` binary in sync with the `crates/` sources.

## TUI Verification Rule

For TUI features relying on raw mode, terminal input, the kitty graphics
protocol (src/tui/kittyLayer.ts) or external processes (xclip, xsel,
wl-paste, ueberzugpp), `npm test` + `tsc` is NOT sufficient.

**Mandatory after any change to input handling or external process integration:**

1. Build the package (`npm run build`)
2. Install it (`sudo pacman -U <pkg.tar.zst>`)
3. Launch in a **real terminal** and manually verify the feature
4. Only then claim "done"

`tsc clean + tests pass` proves compilation and logic, not runtime behavior.
Raw-mode key interception, clipboard reads, and image overlays (both the
native kitty protocol and ueberzugpp) cannot be verified by unit tests —
they need a live terminal.

## Release packaging

The AUR package must NOT compile anything: the PKGBUILD downloads a small
prebuilt tarball (single-file esbuild bundle + stripped Rust `.node` — which
also owns the SQLite DB via rusqlite) attached to the GitHub Release.

- Build the release tarball: `node scripts/package-release.mjs`
  (`TARGET_ARCH=x64|arm64` to cross-build; output in `build/`)
- CI: `.github/workflows/release.yml` builds x64+arm64 assets on `v*` tags and
  attaches them to the release; `.github/workflows/aur-publish.yml` runs after
  it, fills the real sha256 hashes into the PKGBUILD placeholders
  (`__SHA256_X64__` / `__SHA256_ARM64__`) and pushes to AUR.
- Local package test: copy the tarball into `/tmp/opencode/tabook-pkg`, point
  `source_x86_64` at the local file, substitute the sha256, `makepkg -f`, then
  extract the `.pkg.tar.zst` and run the bundle (the wrapper references the
  absolute `/usr/lib/tabook` path, so run `node <dir>/tabook.bundle.mjs`
  directly from the extracted layout).
- Second packaging path — the npm package (`npm pack`): `prepack` runs `tsc`
  and then `scripts/prepare-npm.mjs`, which vendors the napi loader + the
  host-arch `.node` into `dist/node_modules/@tabook/native` (that package is a
  local workspace, not on the registry) and strips compiled tests from `dist/`.
  Without it the packed package has no binding and the app dies on startup with
  `the Rust core (@tabook/native) is unavailable`. `npm run verify:npm` installs
  the packed tarball and smoke-tests it (CLI boots native, FB2 parse, DB cycle)
  — CI runs it after `npm run build`; never pack without it.

## Code graph (graphify)

`graphify-out/` holds a local dependency graph of the codebase (nodes, edges,
communities) — the fastest way to see what a change actually touches. It is a
**gitignored local cache**, never committed and never produced by CI, so its
freshness is maintained locally:

- The `post-checkout`/`post-merge` hooks in `.githooks/` rebuild it in the
  background after a branch switch or `git pull` (non-fatal, skipped when
  `graphify` isn't installed). They are enabled by the `prepare` script, same
  as the pre-commit format check.
- Manual refresh: `graphify update .` (no LLM cost). Do this before trusting
  the graph if you suspect drift — check `Built from commit` at the top of
  `graphify-out/GRAPH_REPORT.md` against `git rev-parse HEAD`.
- A stale graph is worse than no graph: it reports edges that no longer exist
  while looking authoritative. Verify the commit, don't trust blindly.

## Commands

- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Tests: `npm test`
- Rust core tests: `npm run test:native`
- Build (TS): `npm run build`
- Build native binding: `npm run build:native`
- Release tarball: `node scripts/package-release.mjs`
