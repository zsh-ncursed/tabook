import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cachedVersion: string | null = null;

export function appVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  for (const candidate of ['../package.json', '../../package.json']) {
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
