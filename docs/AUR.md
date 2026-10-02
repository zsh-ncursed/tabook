# AUR Publishing Setup

## Overview

The `aur-publish.yml` workflow runs when a `v*` tag is pushed to `main`.
It runs the full test suite, then publishes the updated `PKGBUILD` + `.SRCINFO`
to the AUR `tabook` package via SSH.

The release workflow prebuilds the Rust core (`crates/tabook-native`) into
single-file tarballs for both `x86_64` and `aarch64`. The Rust core owns the
whole DB layer too (rusqlite, bundled SQLite), so the package ships a single
native module and installs on either architecture without compiling anything.

## Prerequisites

### 1. Register on AUR

Create an account at https://aur.archlinux.org if you don't have one.
The package name is `tabook` — make sure it's not already taken.

### 2. Generate an SSH key for AUR

```bash
ssh-keygen -t ed25519 -C "tabook-ci" -f ~/.ssh/aur_tabook
```

### 3. Add the public key to your AUR account

Go to https://aur.archlinux.org/account/ → My Account → SSH Public Key.
Paste the contents of `~/.ssh/aur_tabook.pub`.

### 4. Add GitHub Secrets

Go to repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret name           | Value                                             |
| --------------------- | ------------------------------------------------- |
| `AUR_SSH_PRIVATE_KEY` | Contents of `~/.ssh/aur_tabook` (the private key) |
| `AUR_USERNAME`        | Your AUR username (e.g. `zsh-ncursed`)            |

### 5. Create the AUR package (first time only)

The first publish must be done manually to create the package:

```bash
git clone ssh://aur.archlinux.org/tabook.git
cd tabook
# Copy PKGBUILD from the repo, set the correct version
cp /path/to/tabook/PKGBUILD .
sed -i "s/^pkgver=.*/pkgver=0.1.0/" PKGBUILD
makepkg --printsrcinfo > .SRCINFO
git add PKGBUILD .SRCINFO
git commit -m "Initial import: tabook 0.1.0"
git push origin master
```

After that, all subsequent updates are handled by the GitHub Actions workflow.

## Release process

```bash
# 1. Update the version everywhere:
#    package.json / package-lock.json. The workflow re-derives pkgver from
#    the tag anyway, but keep the repo copy in sync.
#    crates/tabook-native/Cargo.toml and crates/tabook-native/package.json
#    are versioned independently (they track the Rust core, not the app) and
#    are deliberately NOT bumped for an app release.
npm version 0.3.0 --no-git-tag-version

# 2. Commit and push the release:
git push origin main

# 3. Tag and push the tag:
git tag v0.3.0
git push origin v0.3.0

# 4. The workflow triggers automatically:
#    - Runs tests (format, typecheck, lint, coverage, build)
#    - Rewrites PKGBUILD pkgver from the tag
#    - Generates .SRCINFO
#    - Pushes to AUR
```

### Install scriptlets (pacman 7+)

`post_install()` **functions inside `PKGBUILD` are silently ignored** since
pacman 7 — `makepkg` 7.1.0 does not even mention the name. A scriptlet must be
a separate file next to the `PKGBUILD`, named by the `install` variable:

```bash
# PKGBUILD
install=tabook.install
```

```bash
# tabook.install
post_install() {
  echo "  TTS (optional): install piper-tts from AUR - yay -S piper-tts"
}
```

This fails silently: the package builds, `namcap` says nothing, and the hint
simply never runs. Two consequences for this repo:

- `aur-publish.yml` copies files to the AUR repo one by one, so `tabook.install`
  has to be listed there explicitly alongside `PKGBUILD` and `.SRCINFO`.
- Verify locally by building and looking for `.INSTALL` in the result:
  `tar --zstd -tf tabook-*.pkg.tar.zst | grep INSTALL`.

Notes:

- The `target/` directory is git-ignored; never commit Rust build artifacts
  (the AUR PKGBUILD clones the repo at the tag, so a tracked `target/` would
  bloat every user build).
- TS coverage thresholds in `vitest.config.ts` are lower than the pre-Rust
  era because the Rust core is covered by `cargo test` instead — run
  `npm run test:native` locally before tagging.

Users can then install via:

```bash
yay -S tabook
# or
paru -S tabook
```
