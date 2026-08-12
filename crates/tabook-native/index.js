// @tabook/native — napi-rs generated binding (hand-written for phase 0)
//
// Loads the platform-specific .node binary. ESM/CJS compatible.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const platform = process.platform;
const arch = process.arch;

let platformTriple = '';
if (platform === 'linux' && arch === 'x64') {
  platformTriple = 'linux-x64-gnu';
} else if (platform === 'linux' && arch === 'arm64') {
  platformTriple = 'linux-arm64-gnu';
} else {
  throw new Error(`@tabook/native: unsupported platform ${platform}-${arch}`);
}

const nodePath = join(__dirname, `index.${platformTriple}.node`);
if (!existsSync(nodePath)) {
  throw new Error(`@tabook/native: binary not found at ${nodePath}`);
}

// .node files are CommonJS modules; createRequire lets us load them from ESM.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export default require(nodePath);