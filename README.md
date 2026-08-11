# tabook

A terminal e-book reader for **FB2**, **FB2-in-ZIP** and **EPUB** (2.x / 3.x) with
vim-like controls. Built with TypeScript, React + Ink and SQLite.

## Features

- Read FB2 (`.fb2`), FB2 archives (`.fb2.zip`) and EPUB (`.epub`) files directly in the terminal.
- Full structural rendering: headings, paragraphs, lists, quotes, poems, tables, annotations, epigraphs and inline styling (bold / italic / underline / strike / links / code).
- EPUB TOC from both the EPUB 3 `<nav>` document and EPUB 2 NCX.
- Windows-1251 / UTF-8 / UTF-16 XML detection with BOM handling.
- A local library backed by SQLite: metadata, reading progress, bookmarks, reading sessions and history.
- Attach local folders as libraries (`:library add ~/books`) — recursive scans import metadata in bulk, and attached folders are auto-rescanned (mtime-based, async) when you enter the library if their files changed.
- Browse online book catalogs over **OPDS** (`:opds add <name> <url>`) — search, navigate and download books straight to the library.
- Full-text search inside the current book with highlighted matches (`/`, `n`, `N`).
- Bookmarks (`b`) with text previews and a bookmark list (`B`).
- Table of contents navigation (`t`), book info (`i`) and a help screen (`?`).
- Simplified reading mode that flattens lists, poems and tables into paragraphs (`:simplified`).
- Typography control: line measure, paragraph spacing/indent, hyphenation and text justification (`J`).
- 41 built-in color themes (36 dark, 5 light) switchable at runtime (`:theme`, `:themes`, `W` toggles wide screen).
- Reading progress restored on reopen; progress bar in the status bar.
- Vim-like multi-key bindings (e.g. `gg` / `G`) with a fully remappable keymap and a command line (`:`).
- Clipboard paste (`Ctrl+V`) and a config editor (`:config edit`) — opens `config.toml` in `$EDITOR` and reloads it live.

## Requirements

- Node.js >= 18 (tested on 22)
- Linux (or another OS with a real terminal)

## Install

### From the AUR (Arch Linux)

```bash
paru -S tabook
# or with yay:
yay -S tabook
```

The package bundles the prebuilt native SQLite binding for both x86_64 and
aarch64. Optional dependencies: `ueberzugpp` (book cover previews),
`zenity` / `kdialog` (graphical file picker for `o`).

### From source

```bash
npm install
npm run build
```

This compiles TypeScript to `dist/`. The `tabook` binary is exposed via `npm link`
or the `bin` field in `package.json`:

```bash
npm link
tabook --help
```

## Usage

Open a book directly:

```bash
tabook book.fb2
tabook book.fb2.zip
tabook book.epub
```

Open the library view:

```bash
tabook --library
```

Attach a folder of books as a library (recursively scanned):

```bash
tabook ~/books
```

Or from inside the app: `:library add <path>`, `:library list`, `:library scan`,
`:library remove <path>`. Attached folders are auto-rescanned when you enter the
library if their files changed (mtime comparison), so unchanged folders are
never re-parsed.

Additional options:

```bash
tabook --theme monokai book.epub     # override the theme
tabook --config ~/.config/tabook/config.toml  # use a specific config file
```

## Keybindings

| Key                   | Action                               |
| --------------------- | ------------------------------------ |
| `j` / `k`             | Scroll down / up                     |
| `h` / `l`             | Move left / right                    |
| `gg` / `G`            | Go to start / end                    |
| `space` / `backspace` | Page down / up                       |
| `ctrl+d` / `ctrl+u`   | Page down / up                       |
| `/`                   | Search in book                       |
| `n` / `N`             | Next / previous match                |
| `o`                   | Open a book file                     |
| `s`                   | Save current book to library         |
| `d`                   | Delete current book from library     |
| `b` / `B`             | Add / list bookmarks                 |
| `t`                   | Table of contents                    |
| `i`                   | Book info                            |
| `R`                   | Toggle recent books                  |
| `J`                   | Toggle text justify                  |
| `W`                   | Toggle wide screen                   |
| `?`                   | Help                                 |
| `:`                   | Command line                         |
| `enter`               | Select / open                        |
| `escape`              | Back                                 |
| `q`                   | Quit (library) / close book (reader) |

### OPDS view keys

| Key       | Action                             |
| --------- | ---------------------------------- |
| `j` / `k` | Navigate catalog entries           |
| `enter`   | Open entry / download book         |
| `d`       | Download selected book             |
| `/`       | Search in catalog                  |
| `u`       | Go up one level                    |
| `c`       | Switch between configured catalogs |
| `n`       | Next page                          |
| `g` / `G` | Jump to start / end of list        |
| `q`       | Quit OPDS view                     |

### Command line

| Command                  | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `:open <path>`           | Open a book file (falls back to picker)                  |
| `:theme <name>`          | Switch theme (persisted to config)                       |
| `:themes`                | List available themes                                    |
| `:sort <field>`          | Sort library by `title`, `author`, `added` or `progress` |
| `:group`                 | Toggle group-by-series in the library                    |
| `:goto <page>`           | Jump to a page number (`:goto 10%` also works)           |
| `:simplified`            | Toggle simplified reading mode                           |
| `:search <query>`        | Search the current book                                  |
| `:config init`           | Write a default config file                              |
| `:config edit`           | Open the config in `$EDITOR` and reload it live          |
| `:opds`                  | Open the OPDS catalog browser                            |
| `:opds add <name> <url>` | Add an OPDS catalog (`[username] [password]` optional)   |
| `:opds remove <name>`    | Remove an OPDS catalog                                   |
| `:opds list`             | List configured OPDS catalogs                            |
| `:library add <path>`    | Attach a folder as a library                             |
| `:library list`          | List attached folders                                    |
| `:library scan`          | Rescan all attached folders                              |
| `:library remove <path>` | Detach a folder and remove its books                     |
| `:q` / `:quit`           | Quit                                                     |

## Configuration

`tabook` looks for `$XDG_CONFIG_HOME/tabook/config.toml`
(default `~/.config/tabook/config.toml`). The default database is
`$XDG_CONFIG_HOME/tabook/library.db`.

See **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** for the full reference:
every option, keybinding rules, ranges and the in-app command line.

```toml
# config.toml
theme = "dracula"
db_path = "~/.local/share/tabook/library.db"

[keybindings]
j = "move_cursor_down"
k = "move_cursor_up"
space = "page_down"
backspace = "page_up"

[typography]
measure = 80            # characters per line (20-500)
line_spacing = 0        # blank lines between text lines (0-5)
paragraph_indent = 0    # indent for the first line of a paragraph (0-20)
paragraph_spacing = 1   # blank lines between paragraphs (0-5)
hyphenation = false     # hyphenate long words at line breaks

[display]
simplified_mode = false
respect_publisher_css = true
show_progress_bar = true
```

The sample TOML above is the complete set of supported options. Drop it into
`~/.config/tabook/config.toml` and edit to taste.

## Themes

See **[docs/THEMES.md](docs/THEMES.md)** for the full catalog of the 41
built-in themes (36 dark, 5 light) and how to switch them.

## Development

```bash
npm run dev -- book.fb2       # run from source via tsx
npm test                      # unit tests (vitest)
npm run test:coverage         # tests with coverage thresholds
npm run lint                  # eslint
npm run typecheck             # tsc --noEmit
npm run build                 # compile to dist/
```

A pre-commit hook (`.githooks/pre-commit`) runs Prettier on staged files so
unformatted code never reaches CI — it is wired up automatically by the
`prepare` script (`git config core.hooksPath .githooks`) on every `npm install`
or `npm ci`.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for an overview of the
module layout, data flow and rendering pipeline.

## Project layout

```
src/
  cli/        command-line entry point (commander + ink render)
  config/     defaults, TOML parsing, keybinding normalization
  db/         SQLite library (books, progress, bookmarks, sessions, history)
  formats/    FB2 and EPUB parsers, XML/encoding helpers, block model
  renderer/   block-to-lines layout engine, simplified mode
  search/     in-book full-text search index
  themes/     built-in color themes
  tui/        Ink components (library, reader, help, modals, OPDS)
  utils/      text, paths, zip and error helpers
```

## License

MIT
