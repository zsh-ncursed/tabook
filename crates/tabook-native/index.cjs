// @tabook/native — CJS binding for require()
//
// Loads the platform-specific .node binary.

const { existsSync } = require('node:fs');
const { join, dirname } = require('node:path');

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

module.exports = require(nodePath);