// Copies the freshly built Rust cdylib (libtabook_native.so) to the filename
// the napi loader (crates/tabook-native/index.cjs) expects for the current
// architecture. Previously the cp target was hardcoded to linux-x64-gnu,
// which broke the arm64 release build (the loader looked for
// index.linux-arm64-gnu.node).
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const triple =
  process.platform === 'linux' && process.arch === 'arm64' ? 'linux-arm64-gnu' : 'linux-x64-gnu';

const src = join('target', 'release', 'libtabook_native.so');
const dst = join('crates', 'tabook-native', `index.${triple}.node`);

if (!existsSync(src)) {
  console.error(`copy-native: missing ${src} — run cargo build first`);
  process.exit(1);
}
copyFileSync(src, dst);
console.log(`copy-native: ${src} -> ${dst}`);
