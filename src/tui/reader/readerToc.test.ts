import { describe, it, expect } from 'vitest';
import type { TocEntry } from '../../formats/model.js';
import { topLevelChapters, hasDirectChildHeadings, directChildHeadings } from './readerToc.js';

function tocEntry(id: string, label: string, level: number, blockIndex: number): TocEntry {
  return { id, label, level, blockIndex };
}

describe('topLevelChapters', () => {
  it('returns entries at the minimum level', () => {
    const toc = [
      tocEntry('a', 'A', 2, 0),
      tocEntry('b', 'B', 1, 1),
      tocEntry('c', 'C', 1, 2),
      tocEntry('d', 'D', 2, 3),
    ];
    expect(topLevelChapters(toc).map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('returns everything when the TOC is flat', () => {
    const toc = [tocEntry('a', 'A', 1, 0), tocEntry('b', 'B', 1, 1)];
    expect(topLevelChapters(toc).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('returns [] for an empty TOC', () => {
    expect(topLevelChapters([])).toEqual([]);
  });
});

describe('hasDirectChildHeadings', () => {
  it('detects a direct child one level below', () => {
    const toc = [
      tocEntry('ch1', 'Ch 1', 1, 0),
      tocEntry('sub', 'Sub', 2, 1),
      tocEntry('ch2', 'Ch 2', 1, 2),
    ];
    expect(hasDirectChildHeadings(toc, 'ch1')).toBe(true);
    expect(hasDirectChildHeadings(toc, 'ch2')).toBe(false);
  });

  it('ignores deeper levels (not direct children)', () => {
    const toc = [tocEntry('ch1', 'Ch 1', 1, 0), tocEntry('deep', 'Deep', 3, 1)];
    expect(hasDirectChildHeadings(toc, 'ch1')).toBe(false);
  });

  it('is safe for unknown ids', () => {
    const toc = [tocEntry('ch1', 'Ch 1', 1, 0)];
    expect(hasDirectChildHeadings(toc, 'nope')).toBe(false);
  });
});

describe('directChildHeadings', () => {
  it('lists only direct children in order', () => {
    const toc = [
      tocEntry('ch1', 'Ch 1', 1, 0),
      tocEntry('suba', 'Sub A', 2, 1),
      tocEntry('subb', 'Sub B', 2, 3),
      tocEntry('ch2', 'Ch 2', 1, 5),
      tocEntry('subc', 'Sub C', 2, 6),
    ];
    expect(directChildHeadings(toc, 'ch1').map((h) => h.label)).toEqual(['Sub A', 'Sub B']);
    expect(directChildHeadings(toc, 'ch1')[0]!.blockIndex).toBe(1);
    expect(directChildHeadings(toc, 'ch2').map((h) => h.label)).toEqual(['Sub C']);
    expect(directChildHeadings(toc, 'nope')).toEqual([]);
  });

  it('excludes nested deeper levels', () => {
    const toc = [
      tocEntry('ch1', 'Ch 1', 1, 0),
      tocEntry('sub', 'Sub', 2, 1),
      tocEntry('deep', 'Deep', 3, 2),
    ];
    expect(directChildHeadings(toc, 'ch1').map((h) => h.label)).toEqual(['Sub']);
  });

  it('normalizes whitespace and drops empty labels', () => {
    const toc = [
      tocEntry('ch1', 'Ch 1', 1, 0),
      tocEntry('sub', '  Sub   A  ', 2, 1),
      tocEntry('blank', '   \t ', 2, 2),
    ];
    expect(directChildHeadings(toc, 'ch1').map((h) => h.label)).toEqual(['Sub A']);
  });
});
