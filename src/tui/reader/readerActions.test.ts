import { describe, it, expect, vi } from 'vitest';
import type { KeyAction } from '../../config/defaults.js';
import type { ReaderSession } from './readerModel.js';
import { dispatchReaderAction, type ReaderActionContext } from './readerActions.js';

// Minimal mock — only the session surface dispatchReaderAction touches.
function setup() {
  const session = {
    scrollDown: vi.fn(),
    scrollUp: vi.fn(),
    pageDown: vi.fn(),
    pageUp: vi.fn(),
    goToStart: vi.fn(),
    goToEnd: vi.fn(),
    nextMatch: vi.fn(() => false),
    prevMatch: vi.fn(() => false),
    searchState: vi.fn(() => ({ query: 'q', matches: 2, current: 0 })),
    nextChapter: vi.fn(() => null),
    prevChapter: vi.fn(() => null),
    viewportLines: vi.fn(() => []),
    isSimplified: false,
    setSimplified: vi.fn(),
    isJustify: false,
    setJustify: vi.fn(),
    isWide: false,
    setWide: vi.fn(),
  } as unknown as ReaderSession;
  // The real session mutates its flags on toggle; mirror that so the
  // 'on'/'off' notify (which reads the flag back) matches production.
  const internal = session as unknown as {
    isSimplified: boolean;
    isJustify: boolean;
    isWide: boolean;
    setSimplified: (v: boolean) => void;
    setJustify: (v: boolean) => void;
    setWide: (v: boolean) => void;
  };
  internal.setSimplified = vi.fn((v: boolean) => {
    internal.isSimplified = v;
  });
  internal.setJustify = vi.fn((v: boolean) => {
    internal.isJustify = v;
  });
  internal.setWide = vi.fn((v: boolean) => {
    internal.isWide = v;
  });
  const ctx: ReaderActionContext = {
    session,
    notify: vi.fn(),
    onSave: vi.fn(() => 42),
    onOpenFile: vi.fn(),
    onClose: vi.fn(),
    onHelp: vi.fn(),
    onOpenPalette: vi.fn(),
    setMode: vi.fn(),
    clearSelection: vi.fn(),
    forceTick: vi.fn(),
    openBookmarks: vi.fn(),
    openToc: vi.fn(),
  };
  return { session, ctx };
}

const NAV_ACTIONS: Array<[KeyAction, (s: ReturnType<typeof setup>['session']) => unknown]> = [
  ['move_cursor_down', (s) => s.scrollDown],
  ['scroll_down', (s) => s.scrollDown],
  ['move_cursor_up', (s) => s.scrollUp],
  ['scroll_up', (s) => s.scrollUp],
  ['page_down', (s) => s.pageDown],
  ['page_up', (s) => s.pageUp],
  ['go_to_start', (s) => s.goToStart],
  ['go_to_end', (s) => s.goToEnd],
];

describe('dispatchReaderAction — navigation', () => {
  it.each(NAV_ACTIONS)(
    '%s scrolls the session, clears the selection and re-renders',
    (action, getFn) => {
      const { session, ctx } = setup();
      dispatchReaderAction(action, ctx);
      expect(getFn(session)).toHaveBeenCalledTimes(1);
      expect(ctx.clearSelection).toHaveBeenCalledTimes(1);
      expect(ctx.forceTick).toHaveBeenCalledTimes(1);
    },
  );

  it('page actions scroll by a full page', () => {
    const { session, ctx } = setup();
    dispatchReaderAction('page_down', ctx);
    dispatchReaderAction('page_up', ctx);
    expect(session.pageDown).toHaveBeenCalledTimes(1);
    expect(session.pageUp).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchReaderAction — search', () => {
  it('search opens the search prompt', () => {
    const { ctx } = setup();
    dispatchReaderAction('search', ctx);
    expect(ctx.setMode).toHaveBeenCalledWith('search');
    expect(ctx.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('search_next reports the match position when a match exists', () => {
    const { session, ctx } = setup();
    (session.nextMatch as ReturnType<typeof vi.fn>).mockReturnValue(true);
    dispatchReaderAction('search_next', ctx);
    expect(ctx.notify).toHaveBeenCalledWith('Match 1 of 2');
    expect(ctx.forceTick).toHaveBeenCalledTimes(1);
    expect(ctx.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('search_next notifies when there are no matches', () => {
    const { ctx } = setup();
    dispatchReaderAction('search_next', ctx);
    expect(ctx.notify).toHaveBeenCalledWith('No search results');
    expect(ctx.forceTick).not.toHaveBeenCalled();
  });

  it('search_prev navigates backwards through matches', () => {
    const { session, ctx } = setup();
    (session.prevMatch as ReturnType<typeof vi.fn>).mockReturnValue(true);
    dispatchReaderAction('search_prev', ctx);
    expect(session.prevMatch).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith('Match 1 of 2');
  });
});

describe('dispatchReaderAction — chapters', () => {
  it('next_chapter jumps and notifies with the chapter label', () => {
    const { session, ctx } = setup();
    (session.nextChapter as ReturnType<typeof vi.fn>).mockReturnValue('Chapter Two');
    dispatchReaderAction('next_chapter', ctx);
    expect(session.nextChapter).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith('Chapter: Chapter Two');
    expect(ctx.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('next_chapter at the last chapter says so', () => {
    const { ctx } = setup();
    dispatchReaderAction('next_chapter', ctx);
    expect(ctx.notify).toHaveBeenCalledWith('Already at the last chapter');
  });

  it('prev_chapter at the first chapter says so', () => {
    const { ctx } = setup();
    dispatchReaderAction('prev_chapter', ctx);
    expect(ctx.notify).toHaveBeenCalledWith('Already at the first chapter');
  });
});

describe('dispatchReaderAction — modes & verbs', () => {
  it('add_bookmark / command / book_info switch to their modes', () => {
    const { ctx } = setup();
    dispatchReaderAction('add_bookmark', ctx);
    dispatchReaderAction('command', ctx);
    dispatchReaderAction('book_info', ctx);
    expect(ctx.setMode).toHaveBeenNthCalledWith(1, 'bookmark');
    expect(ctx.setMode).toHaveBeenNthCalledWith(2, 'command');
    expect(ctx.setMode).toHaveBeenNthCalledWith(3, 'info');
  });

  it('list_bookmarks and toc open their modals and clear the selection', () => {
    const { session, ctx } = setup();
    dispatchReaderAction('list_bookmarks', ctx);
    expect(ctx.openBookmarks).toHaveBeenCalledTimes(1);
    expect(ctx.clearSelection).toHaveBeenCalledTimes(1);
    dispatchReaderAction('toc', ctx);
    expect(ctx.openToc).toHaveBeenCalledTimes(1);
    expect(ctx.clearSelection).toHaveBeenCalledTimes(2);
    expect(session.scrollDown).not.toHaveBeenCalled();
  });

  it('zoom_image zooms when the page has an image, notifies otherwise', () => {
    const { session, ctx } = setup();
    (session.viewportLines as ReturnType<typeof vi.fn>).mockReturnValue([
      { role: 'image', blockIndex: 0 },
    ]);
    dispatchReaderAction('zoom_image', ctx);
    expect(ctx.setMode).toHaveBeenCalledWith('zoom');

    (session.viewportLines as ReturnType<typeof vi.fn>).mockReturnValue([]);
    dispatchReaderAction('zoom_image', ctx);
    expect(ctx.notify).toHaveBeenCalledWith('No image on this page');
    // clearSelection runs in both branches (before the image check).
    expect(ctx.clearSelection).toHaveBeenCalledTimes(2);
  });

  it('command_palette opens the palette when provided', () => {
    const { ctx } = setup();
    dispatchReaderAction('command_palette', ctx);
    expect(ctx.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it('save_to_library / open_file / quit / back / help delegate to their callbacks', () => {
    const { ctx } = setup();
    dispatchReaderAction('save_to_library', ctx);
    dispatchReaderAction('open_file', ctx);
    dispatchReaderAction('quit', ctx);
    dispatchReaderAction('back', ctx);
    dispatchReaderAction('help', ctx);
    expect(ctx.onSave).toHaveBeenCalledTimes(1);
    expect(ctx.onOpenFile).toHaveBeenCalledTimes(1);
    expect(ctx.onClose).toHaveBeenCalledTimes(2);
    expect(ctx.onHelp).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchReaderAction — toggles & no-ops', () => {
  it('toggle_simplified flips the flag and notifies', () => {
    const { session, ctx } = setup();
    dispatchReaderAction('toggle_simplified', ctx);
    expect(session.setSimplified).toHaveBeenCalledWith(true);
    expect(ctx.notify).toHaveBeenCalledWith('Simplified mode: on');
  });

  it('toggle_justify and toggle_wide flip their flags and notify', () => {
    const { session, ctx } = setup();
    dispatchReaderAction('toggle_justify', ctx);
    dispatchReaderAction('toggle_wide', ctx);
    expect(session.setJustify).toHaveBeenCalledWith(true);
    expect(session.setWide).toHaveBeenCalledWith(true);
    expect(ctx.notify).toHaveBeenNthCalledWith(1, 'Text justify: on');
    expect(ctx.notify).toHaveBeenNthCalledWith(2, 'Wide screen: on');
  });

  it('toggle_respect_css explains that CSS is not implemented', () => {
    const { ctx } = setup();
    dispatchReaderAction('toggle_respect_css', ctx);
    expect(ctx.notify).toHaveBeenCalledWith(
      'Publisher CSS is not implemented yet; no setting was changed',
    );
  });

  it('horizontal moves and unrelated actions are no-ops', () => {
    for (const action of [
      'move_cursor_left',
      'move_cursor_right',
      'sort_cycle',
      'delete_from_library',
      'delete_file',
      'toggle_recent',
      'toggle_continue',
      undefined,
    ] as Array<KeyAction | undefined>) {
      const { session, ctx } = setup();
      dispatchReaderAction(action, ctx);
      expect(session.scrollDown).not.toHaveBeenCalled();
      expect(ctx.notify).not.toHaveBeenCalled();
      expect(ctx.setMode).not.toHaveBeenCalled();
      expect(ctx.onClose).not.toHaveBeenCalled();
      expect(ctx.forceTick).not.toHaveBeenCalled();
    }
  });
});
