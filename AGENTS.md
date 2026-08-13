# AGENTS.md

## Native Rust core

`crates/tabook-native` holds the Rust core — FB2/EPUB parsing, the layout
engine and in-book search — exposed to TypeScript as a napi binding
(`crates/tabook-native/index.linux-<arch>-gnu.node`, arch-specific name).
`src/native.ts` loads it and
delegates to it; when the binding is missing the pure-TS implementations in
`src/formats/`, `src/renderer/`, `src/search/` and `src/opds/parser.ts` are
used as fallbacks.

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
prebuilt tarball (single-file esbuild bundle + stripped Rust `.node` +
better-sqlite3 prebuild) attached to the GitHub Release.

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

## Commands

- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Tests: `npm test`
- Rust core tests: `npm run test:native`
- Build (TS): `npm run build`
- Build native binding: `npm run build:native`
- Release tarball: `node scripts/package-release.mjs`
