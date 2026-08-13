# AGENTS.md

## Native Rust core

`crates/tabook-native` holds the Rust core — FB2/EPUB parsing, the layout
engine and in-book search — exposed to TypeScript as a napi binding
(`crates/tabook-native/index.linux-x64-gnu.node`). `src/native.ts` loads it and
delegates to it; when the binding is missing the pure-TS implementations in
`src/formats/`, `src/renderer/`, `src/search/` and `src/opds/parser.ts` are
used as fallbacks.

- Rebuild the binding: `npm run build:native` (cargo release build)
- Rust tests: `npm run test:native` — ALWAYS run these when touching `crates/`.
  The TS coverage thresholds in `vitest.config.ts` assume the Rust core is
  covered here (the `.node` binding is committed and loaded in tests).
- Keep the committed `.node` binary in sync with the `crates/` sources.

## TUI Verification Rule

For TUI features relying on raw mode, terminal input, or external processes
(xclip, xsel, wl-paste, ueberzugpp), `npm test` + `tsc` is NOT sufficient.

**Mandatory after any change to input handling or external process integration:**

1. Build the package (`npm run build`)
2. Install it (`sudo pacman -U <pkg.tar.zst>`)
3. Launch in a **real terminal** and manually verify the feature
4. Only then claim "done"

`tsc clean + tests pass` proves compilation and logic, not runtime behavior.
Raw-mode key interception, clipboard reads, and image overlays cannot be
verified by unit tests — they need a live terminal.

## Commands

- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Tests: `npm test`
- Rust core tests: `npm run test:native`
- Build (TS): `npm run build`
- Build native binding: `npm run build:native`
- Package: `cd /tmp/opencode/tabook-pkg && makepkg -f`
