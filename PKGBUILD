# Maintainer: Osha <osha@example.com>
# vim: ft=sh:

pkgname=tabook
_pkgname=tabook
pkgver=0.1.0
pkgrel=1
pkgdesc='Terminal-based e-book reader for FB2 and EPUB formats'
arch=('any')
url='https://github.com/zsh-ncursed/tabook'
license=('MIT')
depends=('nodejs>=18')
makedepends=('npm' 'git' 'python' 'gcc' 'make')
optdepends=(
  'ueberzugpp: display book cover images in supported terminals'
)
source=("${pkgname}::git+${url}.git#tag=v${pkgver}")
sha256sums=('SKIP')

build() {
  cd "${srcdir}/${pkgname}"
  npm ci
  npm run build
}

package() {
  cd "${srcdir}/${pkgname}"

  # App directory
  install -dm755 "${pkgdir}/usr/lib/${pkgname}"
  cp -r dist node_modules package.json "${pkgdir}/usr/lib/${pkgname}/"

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