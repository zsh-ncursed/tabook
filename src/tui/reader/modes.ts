// Reader view modes. In its own module because the mode is shared by the
// reader component (state + dispatch), the reading-mode action dispatcher and
// the TOC/bookmarks hook — a single source of truth instead of three copies.
export type Mode =
  | 'reading'
  | 'search'
  | 'command'
  | 'bookmark'
  | 'bookmark-edit'
  | 'bookmarks'
  | 'toc'
  | 'toc-filter'
  | 'info'
  | 'zoom';
