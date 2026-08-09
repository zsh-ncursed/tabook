# Maintainer: zsh-ncursed <zsh.ncursed@gmail.com>
# vim: ft=sh:

pkgname=tabook
_pkgname=tabook
pkgver=0.1.2
pkgrel=1
pkgdesc='Terminal-based e-book reader for FB2 and EPUB formats'
arch=('any')
url='https://github.com/zsh-ncursed/tabook'
license=('MIT')
depends=('nodejs>=18')
# better-sqlite3 ships prebuilt .node binaries for x86_64 and aarch64;
# stripping/debug-packing them fails on cross-arch files and gains nothing.
options=(!strip !debug)
makedepends=('npm' 'git' 'python' 'gcc' 'make')
optdepends=(
  'ueberzugpp: display book cover images in supported terminals'
  'zenity: graphical file picker for the `o` open-file dialog'
  'kdialog: graphical file picker (KDE alternative to zenity)'
)
source=("${pkgname}::git+${url}.git#tag=v${pkgver}")
sha256sums=('SKIP')

build() {
  cd "${srcdir}/${pkgname}"
  npm ci
  npm run build
  npm prune --production
}

package() {
  cd "${srcdir}/${pkgname}"

  # App directory
  install -dm755 "${pkgdir}/usr/lib/${pkgname}"
  cp -r dist node_modules package.json "${pkgdir}/usr/lib/${pkgname}/"

  # Strip better-sqlite3 prebuilds for other OSes — keep both linux-x64 and
  # linux-arm64 so the same package works on x86_64 and aarch64 (the runtime
  # loader in lib/binding.js picks the .node file by process.platform+arch).
  rm -f "${pkgdir}/usr/lib/${pkgname}/node_modules/better-sqlite3/prebuilds/"{darwin-*,win32-*,linuxmusl-*}*

  # Binary wrapper
  install -dm755 "${pkgdir}/usr/bin"
  cat > "${pkgdir}/usr/bin/tabook" <<EOF
#!/bin/bash
exec node /usr/lib/${pkgname}/dist/cli/main.js "\$@"
EOF
  chmod 755 "${pkgdir}/usr/bin/tabook"

  # License
  install -Dm644 LICENSE "${pkgdir}/usr/share/licenses/${pkgname}/LICENSE" 2>/dev/null || true
}