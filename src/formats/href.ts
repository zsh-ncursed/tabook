import path from 'node:path';

// Resolve an href relative to a base directory inside an archive (EPUB / ZIP).
// Archive paths are always POSIX-style (ZIP uses forward slashes), so we use
// path.posix even on Windows. Normalizes "." and ".." segments and strips a
// leading "./" so the result matches the manifest hrefs the resources map is
// keyed by.
export function resolveHref(baseDir: string, href: string): string {
  return path.posix.normalize(path.posix.join(baseDir, href)).replace(/^\.\//, '');
}
