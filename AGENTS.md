# AGENTS.md

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
- Build: `npm run build`
- Package: `cd /tmp/opencode/tabook-pkg && makepkg -f`
