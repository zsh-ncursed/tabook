//! Search index — Rust port of `src/search/index.ts` (127 LOC).
//!
//! Builds a fold map per book block: each character is lowercased, NFKD-decomposed
//! and stripped of combining marks, so `İstanbul` matches `istanbul`. All match
//! offsets are stored in original-text coordinates (code points in Rust, not
//! UTF-16 as in the TS version — this is the bugfix from the audit). Highlights
//! are generated per block on demand.

use crate::model::Block;
use crate::renderer::blocks::block_to_plain_text;
use crate::renderer::layout::HighlightRange;

const MAX_MATCHES: usize = 10_000;

#[derive(Debug, Clone)]
pub struct FoldedBlock {
    pub folded: String,
    pub fold_to_orig: Vec<usize>,
}

fn fold_text(text: &str) -> FoldedBlock {
    use unicode_normalization::UnicodeNormalization;

    let mut folded = String::with_capacity(text.len());
    let mut fold_to_orig: Vec<usize> = Vec::with_capacity(text.len());
    let mut prev_was_space = false;
    let mut char_idx = 0usize;
    for ch in text.chars() {
        // lowercase → NFKD decompose → strip combining marks (U+0300..U+036F)
        let lc: String = ch
            .to_lowercase()
            .nfkd()
            .filter(|c| {
                let cp = *c as u32;
                !(0x0300..=0x036f).contains(&cp)
            })
            .collect();
        for c in lc.chars() {
            if c.is_whitespace() {
                if prev_was_space {
                    continue;
                }
                folded.push(' ');
                fold_to_orig.push(char_idx);
                prev_was_space = true;
            } else {
                folded.push(c);
                fold_to_orig.push(char_idx);
                prev_was_space = false;
            }
        }
        char_idx += 1;
    }
    FoldedBlock { folded, fold_to_orig }
}

pub struct BookSearchIndex {
    folded: Vec<FoldedBlock>,
}

#[derive(Debug, Clone)]
pub struct SearchMatch {
    pub block_index: i32,
    pub start: i32,
    pub end: i32,
}

impl BookSearchIndex {
    pub fn new(blocks: &[Block]) -> Self {
        let folded = blocks.iter().map(|b| fold_text(&block_to_plain_text(b))).collect();
        Self { folded }
    }

    pub fn block_count(&self) -> i32 {
        self.folded.len() as i32
    }

    pub fn search(&self, query: &str) -> Vec<SearchMatch> {
        let q = normalize_query(query);
        if q.is_empty() {
            return Vec::new();
        }
        let mut matches = Vec::new();
        for (b, fb) in self.folded.iter().enumerate() {
            if fb.folded.is_empty() {
                continue;
            }
            for (start, end) in search_in_block_raw(fb, &q) {
                matches.push(SearchMatch {
                    block_index: b as i32,
                    start: start as i32,
                    end: end as i32,
                });
                if matches.len() >= MAX_MATCHES {
                    return matches;
                }
            }
        }
        matches
    }

    pub fn block_highlights(&self, query: &str, block_index: i32) -> Vec<HighlightRange> {
        let q = normalize_query(query);
        if q.is_empty() {
            return Vec::new();
        }
        let Some(fb) = self.folded.get(block_index as usize) else {
            return Vec::new();
        };
        if fb.folded.is_empty() {
            return Vec::new();
        }
        search_in_block_raw(fb, &q)
            .into_iter()
            .map(|(start, end)| HighlightRange {
                start: start as i32,
                end: end as i32,
            })
            .collect()
    }

    pub fn highlight_ranges(&self, query: &str) -> Vec<(i32, Vec<HighlightRange>)> {
        let mut out = Vec::new();
        for b in 0..self.folded.len() {
            let ranges = self.block_highlights(query, b as i32);
            if !ranges.is_empty() {
                out.push((b as i32, ranges));
            }
        }
        out
    }
}

fn search_in_block_raw(fb: &FoldedBlock, query: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    if fb.folded.is_empty() {
        return out;
    }
    let mut idx = fb.folded.find(query);
    while let Some(start) = idx {
        let end_idx = start + query.len();
        if end_idx > fb.folded.len() {
            break;
        }
        let orig_start = fb.fold_to_orig[start];
        let orig_end = fb.fold_to_orig.get(end_idx - 1).copied().unwrap_or(0) + 1;
        out.push((orig_start, orig_end));
        idx = fb.folded[start + 1..].find(query).map(|i| start + 1 + i);
    }
    out
}

pub fn normalize_query(query: &str) -> String {
    let folded = fold_text(query);
    folded.folded.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Block;

    fn para(text: &str) -> Block {
        Block::paragraph(vec![crate::model::Inline::text_node(text)])
    }

    #[test]
    fn fold_basic() {
        let f = fold_text("Hello World");
        assert_eq!(f.folded, "hello world");
        assert_eq!(f.fold_to_orig.len(), "Hello World".chars().count());
    }

    #[test]
    fn fold_collapses_whitespace() {
        let f = fold_text("hello   world");
        assert_eq!(f.folded, "hello world");
    }

    #[test]
    fn fold_i_dotted() {
        // 'İ' (U+0130) lowercases to 'i' + combining dot above; NFKD + strip → 'i'
        let f = fold_text("İstanbul");
        assert_eq!(f.folded, "istanbul");
    }

    #[test]
    fn search_finds_match() {
        let blocks = vec![para("The quick brown fox")];
        let index = BookSearchIndex::new(&blocks);
        let matches = index.search("fox");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].block_index, 0);
        assert_eq!(matches[0].start, 16);
        assert_eq!(matches[0].end, 19);
    }

    #[test]
    fn search_empty_query() {
        let blocks = vec![para("hello")];
        let index = BookSearchIndex::new(&blocks);
        assert!(index.search("").is_empty());
        assert!(index.search("   ").is_empty());
    }

    #[test]
    fn search_no_match() {
        let blocks = vec![para("hello world")];
        let index = BookSearchIndex::new(&blocks);
        assert!(index.search("zebra").is_empty());
    }

    #[test]
    fn search_multiple_matches_in_block() {
        let blocks = vec![para("fox and fox and fox")];
        let index = BookSearchIndex::new(&blocks);
        let matches = index.search("fox");
        assert_eq!(matches.len(), 3);
    }

    #[test]
    fn search_across_blocks() {
        let blocks = vec![
            para("The quick brown fox"),
            para("A lazy dog and another fox"),
            Block::heading(1, vec![crate::model::Inline::text_node("FOX CHAPTER")]),
            para("Nothing here"),
        ];
        let index = BookSearchIndex::new(&blocks);
        let matches = index.search("fox");
        assert_eq!(matches.len(), 3);
        let mut block_indices: Vec<i32> = matches.iter().map(|m| m.block_index).collect();
        block_indices.sort();
        assert_eq!(block_indices, vec![0, 1, 2]);
    }

    #[test]
    fn normalize_query_collapses() {
        assert_eq!(normalize_query("  The   Quick "), "the quick");
    }

    #[test]
    fn block_highlights_lazy() {
        let blocks = vec![para("The quick brown fox"), para("nothing")];
        let index = BookSearchIndex::new(&blocks);
        let hls = index.block_highlights("fox", 0);
        assert_eq!(hls.len(), 1);
        assert_eq!(hls[0].start, 16);
        assert_eq!(hls[0].end, 19);
        let hls_empty = index.block_highlights("fox", 1);
        assert!(hls_empty.is_empty());
    }

    #[test]
    fn unicode_offsets_in_code_points() {
        // Bugfix test: 'İ' (U+0130) folds to 'i'. In Rust we work in code points,
        // so offsets are code-point indices, not UTF-16 (the TS bug).
        let blocks = vec![para("xİstanbul y")];
        let index = BookSearchIndex::new(&blocks);
        let matches = index.search("istanbul");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].start, 1);
        assert_eq!(matches[0].end, 9);
    }

    #[test]
    fn collapses_whitespace_in_block_text() {
        let blocks = vec![para("hello  world"), para("a\n\tb")];
        let index = BookSearchIndex::new(&blocks);
        assert_eq!(index.search("hello world").len(), 1);
        assert_eq!(index.search("a b").len(), 1);
    }

    #[test]
    fn highlight_ranges_collects_all() {
        let blocks = vec![para("fox here"), para("no match"), para("fox there")];
        let index = BookSearchIndex::new(&blocks);
        let ranges = index.highlight_ranges("fox");
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].0, 0);
        assert_eq!(ranges[1].0, 2);
    }
}