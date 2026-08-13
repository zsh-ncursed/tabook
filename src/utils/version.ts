import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cachedVersion: string | null = null;

export function appVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  // In the source tree the package.json sits two levels up from src/utils;
  // in the single-file release bundle it ships next to the bundle itself.
  for (const candidate of ['../package.json', '../../package.json', './package.json']) {
    try {
      const pkg = require(candidate) as { version?: string };
      if (typeof pkg.version === 'string') {
        cachedVersion = pkg.version;
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }
  cachedVersion = 'unknown';
  return 'unknown';
}
