# Configuration

`tabook` is configured with a TOML file. On startup it looks for
`$XDG_CONFIG_HOME/tabook/config.toml` (default `~/.config/tabook/config.toml`).
If the file does not exist, built-in defaults are used and a warning is printed.

You can point to a different file with `--config <path>`:

```bash
tabook --config ~/my-tabook.toml book.epub
```

Every option is optional — an option you leave out keeps its default. Unknown
top-level keys are reported as warnings (not errors) so a typo like
`[typograhy]` is surfaced instead of silently ignored.

## Options reference

```toml
# The built-in theme to use. See docs/THEMES.md for the catalog.
theme = "dracula"

# Path to the SQLite library database. `~` is expanded to the home directory.
# Empty means the default ($XDG_CONFIG_HOME/tabook/library.db).
db_path = ""

[keybindings]
# Map key names to actions. See "Keybindings" below.
j = "move_cursor_down"

[typography]
measure = 80            # characters per line (integer, 20-500)
line_spacing = 0        # blank lines between text lines (integer, 0-5)
paragraph_indent = 0    # indent of the first line of a paragraph (integer, 0-20)
paragraph_spacing = 1   # blank lines between paragraphs (integer, 0-5)
hyphenation = false     # hyphenate long words at line breaks
justify = false         # justify text to the full measure

[display]
simplified_mode = false      # flatten lists/poems/tables into paragraphs
respect_publisher_css = true # honor publisher CSS from EPUBs
show_progress_bar = true     # show the progress bar in the status bar
```

### `theme`

Name of a built-in theme (see `docs/THEMES.md`). The default is `dracula`.
A value prefixed with `custom:` (e.g. `custom:my-theme`) is accepted without
the "unknown theme" warning, so a future custom-theme mechanism can hook in.

### `db_path`

Path to the SQLite database that stores the library (books, progress,
bookmarks, reading sessions, history). A leading `~` is expanded. When empty,
`$XDG_CONFIG_HOME/tabook/library.db` is used.

### `[keybindings]`

Remap keys to actions. Keys are case-insensitive and whitespace is ignored
(`Ctrl+D`, `ctrl+d` and `ctrl + d` are all the same). Multi-key sequences
such as `gg` are supported as plain strings.

Actions you can bind to:

| Action                | Default key           | Meaning                          |
| --------------------- | --------------------- | -------------------------------- |
| `move_cursor_up`      | `k`                   | Move up / scroll up              |
| `move_cursor_down`    | `j`                   | Move down / scroll down          |
| `move_cursor_left`    | `h`                   | Move left                        |
| `move_cursor_right`   | `l`                   | Move right                       |
| `scroll_up`           | —                     | Scroll up                        |
| `scroll_down`         | —                     | Scroll down                      |
| `page_up`             | `backspace`, `pageup` | Previous page                    |
| `page_down`           | `space`, `pagedown`   | Next page                        |
| `go_to_start`         | `gg`                  | Go to start                      |
| `go_to_end`           | `G`                   | Go to end                        |
| `select`              | `enter`               | Select / open                    |
| `back`                | `escape`              | Back                             |
| `quit`                | `q`                   | Quit / close view                |
| `open_file`           | `o`                   | Open a book file                 |
| `save_to_library`     | `s`                   | Save current book to the library |
| `delete_from_library` | `d`                   | Delete from library              |
| `add_bookmark`        | `b`                   | Add a bookmark                   |
| `list_bookmarks`      | `B`                   | List bookmarks                   |
| `toc`                 | `t`                   | Table of contents                |
| `book_info`           | `i`                   | Book info                        |
| `help`                | `?`                   | Help screen                      |
| `command`             | `:`                   | Command line                     |
| `search`              | `/`                   | Search in book                   |
| `search_next`         | `n`                   | Next search result               |
| `search_prev`         | `N`                   | Previous search result           |
| `sort_cycle`          | —                     | Cycle library sort order         |
| `toggle_simplified`   | —                     | Toggle simplified mode           |
| `toggle_respect_css`  | —                     | Toggle publisher CSS             |
| `toggle_justify`      | `J`                   | Toggle text justify              |
| `toggle_wide`         | `W`                   | Toggle wide screen               |
| `toggle_recent`       | `R`                   | Toggle recent books              |

`ctrl+d` / `ctrl+u` are bound to `page_down` / `page_up` by default.

**Conflicts:** binding the same key twice to different actions in your config
is an error (`KeybindingConflictError`) and the app refuses to start with an
explanatory message. An unknown action name is ignored with a warning.

### `[typography]`

| Key                 | Default | Range  | Meaning                             |
| ------------------- | ------- | ------ | ----------------------------------- |
| `measure`           | `80`    | 20-500 | Characters per line (columns)       |
| `line_spacing`      | `0`     | 0-5    | Blank lines between text lines      |
| `paragraph_indent`  | `0`     | 0-20   | First-line indent of a paragraph    |
| `paragraph_spacing` | `1`     | 0-5    | Blank lines between paragraphs      |
| `hyphenation`       | `false` | bool   | Hyphenate long words at line breaks |
| `justify`           | `false` | bool   | Justify text to the full measure    |

Integer values outside the allowed range are clamped to it; non-integer values
are ignored with a warning.

### `[display]`

| Key                     | Default | Meaning                                          |
| ----------------------- | ------- | ------------------------------------------------ |
| `simplified_mode`       | `false` | Flatten lists/poems/tables into plain paragraphs |
| `respect_publisher_css` | `true`  | Honor publisher CSS from EPUB documents          |
| `show_progress_bar`     | `true`  | Show the reading progress bar in the status bar  |

## CLI overrides

| Flag              | Meaning                                    |
| ----------------- | ------------------------------------------ |
| `--theme <name>`  | Theme override (validated before startup)  |
| `--config <path>` | Config file to load instead of the default |
| `--library`       | Open the library view                      |
| `[file]`          | Open a book file directly                  |

## In-app command line (`:`)

| Command                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `:open <path>`           | Open a book file                                    |
| `:theme <name>`          | Switch theme                                        |
| `:themes`                | List available themes                               |
| `:sort <field>`          | Sort library by `title`/`author`/`added`/`progress` |
| `:group`                 | Toggle group-by-series in the library               |
| `:goto <page>`           | Jump to a page number in the reader                 |
| `:simplified`            | Toggle simplified reading mode                      |
| `:search <query>`        | Search the current book                             |
| `:config edit`           | Open the config file in `$EDITOR` and reload        |
| `:library add <path>`    | Attach a local folder as a library (recursive scan) |
| `:library remove <path>` | Detach a folder; its books leave the library        |
| `:library list`          | List attached folders                               |
| `:library scan`          | Rescan all attached folders                         |
| `:q` / `:quit`           | Quit                                                |

`Tab` completes commands, theme names and `:library` subcommands in the prompt.

## Local folder libraries

`tabook` can treat a local folder (scanned recursively) as a library. Folders
are stored in the database — no config changes needed — and are managed from
inside the app:

```
:library add ~/books       # attach a folder and scan it
:library list              # list attached folders
:library scan              # rescan all attached folders
:library remove ~/books    # detach; its books leave the library
```

- Supported formats: `.fb2`, `.fb2.zip`, `.epub` (case-insensitive).
- Attached folders are rescanned automatically on startup and every time you
  return to the library view (from the reader or OPDS) — but only if files
  actually changed since the last scan (mtime comparison, no re-parsing of
  unchanged books), so large libraries don't pay for a full rescan on every
  entry. The change check itself is asynchronous and chunked, so walking
  large folders never blocks the interface. `:library add` always scans the
  new folder; use `:library scan` to force a full rescan of everything.
- Books whose files disappear from a folder are removed from the library on
  the next scan (reading progress and bookmarks go with them).
- Detaching a folder (`:library remove`, confirmed with `y`/`N`) removes its
  books — progress and bookmarks included — but never touches the files on
  disk. Re-attaching the folder brings the books back with fresh metadata.
- Hidden subdirectories (`.git`, `.Trash`, …) are skipped during the scan.

You can also attach a folder straight from the shell:

```bash
tabook ~/books
```

A directory passed as the positional argument is attached and the library
view opens instead of a book file.
