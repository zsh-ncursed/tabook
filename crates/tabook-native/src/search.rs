//! Search index — port of `src/search/index.ts`. Phase 9 stub.

use crate::model::Block;
use crate::renderer::blocks::block_to_plain_text;

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
        // lowercase → NFKD decompose → strip combining marks
        let lc: String = ch.to_lowercase().nfkd().filter(|c| {
            let cp = *c as u32;
            !(0x0300..=0x036f).contains(&cp)
        }).collect();
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

pub fn build_index(blocks: &[Block]) -> Vec<FoldedBlock> {
    blocks
        .iter()
        .map(|b| fold_text(&block_to_plain_text(b)))
        .collect()
}

pub fn normalize_query(query: &str) -> String {
    let folded = fold_text(query);
    let s: String = folded.folded.split_whitespace().collect::<Vec<_>>().join(" ");
    s
}

pub fn search_in_block(folded: &FoldedBlock, query: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    if folded.folded.is_empty() {
        return out;
    }
    let mut idx = folded.folded.find(query);
    while let Some(start) = idx {
        let end_idx = start + query.len();
        if end_idx > folded.folded.len() {
            break;
        }
        let orig_start = folded.fold_to_orig[start];
        let orig_end = folded.fold_to_orig.get(end_idx - 1).copied().unwrap_or(0) + 1;
        out.push((orig_start, orig_end));
        idx = folded.folded[start + 1..].find(query).map(|i| start + 1 + i);
    }
    out
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
        let index = build_index(&blocks);
        let matches = search_in_block(&index[0], "fox");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].0, 16); // start offset of 'fox'
    }

    #[test]
    fn normalize_query_collapses() {
        assert_eq!(normalize_query("  The   Quick "), "the quick");
    }
}