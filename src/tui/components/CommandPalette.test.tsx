import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { CommandPalette } from './CommandPalette.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';
import type { BookRecord } from '../../db/db.js';

const theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;

function makeBook(partial: Partial<BookRecord>): BookRecord {
  return {
    id: 1,
    path: '/tmp/book.fb2',
    filename: 'book.fb2',
    format: 'fb2',
    size: 100,
    title: 'Book',
    authors: [],
    authorsText: '',
    genres: [],
    annotation: '',
    lang: 'ru',
    seriesText: null,
    addedAt: '2026-01-01 00:00:00',
    lastOpenedAt: null,
    progressPercent: null,
    progressPosition: null,
    ...partial,
  };
}

async function settle(ms = 30): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function renderPalette(props: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  return render(
    <CommandPalette theme={theme} screen="reader" onRun={vi.fn()} onClose={vi.fn()} {...props} />,
  );
}

describe('CommandPalette', () => {
  it('shows commands for the active screen and runs the selected one', async () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    const { stdin, lastFrame } = renderPalette({ onRun, onClose });
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Command palette');
    expect(frame).toContain(':simplified');
    // Reader-only commands are present, library-only ones are not.
    expect(frame).toContain(':goto <page>');
    expect(frame).not.toContain(':sort <field>');
    // Enter on the top row runs the first command.
    stdin.write('\r');
    await settle();
    expect(onRun).toHaveBeenCalledWith(':open');
    expect(onClose).toHaveBeenCalled();
  });

  it('filters by fuzzy query as you type', async () => {
    const { stdin, lastFrame } = renderPalette();
    await settle();
    for (const ch of 'simpl') {
      stdin.write(ch);
      await settle(5);
    }
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain(':simplified');
    expect(frame).not.toContain(':open [path]');
  });

  it('moves the cursor with arrow keys and runs the highlighted command', async () => {
    const onRun = vi.fn();
    const { stdin } = renderPalette({ screen: 'library', onRun });
    await settle();
    // The library command list starts with :open, then :theme. Move down once
    // and run: :theme should be executed.
    stdin.write('\u001b[B');
    await settle();
    stdin.write('\r');
    await settle();
    expect(onRun).toHaveBeenCalledWith(':theme');
  });

  it('types j/k into the query instead of navigating (searchable descriptions)', async () => {
    const { stdin, lastFrame } = renderPalette();
    await settle();
    stdin.write('j');
    await settle(5);
    const frame = lastFrame() ?? '';
    // 'Jump' is in the :goto description, so a plain 'j' still matches it
    // (cursor stays on the first row; nothing ran).
    expect(frame).toContain(':goto <page>');
  });

  it('esc closes without running anything', async () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    const { stdin } = renderPalette({ onRun, onClose });
    await settle();
    stdin.write('\u001b');
    await settle();
    expect(onRun).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('backspace edits the query', async () => {
    const { stdin, lastFrame } = renderPalette();
    await settle();
    for (const ch of 'thm') {
      stdin.write(ch);
      await settle(5);
    }
    await settle();
    expect(lastFrame() ?? '').toContain(':theme');
    stdin.write('\u007f');
    await settle(5);
    // 'th' still matches :theme (prefix); the list stays non-empty.
    expect(lastFrame() ?? '').toContain(':theme');
  });

  it('offers library books matching the query alongside commands', async () => {
    const books = [
      makeBook({
        id: 1,
        title: 'Harry Potter and the Philosopher\u2019s Stone',
        authorsText: 'J. K. Rowling',
      }),
      makeBook({ id: 2, title: 'The Hobbit', authorsText: 'J. R. R. Tolkien' }),
    ];
    const { stdin, lastFrame } = renderPalette({ books });
    await settle();
    for (const ch of 'harr') {
      stdin.write(ch);
      await settle(5);
    }
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Harry Potter');
    // The non-matching book is filtered out.
    expect(frame).not.toContain('The Hobbit');
  });

  it('opens a book with enter when a book row is selected', async () => {
    const books = [makeBook({ id: 1, title: 'Anna Karenina', authorsText: 'Leo Tolstoy' })];
    const onOpenBook = vi.fn();
    const onClose = vi.fn();
    const { stdin } = renderPalette({ books, onOpenBook, onClose });
    await settle();
    // A book-only query makes the book the first (and only) row.
    for (const ch of 'anna') {
      stdin.write(ch);
      await settle(5);
    }
    await settle();
    stdin.write('\r');
    await settle();
    expect(onOpenBook).toHaveBeenCalledWith(books[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps commands first and runs commands even when books are present', async () => {
    const books = [makeBook({ id: 1, title: 'Open Sesame', authorsText: 'A. Author' })];
    const onRun = vi.fn();
    const { stdin } = renderPalette({ books, onRun });
    await settle();
    // With an empty query only commands are listed; enter runs :open.
    stdin.write('\r');
    await settle();
    expect(onRun).toHaveBeenCalledWith(':open');
  });
});
