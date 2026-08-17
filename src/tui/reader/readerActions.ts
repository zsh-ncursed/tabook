import type { KeyAction } from '../../config/defaults.js';
import { truncate } from '../../utils/text.js';
import type { ReaderSession } from './readerModel.js';
import type { Mode } from './modes.js';

// Context for dispatchReaderAction: everything the reading-mode action switch
// needs beyond the session itself. Built fresh on every render (the caller
// recreates handleAction each render anyway).
export interface ReaderActionContext {
  session: ReaderSession;
  notify: (message: string) => void;
  onSave: () => number | null;
  onOpenFile: () => void;
  onClose: () => void;
  onHelp: () => void;
  onOpenPalette?: () => void;
  setMode: (m: Mode) => void;
  clearSelection: () => void;
  forceTick: () => void;
  openBookmarks: () => void;
  openToc: () => void;
}

// Reading-mode action handling, extracted from the component so it can be
// unit-tested against a mock session without rendering the reader.
export function dispatchReaderAction(
  action: KeyAction | undefined,
  ctx: ReaderActionContext,
): void {
  const {
    session,
    notify,
    onSave,
    onOpenFile,
    onClose,
    onHelp,
    onOpenPalette,
    setMode,
    clearSelection,
    forceTick,
    openBookmarks,
    openToc,
  } = ctx;
  switch (action) {
    case 'move_cursor_down':
    case 'scroll_down':
      clearSelection();
      session.scrollDown(1);
      forceTick();
      break;
    case 'move_cursor_up':
    case 'scroll_up':
      clearSelection();
      session.scrollUp(1);
      forceTick();
      break;
    case 'page_down':
      clearSelection();
      session.pageDown();
      forceTick();
      break;
    case 'page_up':
      clearSelection();
      session.pageUp();
      forceTick();
      break;
    case 'go_to_start':
      clearSelection();
      session.goToStart();
      forceTick();
      break;
    case 'go_to_end':
      clearSelection();
      session.goToEnd();
      forceTick();
      break;
    case 'search':
      clearSelection();
      setMode('search');
      break;
    case 'search_next':
      clearSelection();
      if (session.nextMatch()) {
        forceTick();
        const st = session.searchState();
        notify(`Match ${st.current + 1} of ${st.matches}`);
      } else {
        notify('No search results');
      }
      break;
    case 'search_prev':
      clearSelection();
      if (session.prevMatch()) {
        forceTick();
        const st = session.searchState();
        notify(`Match ${st.current + 1} of ${st.matches}`);
      } else {
        notify('No search results');
      }
      break;
    case 'next_chapter':
    case 'prev_chapter': {
      clearSelection();
      const label = action === 'next_chapter' ? session.nextChapter() : session.prevChapter();
      if (label !== null) {
        forceTick();
        notify(`Chapter: ${truncate(label, 40)}`);
      } else {
        notify(
          action === 'next_chapter'
            ? 'Already at the last chapter'
            : 'Already at the first chapter',
        );
      }
      break;
    }
    case 'add_bookmark':
      setMode('bookmark');
      break;
    case 'list_bookmarks':
      clearSelection();
      openBookmarks();
      break;
    case 'toc':
      clearSelection();
      openToc();
      break;
    case 'book_info':
      setMode('info');
      break;
    case 'zoom_image':
      clearSelection();
      if (session.viewportLines().some((l) => l.role === 'image')) {
        setMode('zoom');
      } else {
        notify('No image on this page');
      }
      break;
    case 'command':
      setMode('command');
      break;
    case 'command_palette':
      onOpenPalette?.();
      break;
    case 'save_to_library':
      onSave();
      break;
    case 'open_file':
      onOpenFile();
      break;
    case 'quit':
    case 'back':
      onClose();
      break;
    case 'help':
      onHelp();
      break;
    case 'toggle_simplified':
      clearSelection();
      session.setSimplified(!session.isSimplified);
      forceTick();
      notify(`Simplified mode: ${session.isSimplified ? 'on' : 'off'}`);
      break;
    case 'toggle_respect_css':
      notify('Publisher CSS is not implemented yet; no setting was changed');
      break;
    case 'toggle_justify':
      clearSelection();
      session.setJustify(!session.isJustify);
      forceTick();
      notify(`Text justify: ${session.isJustify ? 'on' : 'off'}`);
      break;
    case 'toggle_wide':
      clearSelection();
      session.setWide(!session.isWide);
      forceTick();
      notify(`Wide screen: ${session.isWide ? 'on' : 'off'}`);
      break;
    case 'move_cursor_left':
    case 'move_cursor_right':
      // ponytail: horizontal scroll not implemented; no-op to keep keymap valid
      break;
    default:
      break;
  }
}

// Context-aware hint for the StatusBar right side, reflecting the keys that
// are actionable in the current reader mode. Kept compact (key-only, no
// labels) so it fits on narrow terminals; the full mapping lives in Help (?).
export function readerHint(mode: Mode): string {
  switch (mode) {
    case 'reading':
      return 'j/k · space · [ ] · / · b · t · i · z · J · W · ? · q';
    case 'zoom':
      return 'esc close';
    case 'search':
      return 'type · enter search · esc cancel';
    case 'command':
      return 'type · enter run · esc cancel';
    case 'bookmark':
    case 'bookmark-edit':
      return 'type · enter save · esc cancel';
    case 'bookmarks':
      return 'j/k · enter · e · d · ? help · esc';
    case 'toc':
      return 'j/k · space expand · enter jump · / · ? help · esc';
    case 'toc-filter':
      return 'type · enter · esc';
    case 'info':
      return '? help · esc close';
    default:
      return '';
  }
}
