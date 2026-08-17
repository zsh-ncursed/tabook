import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { EntryDetail } from './EntryDetail.js';
import type { Theme } from '../../themes/themes.js';
import type { OpdsEntry } from '../../opds/model.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';

const theme: Theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;

function entry(overrides: Partial<OpdsEntry> = {}): OpdsEntry {
  return {
    id: 'e1',
    title: 'Test Book',
    updated: '2024-01-01',
    authors: [{ name: 'Author One' }],
    categories: [],
    links: [],
    acquisitionLinks: [],
    isAcquisition: true,
    isNavigation: false,
    ...overrides,
  };
}

// Lines between the 'Summary:' header and the download hint (the hint box has
// a marginTop, so a blank separator line is filtered out).
function summaryLines(frame: string): string[] {
  const lines = frame.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'Summary:');
  const end = lines.findIndex((l) => l.includes('Press d or enter to download'));
  if (start < 0 || end < start) return [];
  return lines.slice(start + 1, end).filter((l) => l.trim() !== '');
}

describe('EntryDetail (presentational)', () => {
  it('renders metadata lines and the download hint, no summary header when absent', () => {
    const { lastFrame } = render(
      <EntryDetail
        entry={entry({ publisher: 'Pub', language: 'ru', issued: '2024' })}
        theme={theme}
        width={80}
        height={24}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Title: Test Book');
    expect(frame).toContain('Author: Author One');
    expect(frame).toContain('Publisher: Pub');
    expect(frame).toContain('Language: ru');
    expect(frame).toContain('Year: 2024');
    expect(frame).toContain('Press d or enter to download · esc to go back');
    expect(frame).not.toContain('Summary:');
  });

  it('wraps the summary into multiple lines', () => {
    const summary = Array.from({ length: 40 }, () => 'word').join(' ');
    const { lastFrame } = render(
      <EntryDetail entry={entry({ summary })} theme={theme} width={80} height={24} />,
    );
    const lines = summaryLines(lastFrame() ?? '');
    expect(lines.length).toBeGreaterThan(1);
    // Full text is present (joined with spaces by the wrap).
    expect(lines.join(' ').replace(/\s+/g, ' ').trim()).toBe(summary);
  });

  it('does not emit a blank line before a long CJK word', () => {
    // A single unbreakable word of 30 CJK characters: the old char-count wrap
    // pushed an empty first line ('' + word) before it; the display-width
    // version keeps the word on the first summary line.
    const summary = '汉字'.repeat(30);
    const { lastFrame } = render(
      <EntryDetail entry={entry({ summary })} theme={theme} width={60} height={24} />,
    );
    const lines = summaryLines(lastFrame() ?? '');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('汉字');
  });

  it('caps the summary at the available height', () => {
    const summary = Array.from({ length: 200 }, () => 'word').join(' ');
    const { lastFrame } = render(
      <EntryDetail entry={entry({ summary })} theme={theme} width={80} height={12} />,
    );
    // width 80 → textWidth 76; metadata(Title, Author) + Summary: + hint →
    // maxLines = max(5, 12 − 2 − 8) = 5.
    const lines = summaryLines(lastFrame() ?? '');
    expect(lines.length).toBeLessThanOrEqual(5);
  });
});
