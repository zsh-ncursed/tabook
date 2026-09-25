// Enables the repository's own git hooks (the pre-commit Prettier check).
// Wired up as the `prepare` script, so `npm install` in a fresh clone does it.
//
// Guarded on purpose: `prepare` also runs when this package is installed as a
// dependency (npm 12 does it for tarball installs, npm ≤11 for git/local
// installs). The consumer is usually inside *their* git repository, so blindly
// setting core.hooksPath would point their hooks at `.githooks` — a directory
// that is not shipped in the npm package — silently disabling every hook in
// that repository. Only act when this script sits in the project's own
// checkout, i.e. .git/ and .githooks/ exist next to it.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, '.githooks')) || !existsSync(join(root, '.git'))) {
  process.exit(0); // installed as a dependency, not the project checkout
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' });
} catch {
  // git unavailable, or an unusual checkout (bare, worktree without .git) —
  // the hooks are a convenience, never a build gate.
}
