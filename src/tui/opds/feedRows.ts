import type { OpdsFeed, OpdsEntry, OpdsFacet } from '../../opds/model.js';
import { CARD_ROWS } from '../listLayout.js';

// A displayable row in the browsing feed: a facet group header, a facet, or
// an acquisition/subsection entry. Entry rows are CARD_ROWS tall; everything
// else is one line.
export type BrowsingRow =
  | { kind: 'facet-group'; label: string }
  | { kind: 'facet'; facet: OpdsFacet }
  | { kind: 'entry'; entry: OpdsEntry };

export function rowHeight(row: BrowsingRow): number {
  return row.kind === 'entry' ? CARD_ROWS : 1;
}

// Build the browsing row list from a feed: facets grouped by facet group,
// then acquisition entries. Pure so it can be unit-tested in isolation.
export function feedToRows(feed: OpdsFeed | null): BrowsingRow[] {
  if (!feed) return [];
  const result: BrowsingRow[] = [];
  const grouped = new Map<string, OpdsFacet[]>();
  for (const facet of feed.facets) {
    const arr = grouped.get(facet.group) ?? [];
    arr.push(facet);
    grouped.set(facet.group, arr);
  }
  for (const [group, facets] of grouped) {
    result.push({ kind: 'facet-group', label: group });
    for (const f of facets) {
      result.push({ kind: 'facet', facet: f });
    }
  }
  for (const entry of feed.entries) {
    result.push({ kind: 'entry', entry });
  }
  return result;
}
