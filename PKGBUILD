# Maintainer: zsh-ncursed <https://github.com/zsh-ncursed>
# Upstream:  https://github.com/zsh-ncursed/tabook
# Package:   tabook-git — terminal e-book reader (FB2 / EPUB) with vim-like keys
#
# This is a -git package: it builds from the latest commit on the default
# branch. There is no separate source tarball, so pkgver is derived from
# the commit count and the short SHA of HEAD.

pkgname=tabook-git
pkgver=0.1.0.r47.g0ec6a64
pkgrel=1
pkgdesc='TUI e-book reader for FB2 and EPUB with vim-like controls'
arch=('x86_64' 'aarch64')
url='https://github.com/zsh-ncursed/tabook'
license=('MIT')
depends=('nodejs' 'gcc-libs' 'glibc')
# nodejs: runtime.
# gcc-libs: libgcc_s.so.1 + libstdc++.so.6 needed by the native
# better-sqlite3 addon compiled in build().
# glibc: libc.so.6 / ld-linux / libm needed by the same addon.
makedepends=('git' 'npm' 'python' 'gcc' 'make' 'node-gyp')
# git is needed to fetch the VCS source.
# python/gcc/make are needed by node-gyp to compile better-sqlite3 from source.
# node-gyp is needed to build the better-sqlite3 native addon. It is bundled
# with npm internally, but better-sqlite3 v13 has no install/postinstall script,
# so npm does not invoke it automatically — we call it explicitly in build().
# typescript is installed via npm during build() (matching the version pinned
# in package.json devDependencies) rather than via a system package, to avoid
# a version mismatch with the project's toolchain.
options=('!strip')
# !strip: makepkg's default strip step corrupts native .node addons
# (objcopy/strip cannot parse them and leave broken files behind).
provides=("${pkgname%-git}=${pkgver}")
conflicts=("${pkgname%-git}")
source=("${pkgname%-git}::git+${url}.git")
sha256sums=('SKIP')

pkgver() {
  cd "${pkgname%-git}"
  # Tag-based versioning would use `git describe`. There are no tags yet, so
  # fall back to commit-count + short SHA. Once v0.1.0 is tagged, switch to:
  #   git describe --long --tags --abbrev=7 2>/dev/null | sed 's/^v//;s/\([^-]*-g\)/r\1/;s/-/./g'
  printf "0.1.0.r%s.g%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)"
}

build() {
  cd "${pkgname%-git}"

  # Install only production deps + build the TypeScript output.
  #
  # Step 1: install prod deps. `--ignore-scripts` is safe here because
  # better-sqlite3 v13 has no install/postinstall script — prebuilt binaries
  # are already in the npm tarball, and we build the native addon ourselves
  # in step 3. `--no-package-lock` is used instead of `npm ci` because the
  # lockfile's dev-dependency subtree drifts (tsx wants esbuild@^0.25, the
  # override pins ^0.25.0 but resolves 0.28) and `npm ci --omit=dev` still
  # validates the whole lockfile. `--no-package-lock` resolves from
  # package.json directly.
  #
  # The `prepare` lifecycle hook (which runs `npm run build` and would fail
  # because tsc is not installed yet) is neutralized by stripping it from
  # package.json before install.
  node -e "const p=require('./package.json'); delete p.scripts.prepare; require('fs').writeFileSync('./package.json', JSON.stringify(p,null,2))"
  npm install --omit=dev --no-package-lock --no-audit --no-fund --ignore-scripts

  # Step 2: install the pinned typescript version. --no-save keeps it out of
  # package.json. IMPORTANT: this must run BEFORE the native addon build,
  # because `npm install` re-resolves the dependency tree and would wipe the
  # build/ directory that node-gyp produced. Doing the typescript install
  # first means the tree is stable by the time node-gyp runs.
  npm install --no-save --no-audit --no-fund --ignore-scripts typescript@"$(node -p "require('./package.json').devDependencies.typescript")"

  # Step 3: build the better-sqlite3 native addon from source. v13 ships
  # prebuilt .node binaries for every platform under prebuilds/, which is
  # forbidden by AUR guidelines. binding.gyp has a guard: when a prebuild
  # exists for the host, the build target is a no-op (just TOUCH a stamp).
  # `--force_build=1` overrides the guard and actually compiles
  # src/better_sqlite3.cpp + deps/sqlite3 into build/Release/better_sqlite3.node.
  # The loader (lib/binding.js) falls back to this path when prebuilds/ is
  # absent (we delete prebuilds/ in package()). Run this LAST so no further
  # npm install wipes build/.
  cd node_modules/better-sqlite3
  node-gyp rebuild --release --force_build=1
  cd - >/dev/null

  # Step 4: build the TypeScript.
  npm run build
}

check() {
  cd "${pkgname%-git}"
  # Optional: run the full test suite with coverage. Not all devDeps are
  # installed under --omit=dev, so reinstall them in check() if you want
  # this step active. Disabled by default to keep the build lighter.
  # npm ci
  # npm run test:coverage
  :
}

package() {
  cd "${pkgname%-git}"

  # Application layout: /usr/lib/tabook holds dist + prod node_modules,
  # /usr/bin/tabook is a symlink into the bin entry.
  local appdir="/usr/lib/${pkgname%-git}"

  install -d -m755 "${pkgdir}${appdir}"
  install -d -m755 "${pkgdir}/usr/bin"

  # Compiled output.
  cp -a dist "${pkgdir}${appdir}/"

  # Production node_modules. Strip out the typescript toolchain that was
  # pulled in only to run `tsc` during build() — it is not needed at runtime
  # and would bloat the package with tsx/vite/rolldown/lightningcss/esbuild.
  cp -a node_modules "${pkgdir}${appdir}/"

  # Remove the typescript install-only deps. These were installed with
  # --no-save so they are not listed in package.json, but they live in
  # node_modules/ and would otherwise ship. typescript itself plus the
  # peer-optional tooling npm pulls in (eslint plugins, vitest, vite,
  # rolldown, lightningcss, esbuild, tsx) are build-only and not needed
  # at runtime. Prune them by package name.
  local dev_pkg
  for dev_pkg in \
    typescript tsx \
    '@esbuild' esbuild \
    '@rolldown' rolldown \
    lightningcss lightningcss-linux-x64-gnu lightningcss-linux-x64-musl \
    '@vitejs' vite \
    '@vitest' vitest \
    '@typescript-eslint' \
    '@types' '@types/adm-zip' '@types/better-sqlite3' '@types/node' '@types/react'
  do
    rm -rf "${pkgdir}${appdir}/node_modules/${dev_pkg}"
  done

  # Prune dangling .bin symlinks that pointed at the dev toolchain we just
  # removed (tsc, tsserver, tsx, vitest, rolldown, ...). namcap errors on
  # symlinks pointing to non-existing targets.
  find "${pkgdir}${appdir}/node_modules/.bin" -type l ! -exec test -e {} \; -delete 2>/dev/null || true
  rmdir "${pkgdir}${appdir}/node_modules/.bin" 2>/dev/null || true

  # Drop non-runtime payload: test scaffolding, Python helpers, download
  # scripts, markdown docs inside deps. These are never required by the
  # running app and only inflate the package or trigger namcap warnings.
  rm -rf "${pkgdir}${appdir}/node_modules/ajv/scripts"
  rm -rf "${pkgdir}${appdir}/node_modules/flatted/python"
  rm -rf "${pkgdir}${appdir}/node_modules/better-sqlite3/deps/download.sh"

  # better-sqlite3: keep only the compiled native addon, drop everything
  # else. prebuilds/ contains foreign-platform prebuilt binaries (forbidden
  # by AUR). build/ contains node-gyp intermediates (Makefiles, .o files,
  # unstripped .node under obj.target/) with absolute $srcdir paths embedded,
  # which makepkg flags as a reproducibility warning. Only
  # build/Release/better_sqlite3.node is needed at runtime — the loader
  # falls back to it when prebuilds/ is gone.
  rm -rf "${pkgdir}${appdir}/node_modules/better-sqlite3/prebuilds"
  find "${pkgdir}${appdir}/node_modules/better-sqlite3/build" \
    -type f ! -path '*/Release/better_sqlite3.node' -delete
  find "${pkgdir}${appdir}/node_modules/better-sqlite3/build" \
    -type d -empty -delete

  # package.json is required by the bin entry (shebang resolves via node).
  install -D -m644 package.json "${pkgdir}${appdir}/package.json"

  # License.
  install -D -m644 LICENSE "${pkgdir}/usr/share/licenses/${pkgname}/LICENSE"

  # Desktop-independent docs (README ships the full keybinding reference).
  install -D -m644 README.md "${pkgdir}/usr/share/doc/${pkgname}/README.md"

  # Symlink the CLI entry into /usr/bin. The bin script uses
  # #!/usr/bin/env node, so it runs against the system node.
  ln -s "${appdir}/dist/cli/bin.js" "${pkgdir}/usr/bin/${pkgname%-git}"
}

# vim:set ts=2 sw=2 et:
