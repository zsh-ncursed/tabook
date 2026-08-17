import type { TocEntry } from '../../formats/model.js';
import { normalizeWhitespace } from '../../utils/text.js';

// A subheading of a chapter, as listed under it in the TOC modal.
export interface TocHeading {
  blockIndex: number;
  label: string;
}

// Top-level TOC entries (the chapters the TOC modal lists by default):
// the minimum level present in the TOC.
export function topLevelChapters(toc: TocEntry[]): TocEntry[] {
  if (toc.length === 0) return [];
  let minLevel = Infinity;
  for (const e of toc) if (e.level < minLevel) minLevel = e.level;
  return toc.filter((e) => e.level === minLevel);
}

// Whether a chapter has at least one direct subheading: a TOC entry exactly
// one level below it, appearing before the next entry at its own level or
// higher. Only TOC entries count — a bare heading block at childLevel without
// a matching TOC entry is a sub-subheading nested inside a deeper chapter,
// not a direct child.
export function hasDirectChildHeadings(toc: TocEntry[], chapterId: string): boolean {
  const idx = toc.findIndex((e) => e.id === chapterId);
  if (idx < 0) return false;
  for (let i = idx + 1; i < toc.length; i++) {
    if (toc[i]!.level <= toc[idx]!.level) break;
    if (toc[i]!.level === toc[idx]!.level + 1) return true;
  }
  return false;
}

// Direct children of a chapter from the TOC itself (see
// hasDirectChildHeadings for what counts as a direct child). Bare heading
// blocks at childLevel without a TOC entry would pollute the direct-children
// list, so they are excluded. Empty labels are dropped.
export function directChildHeadings(toc: TocEntry[], chapterId: string): TocHeading[] {
  const idx = toc.findIndex((e) => e.id === chapterId);
  const out: TocHeading[] = [];
  if (idx < 0) return out;
  const childLevel = toc[idx]!.level + 1;
  for (let i = idx + 1; i < toc.length; i++) {
    if (toc[i]!.level <= toc[idx]!.level) break;
    if (toc[i]!.level === childLevel) {
      const label = normalizeWhitespace(toc[i]!.label);
      if (label !== '') out.push({ blockIndex: toc[i]!.blockIndex, label });
    }
  }
  return out;
}
