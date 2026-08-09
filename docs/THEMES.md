# Themes

`tabook` ships 41 built-in color themes. Every theme defines a palette for
each UI element — background, text, headings, accents, panels, status bar,
search highlights, links and more. Themes are plain data, so switching is
instant and can happen live while reading.

## Using themes

**In the config file** (`~/.config/tabook/config.toml`):

```toml
theme = "nord"
```

**On the command line** (overrides the config):

```bash
tabook --theme monokai book.epub
```

**At runtime** — from the command line (`:`):

```text
:theme tokyonight
:themes        # list all built-in themes
```

The current theme is stored in the config, so `:theme` changes are persisted
and used on the next launch.

## Catalog

### Dark themes (36)

| Theme                  | Notes                  |
| ---------------------- | ---------------------- |
| `amoled`               | Pure-black background  |
| `aura`                 | Purple/red palette     |
| `ayu`                  | Ayu Mirage-inspired    |
| `carbonfox`            | Carbonfox              |
| `catppuccin`           | Catppuccin Mocha       |
| `catppuccin-frappe`    | Catppuccin Frappé      |
| `catppuccin-macchiato` | Catppuccin Macchiato   |
| `cobalt2`              | Cobalt2                |
| `cursor`               | Cursor editor-inspired |
| `dracula`              | **Default theme**      |
| `everforest`           | Everforest             |
| `flexoki`              | Flexoki                |
| `github`               | GitHub Dark            |
| `gruvbox`              | Gruvbox Dark           |
| `kanagawa`             | Kanagawa               |
| `lucent-orng`          | Lucent orange          |
| `material`             | Material               |
| `matrix`               | Matrix green           |
| `mercury`              | Mercury                |
| `monokai`              | Monokai                |
| `nightowl`             | Night Owl              |
| `nord`                 | Nord                   |
| `one-dark`             | One Dark               |
| `onedarkpro`           | One Dark Pro           |
| `opencode`             | OpenCode               |
| `orng`                 | Orange accent          |
| `osaka-jade`           | Osaka Jade             |
| `palenight`            | Palenight              |
| `rosepine`             | Rosé Pine              |
| `shadesofpurple`       | Shades of Purple       |
| `solarized`            | Solarized Dark         |
| `synthwave84`          | Synthwave '84          |
| `tokyonight`           | Tokyo Night            |
| `vercel`               | Vercel-inspired        |
| `vesper`               | Vesper                 |
| `zenburn`              | Zenburn                |

### Light themes (5)

| Theme              | Notes            |
| ------------------ | ---------------- |
| `ayu-light`        | Ayu Light        |
| `github-light`     | GitHub Light     |
| `gruvbox-light`    | Gruvbox Light    |
| `solarized-light`  | Solarized Light  |
| `catppuccin-latte` | Catppuccin Latte |

> A theme named `custom:<anything>` is accepted without the "unknown theme"
> warning, leaving a hook for future user-defined palettes.

## What a theme defines

Each theme maps a `ThemeColors` object:

| Color             | Used for                       |
| ----------------- | ------------------------------ |
| `background`      | Main background                |
| `text`            | Body text                      |
| `heading`         | Headings, table headers        |
| `accent`          | Accents, selection             |
| `panel`           | Modal / list panel backgrounds |
| `panelBorder`     | Panel borders                  |
| `statusBar`       | Status bar background          |
| `statusBarText`   | Status bar text                |
| `searchHighlight` | Highlighted search matches     |
| `dim`             | Dimmed / secondary text        |
| `link`            | Links                          |
| `error`           | Error messages                 |

Derived colors (selection, links, table headers, errors) fall back to sensible
defaults when a theme omits them.
