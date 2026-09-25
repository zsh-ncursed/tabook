// Prepares `dist/` so that `npm pack` produces a self-contained package.
//
// The app's hot paths and the whole DB layer live in the Rust core, which is
// loaded as `require('@tabook/native')` (src/native.ts). That package is a
// local npm workspace — it is *not* on the registry — so a plain
// `npm publish` of `dist/` used to ship a package whose native module could
// never resolve: the app then printed "native module unavailable" and crashed
// on startup with "Cannot open database … better-sqlite3 is not installed".
//
// Fix: vendor the napi loader + the compiled binding under
// `dist/node_modules/@tabook/native/`. Node resolves `require()` from the
// calling file upwards, so `dist/native.js` finds it there — no unpublished
// dependency, no compile step at install time. `npm pack` ships nested
// node_modules (only the root one is always ignored), which is what makes this
// work; see scripts/verify-npm-package.mjs for the guard.
//
// Notes:
// - The binding is arch-specific, and crates/tabook-native/index.cjs supports
//   exactly linux-x64-gnu / linux-arm64-gnu, so the tarball carries the host
//   arch's binary. On a platform/triple it cannot load (musl, other OS) the
//   app falls back to the pure-TS implementations + the optional
//   `better-sqlite3` dependency (which ships its own prebuilds).
// - Compiled tests are stripped from `dist/` (`tsc` emits them because the
//   test files live next to the sources) so they don't end up in the package.
//
// Run by `npm run prepack` — `npm pack` / `npm publish` can then never ship a
// package without the binding.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const nativeDir = join(root, 'crates', 'tabook-native');

// Same triples crates/tabook-native/index.cjs resolves at runtime.
const triple =
  process.platform === 'linux' && process.arch === 'arm64' ? 'linux-arm64-gnu' : 'linux-x64-gnu';
const nodeBinary = `index.${triple}.node`;

function fail(message) {
  console.error(`prepare-npm: ${message}`);
  process.exit(1);
}

if (!existsSync(distDir)) {
  fail('dist/ is missing — run `npm run build` first');
}
const builtBinary = join(nativeDir, nodeBinary);
if (!existsSync(builtBinary)) {
  fail(
    `missing crates/tabook-native/${nodeBinary} — run \`npm run build:native\` ` +
      '(the release workflow builds it before packing)',
  );
}

// 1. Vendor the native loader package. index.d.ts in the crate directory is a
// placeholder (0 bytes), so the shipped declarations come from
// src/native-types.d.ts — the same file the app itself compiles against.
const vendored = join(distDir, 'node_modules', '@tabook', 'native');
rmSync(vendored, { recursive: true, force: true });
mkdirSync(vendored, { recursive: true });
for (const file of ['package.json', 'index.cjs', 'index.js']) {
  cpSync(join(nativeDir, file), join(vendored, file));
}
cpSync(join(root, 'src', 'native-types.d.ts'), join(vendored, 'index.d.ts'));
cpSync(builtBinary, join(vendored, nodeBinary));

// 2. Strip the binary (best effort — it is native to this machine). The AUR
// pipeline does the same; cargo's strip=true is not applied to cdylibs here.
// Keeps the published tarball ~4 MB instead of ~15 MB.
let stripped = false;
try {
  execFileSync('strip', [join(vendored, nodeBinary)], { stdio: 'ignore' });
  stripped = true;
} catch {
  // `strip` unavailable (non-binutils toolchain) — ship the binary as built.
}

// 3. Drop compiled test artifacts from dist/. They are emitted by `tsc`
// because the tests (and their shared helpers, `*.test-utils.ts`) live inside
// src/, and they must not ship.
let removedTests = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (
      /(^|\.)test(-utils)?\.[cm]?js(\.map)?$/.test(entry.name) ||
      /(^|\.)test(-utils)?\.d\.ts$/.test(entry.name)
    ) {
      rmSync(full, { force: true });
      removedTests += 1;
    }
  }
};
walk(distDir);

const sizeMb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
console.log(
  `prepare-npm: vendored @tabook/native ${triple} (${sizeMb(join(vendored, nodeBinary))} MB` +
    `${stripped ? ', stripped' : ', not stripped'}), removed ${removedTests} compiled test files`,
);
