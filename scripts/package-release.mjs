// Builds the release artifact that the AUR package downloads:
//
//   build/tabook-<version>-linux-<arch>.tar.zst
//     tabook.bundle.mjs             # single-file JS: app + ink + react (esbuild)
//     package.json                  # version, resolved by appVersion() at runtime
//     node_modules/@tabook/native/  # the Rust core (.node), index.cjs loader
//     node_modules/better-sqlite3/  # lib/ + one arch prebuild (native dep)
//     LICENSE
//
// (The PKGBUILD writes its own /usr/bin wrapper; the tarball needs no launcher.)
//
// No compilation happens at install time: the PKGBUILD just downloads this
// artifact and unpacks it (system `node` is the only runtime dependency).
//
// Usage: node scripts/package-release.mjs  (TARGET_ARCH=x64|arm64 to override)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const arch = process.env.TARGET_ARCH ?? process.arch; // x64 | arm64
const nodeName = `index.linux-${arch}-gnu.node`;
const prebuildName = `linux-${arch}.node`;

// 1. Native module (Rust core). Profile in Cargo.toml already strips + LTOs.
console.log('[1/4] Building native module...');
execFileSync('npm', ['run', 'build:native'], { cwd: root, stdio: 'inherit' });
const nativeSrc = join(root, 'crates/tabook-native', nodeName);
if (!existsSync(nativeSrc)) {
  console.error(`missing ${nodeName} — did the native build emit it?`);
  process.exit(1);
}

// 2. Single-file JS bundle (everything except the two native modules).
console.log('[2/4] Bundling JS...');
await build({
  entryPoints: [join(root, 'src/cli/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  jsx: 'automatic',
  outfile: join(root, 'dist/tabook.bundle.mjs'),
  external: ['@tabook/native', 'better-sqlite3'],
  // ink eagerly runs connectToDevTools() at import; replace the ~10MB
  // react-devtools-core with a no-op stub (devtools are debug-only).
  alias: { 'react-devtools-core': join(root, 'scripts/devtools-stub.mjs') },
  // CJS deps (commander, ws, ...) call require('node:events') etc. at runtime.
  // In an ESM bundle `require` is undefined, so esbuild's __require shim
  // throws. Provide a real require bound to the bundle's own location.
  banner: {
    js: `import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);`,
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});

// 3. Assemble the layout.
console.log('[3/4] Assembling layout...');
const outDir = join(root, 'build', `tabook-${version}-linux-${arch}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'node_modules/@tabook/native'), { recursive: true });
mkdirSync(join(outDir, 'node_modules/better-sqlite3/prebuilds'), { recursive: true });

cpSync(join(root, 'dist/tabook.bundle.mjs'), join(outDir, 'tabook.bundle.mjs'));

// The bundle's appVersion() resolves package.json relative to itself
// (src/utils/version.ts), so ship it next to the bundle.
cpSync(join(root, 'package.json'), join(outDir, 'package.json'));

// Rust core: the napi loader (index.cjs) + the compiled module. index.js and
// index.d.ts are kept for Node ESM resolution / future tooling. The profile's
// strip=true is not applied by cargo for cdylibs here, so strip explicitly
// (the binary is native to this machine/runner, so this is always safe).
// package.json matters here: its `main: index.cjs` is what makes require()
// resolve to the CJS loader instead of index.js (ESM, { default }-wrapped).
for (const f of ['index.cjs', 'index.js', 'index.d.ts', 'package.json', nodeName]) {
  cpSync(join(root, 'crates/tabook-native', f), join(outDir, 'node_modules/@tabook/native', f));
}
execFileSync('strip', [join(outDir, 'node_modules/@tabook/native', nodeName)]);

// better-sqlite3: lib/ (JS incl. the platform-arch binding loader) + the one
// prebuilt binary for this arch. deps/ (sqlite C sources) and build/ (node-gyp
// output) are compile-time only and never loaded (lib/binding.js prefers
// prebuilds/ and only falls back to build/Release when no prebuild exists).
for (const f of ['lib', 'package.json']) {
  cpSync(
    join(root, 'node_modules/better-sqlite3', f),
    join(outDir, 'node_modules/better-sqlite3', f),
    { recursive: true },
  );
}
cpSync(
  join(root, 'node_modules/better-sqlite3/prebuilds', prebuildName),
  join(outDir, 'node_modules/better-sqlite3/prebuilds', prebuildName),
);
cpSync(join(root, 'LICENSE'), join(outDir, 'LICENSE'));

// 4. tar.zst (makepkg's default compression).
console.log('[4/4] Packing...');
const tar = join(root, 'build', `tabook-${version}-linux-${arch}.tar.zst`);
execFileSync('tar', ['--zstd', '-cf', tar, '-C', outDir, '.'], { stdio: 'inherit' });
console.log(`Wrote ${tar}`);
