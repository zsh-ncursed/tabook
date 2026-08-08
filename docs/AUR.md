# AUR Publishing Setup

## Overview

The `aur-publish.yml` workflow runs when a `v*` tag is pushed to `main`.
It runs the full test suite, then publishes the updated `PKGBUILD` + `.SRCINFO`
to the AUR `tabook` package via SSH.

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

| Secret name | Value |
|---|---|
| `AUR_SSH_PRIVATE_KEY` | Contents of `~/.ssh/aur_tabook` (the private key) |
| `AUR_USERNAME` | Your AUR username (e.g. `zsh-ncursed`) |

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
# 1. Update version in package.json
npm version patch  # or minor, major

# 2. Push the tag
git push origin main --tags

# 3. The workflow triggers automatically:
#    - Runs all tests (format, typecheck, lint, coverage, build)
#    - Updates PKGBUILD version
#    - Generates .SRCINFO
#    - Pushes to AUR
```

Users can then install via:

```bash
yay -S tabook
# or
paru -S tabook
```