// Verifies that the *installed* npm package actually works.
//
// Regression guard for the 0.5.x bug this script was added with: `npm pack`
// shipped a package whose Rust binding (`@tabook/native`, a local workspace,
// not on the registry) could never resolve. `tabook --version` still printed a
// version, so nothing looked broken, but the DB layer had no backend and the
// app died with "Cannot open database … better-sqlite3 is not installed".
//
// What it does, in a throwaway directory:
//   1. `npm pack` (unless a tarball path is given as argv[2])
//   2. install the tarball with `npm install <tgz>`
//   3. run the installed `tabook --version` and fail if the loader reports the
//      native module as unavailable
//   4. exercise the installed package's real code paths — the native binding
//      through dist/native.js (the app's own loader), FB2 parsing through
//      dist/formats/index.js and a full add/list cycle through dist/db/db.js
//      (native rusqlite, no better-sqlite3 involved)
//
// Usage:
//   node scripts/verify-npm-package.mjs [path/to/tabook-x.y.z.tgz]
// Run by CI (see .github/workflows/ci.yml) after `npm run build`.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`verify-npm-package: ${message}`);
  process.exit(1);
}

// Runs inside the temp dir against the *installed* package (argv[2] = its
// directory). Deep imports are fine: the package declares no `exports` map.
const SMOKE_SOURCE = `
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pkgDir = process.argv[2];
const load = (rel) => import(pathToFileURL(join(pkgDir, 'dist', rel)).href);

// The app's own loader — proves the vendored binding resolves from dist/.
const nativeMod = await load('native.js');
if (!nativeMod.isNativeAvailable()) {
  throw new Error('isNativeAvailable() === false: ' + String(nativeMod.getNativeLoadError()));
}
const native = nativeMod.getNative();
for (const fn of ['parseBookFile', 'parseFb2Buffer', 'BookLayout', 'openLibraryDb', 'imageToPng']) {
  if (typeof native[fn] !== 'function') throw new Error('missing native export: ' + fn);
}

// FB2 parsing through the public app path.
const fb2 = join(pkgDir, 'smoke.fb2');
writeFileSync(
  fb2,
  '<?xml version="1.0" encoding="UTF-8"?>' +
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">' +
    '<description><title-info><book-title>Smoke</book-title>' +
    '<author><first-name>A</first-name><last-name>B</last-name></author>' +
    '</title-info></description><body><section><p>Hello</p></section></body></FictionBook>',
);
const formats = await load('formats/index.js');
const book = formats.parseBookFile(fb2);
if (book.metadata.title !== 'Smoke') throw new Error('parseBookFile lost the title');
if (book.format !== 'fb2') throw new Error('parseBookFile detected ' + book.format);

// DB layer: native rusqlite, no better-sqlite3 involved.
const { LibraryDb } = await load('db/db.js');
const dbPath = join(pkgDir, 'smoke.sqlite');
const db = new LibraryDb(dbPath);
const id = db.addBook({
  path: fb2,
  filename: 'smoke.fb2',
  format: 'fb2',
  size: 1,
  metadata: book.metadata,
});
if (!(id > 0)) throw new Error('addBook returned ' + id);
if (db.getBook(id).title !== 'Smoke') throw new Error('getBook lost the title');
if (db.listBooks().length !== 1) throw new Error('listBooks mismatch');
db.close();
for (const leftover of [fb2, dbPath, dbPath + '-wal', dbPath + '-shm']) {
  rmSync(leftover, { force: true });
}
console.log('installed package: native binding + FB2 parse + DB cycle OK');
`;

const workDir = mkdtempSync(join(tmpdir(), 'tabook-npm-verify-'));

try {
  // 1. Pack (or use a tarball CI already built).
  let tarball = process.argv[2];
  if (tarball) {
    tarball = resolve(tarball);
    console.log(`[1/4] using ${tarball}`);
  } else {
    console.log('[1/4] npm pack');
    const out = execFileSync('npm', ['pack', '--pack-destination', workDir], {
      cwd: root,
      encoding: 'utf8',
    });
    const name = out.trim().split('\n').pop()?.trim() ?? '';
    if (!name.endsWith('.tgz')) fail(`unexpected npm pack output: ${JSON.stringify(out)}`);
    tarball = join(workDir, name);
  }

  // 2. Install it the way a user would (`npm install -g` gets the same tree).
  console.log('[2/4] npm install');
  writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'verify', private: true }));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
    cwd: workDir,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const pkgDir = join(workDir, 'node_modules', 'tabook');
  const bin = join(workDir, 'node_modules', '.bin', 'tabook');
  const runDir = join(workDir, 'run');
  mkdirSync(runDir, { recursive: true });

  // 3. The installed CLI must boot with its native binding, not the fallback.
  console.log('[3/4] tabook --version');
  const version = spawnSync(bin, ['--version'], { cwd: runDir, encoding: 'utf8' });
  if (version.status !== 0) {
    fail(`installed CLI exited with ${version.status}: ${version.stderr || version.error}`);
  }
  const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const printed = (version.stdout ?? '').trim();
  if (printed !== expected) fail(`expected version ${expected}, got ${JSON.stringify(printed)}`);
  if (/native module unavailable/.test(version.stderr ?? '')) {
    fail(
      'the packaged CLI could not load its Rust binding — dist/node_modules/@tabook/native is ' +
        `missing or incomplete:\n${(version.stderr ?? '').trim()}`,
    );
  }

  // 4. Exercise the installed package the way the app does.
  console.log('[4/4] native binding + parse + DB smoke');
  const smoke = join(workDir, 'smoke.mjs');
  writeFileSync(smoke, SMOKE_SOURCE);
  const res = spawnSync('node', [smoke, pkgDir], { cwd: runDir, encoding: 'utf8' });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.status !== 0) fail(`smoke failed:\n${res.stderr || res.error}`);
  if (!/DB cycle OK/.test(res.stdout ?? '')) fail('smoke produced no success line');

  console.log(`verify-npm-package: OK (${tarball})`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
