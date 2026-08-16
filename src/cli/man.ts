// The tabook man page, rendered as roff (man -l tabook.1 or `tabook --man`).
//
// The COMMANDS and KEYBINDINGS sections are generated from the same
// source-of-truth registries the app uses (src/tui/commands.ts and
// src/config/defaults.ts), so the man page can never drift from the app.
import { COMMANDS } from '../tui/commands.js';
import { DEFAULT_KEYBINDINGS, KEY_ACTIONS } from '../config/defaults.js';
import { appVersion } from '../utils/version.js';

// One-line human description per key action, used by the KEYBINDINGS section.
const KEY_ACTION_DESC: Record<string, string> = {
  move_cursor_up: 'move the cursor up',
  move_cursor_down: 'move the cursor down',
  move_cursor_left: 'move the cursor left',
  move_cursor_right: 'move the cursor right',
  scroll_up: 'scroll up',
  scroll_down: 'scroll down',
  page_up: 'page up',
  page_down: 'page down',
  go_to_start: 'jump to the start',
  go_to_end: 'jump to the end',
  select: 'select / open',
  back: 'back / close',
  quit: 'quit',
  open_file: 'open a file',
  save_to_library: 'save to the library',
  delete_from_library: 'delete from the library',
  delete_file: 'delete the file',
  add_bookmark: 'add a bookmark',
  list_bookmarks: 'list bookmarks',
  toc: 'open the table of contents',
  book_info: 'show book info',
  help: 'show help',
  command: 'open the command prompt',
  command_palette: 'open the command palette (fuzzy search)',
  search: 'search',
  search_next: 'next search result',
  search_prev: 'previous search result',
  next_chapter: 'next chapter',
  prev_chapter: 'previous chapter',
  sort_cycle: 'cycle the sort order',
  toggle_simplified: 'toggle simplified mode',
  toggle_respect_css: 'toggle publisher CSS',
  toggle_justify: 'toggle justification',
  toggle_wide: 'toggle wide layout',
  toggle_recent: 'toggle the recent view',
  toggle_continue: 'toggle continue-reading',
  zoom_image: 'zoom the image',
};

// Keys are printed literally (e.g. `ctrl+d`, `]`, `gg`); only backslashes and
// hyphens need escaping in roff body text.
function roffEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/-/g, '\\-');
}

function defaultKeys(action: string): string {
  return Object.entries(DEFAULT_KEYBINDINGS)
    .filter(([, a]) => a === action)
    .map(([key]) => key)
    .join(', ');
}

function commandsSection(): string {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const cmd of COMMANDS) {
    if (seen.has(cmd.usage)) continue;
    seen.add(cmd.usage);
    rows.push('.TP');
    rows.push(`.B ${roffEscape(cmd.usage)}`);
    rows.push(roffEscape(cmd.desc));
  }
  return rows.join('\n');
}

function keybindingsSection(): string {
  const rows: string[] = [];
  for (const action of KEY_ACTIONS) {
    const desc = KEY_ACTION_DESC[action];
    if (!desc) continue;
    const keys = defaultKeys(action);
    if (!keys) continue;
    rows.push('.TP');
    rows.push(`.B ${roffEscape(keys)}`);
    rows.push(roffEscape(desc));
  }
  return rows.join('\n');
}

let cached: string | null = null;

/** The full man page text (roff format). */
export function manPage(): string {
  if (cached !== null) return cached;
  cached = `\
.TH TABOOK 1 "${dateStamp()}" "tabook ${appVersion()}" "User Commands"
.SH NAME
tabook \\- terminal e-book reader for FB2 and EPUB
.SH SYNOPSIS
.B tabook
[\\fIoptions\\fR] [\\fIfile\\fR]
.SH DESCRIPTION
.B tabook
is a keyboard-driven TUI e-book reader for FB2, FB2.ZIP and EPUB files.
It keeps your library and reading progress in a local SQLite database,
supports in-book search, bookmarks, annotations, OPDS catalogs with
downloads, and is fully configurable through a TOML config file.
.SH OPTIONS
.TP
.BR \\-V ", " \\-\\-version
Output the version number.
.TP
.BR \\-h ", " \\-\\-help
Display help.
.TP
.B \\-\\-library
Open the library view instead of a book.
.TP
.BI \\-\\-theme " <name>"
Theme to use, overriding the config. Run
.B :themes
inside the app to list the available themes.
.TP
.BI \\-\\-config " <path>"
Path to the config file (default:
.BR ~/.config/tabook/config.toml ).
.TP
.B \\-\\-man
Print this man page to stdout and exit.
.TP
.BI \\-\\-completion " <shell>"
Print a completion script for
.B bash
or
.B zsh
to stdout and exit.
.SH FILE
.TP
.BI file
A book file
.RB ( .fb2 ,
.BR .fb2.zip ,
.BR .epub )
to open, or a directory, which is attached as a library folder and opens
the library view.
.SH COMMANDS
Inside the TUI, press
.B :
to open the command prompt. The following commands are available:
${commandsSection()}
.SH KEYBINDINGS
All keys are configurable in the
.B keybindings
section of the config file; the defaults are:
${keybindingsSection()}
.SH CONFIGURATION
The configuration lives in
.BR ~/.config/tabook/config.toml .
It controls the theme, keybindings, typography, simplified reading mode and
the status bar layout. Inside the app,
.B :config edit
opens the file in
.BR $EDITOR
and reloads it live, and
.B :config init
writes a default config file.
.SH FILES
.TP
.B ~/.config/tabook/config.toml
Configuration file.
.TP
.B ~/.config/tabook/library.db
Library database (books, reading progress, annotations, OPDS catalogs).
.TP
.B ~/.config/tabook/library.db.key
Encryption key for OPDS catalog passwords (mode 0600).
.TP
.B ~/.cache/tabook/downloads
Downloaded OPDS books.
.SH EXIT STATUS
.TP
.B 0
Success.
.TP
.B 1
Configuration, database or file errors.
.SH SEE ALSO
.BR tabook (1)
is documented further in the repository's
.B README.md
and
.B docs/
directory; inside the app, press
.B ?
for the built-in help.
`;
  return cached;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
