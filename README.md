# tabook

A terminal e-book reader for **FB2**, **FB2-in-ZIP** and **EPUB** (2.x / 3.x) with
vim-like controls. Built with TypeScript, React + Ink and SQLite.

## Features

- Read FB2 (`.fb2`), FB2 archives (`.fb2.zip`) and EPUB (`.epub`) files directly in the terminal.
- Full structural rendering: headings, paragraphs, lists, quotes, poems, tables, annotations, epigraphs and inline styling (bold / italic / underline / strike / links / code).
- EPUB TOC from both the EPUB 3 `<nav>` document and EPUB 2 NCX.
- Windows-1251 / UTF-8 / UTF-16 XML detection with BOM handling.
- A local library backed by SQLite: metadata, reading progress, bookmarks, reading sessions and history.
- Full-text search inside the current book with highlighted matches (`/`, `n`, `N`).
- Bookmarks (`b`) with text previews and a bookmark list (`B`).
- Table of contents navigation (`t`), book info (`i`) and a help screen (`?`).
- Simplified reading mode (`toggle_simplified`) that flattens lists, poems and tables into paragraphs.
- 14 built-in color themes and a user config file (`config.toml`).
- Vim-like multi-key bindings (e.g. `gg` / `G`) with a command line (`:`).

## Requirements

- Node.js >= 18 (tested on 22)
- Linux (or another OS with a real terminal)

## Install

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

Additional options:

```bash
tabook --theme monokai book.epub     # override the theme
tabook --config ~/.config/tabook/config.toml  # use a specific config file
```

## Keybindings

| Key                 | Action                               |
| ------------------- | ------------------------------------ |
| `j` / `k`           | Scroll down / up                     |
| `h` / `l`           | Move left / right                    |
| `gg` / `G`          | Go to start / end                    |
| `space`             | Page down                            |
| `backspace`         | Page up                              |
| `ctrl+d` / `ctrl+u` | Page down / up                       |
| `/`                 | Search in book                       |
| `n` / `N`           | Next / previous match                |
| `o`                 | Open a book file                     |
| `s`                 | Save current book to library         |
| `b`                 | Add bookmark                         |
| `B`                 | List bookmarks                       |
| `t`                 | Table of contents                    |
| `i`                 | Book info                            |
| `?`                 | Help                                 |
| `:`                 | Command line                         |
| `enter`             | Select / open                        |
| `escape`            | Back                                 |
| `q`                 | Quit (library) / close book (reader) |

### Command line

| Command           | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `:open <path>`    | Open a book file (falls back to picker)                  |
| `:theme <name>`   | Switch theme                                             |
| `:themes`         | List available themes                                    |
| `:sort <field>`   | Sort library by `title`, `author`, `added` or `progress` |
| `:group`          | Toggle group-by-series in the library                    |
| `:goto <page>`    | Jump to a page number in the reader                      |
| `:simplified`     | Toggle simplified reading mode                           |
| `:search <query>` | Search the current book                                  |
| `:q` / `:quit`    | Quit                                                     |

## Configuration

`tabook` looks for `$XDG_CONFIG_HOME/tabook/config.toml`
(default `~/.config/tabook/config.toml`). The default database is
`$XDG_CONFIG_HOME/tabook/library.db`.

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

Built-in themes: `dracula`, `monokai`, `ayu-dark`, `ayu-light`, `github-dark`,
`github-light`, `gruvbox-dark`, `gruvbox-light`, `nord`, `solarized-dark`,
`solarized-light`, `one-dark`, `catppuccin-mocha`, `catppuccin-latte`.

## Development

```bash
npm run dev -- book.fb2       # run from source via tsx
npm test                      # unit tests (vitest)
npm run test:coverage         # tests with coverage thresholds
npm run lint                  # eslint
npm run typecheck             # tsc --noEmit
npm run build                 # compile to dist/
```

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
  tui/        Ink components (library, reader, help, modals)
  utils/      text, paths, zip and error helpers
```

## License

MIT
