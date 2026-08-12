//! simplify — port of `src/renderer/simplify.ts`. Phase 7.

use crate::model::{Block, Inline, ListItem};

pub fn simplify_blocks_with_map(blocks: &[Block]) -> (Vec<Block>, Vec<i32>) {
    let mut result = Vec::new();
    let mut map = Vec::with_capacity(blocks.len());
    for block in blocks {
        map.push(result.len() as i32);
        result.extend(simplify_block(block));
    }
    (result, map)
}

fn simplify_block(block: &Block) -> Vec<Block> {
    match block.r#type.as_str() {
        "heading" | "paragraph" | "code" => vec![block.clone()],
        "list" => block
            .items
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .flat_map(simplify_item)
            .collect(),
        "quote" | "epigraph" | "annotation" => vec![Block::paragraph(
            block.children.clone().unwrap_or_default(),
        )],
        "poem" => block
            .stanzas
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|stanza| {
                let mut children: Vec<Inline> = Vec::new();
                for (i, line) in stanza.lines.iter().enumerate() {
                    if i > 0 {
                        children.push(Inline::text_node(" "));
                    }
                    children.extend(line.iter().cloned());
                }
                Block::paragraph(children)
            })
            .collect(),
        "table" => block
            .rows
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|cells| {
                let mut children: Vec<Inline> = Vec::new();
                for (i, cell) in cells.iter().enumerate() {
                    if i > 0 {
                        children.push(Inline::text_node(" | "));
                    }
                    children.extend(cell.iter().cloned());
                }
                Block::paragraph(children)
            })
            .collect(),
        "image" | "empty" => Vec::new(),
        _ => Vec::new(),
    }
}

fn simplify_item(item: &ListItem) -> Vec<Block> {
    let mut result = Vec::new();
    let children = if item.children.is_empty() {
        vec![Inline::text_node("")]
    } else {
        item.children.clone()
    };
    result.push(Block::paragraph(children));
    for nested in &item.nested {
        result.extend(simplify_block(nested));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraph_unchanged() {
        let block = Block::paragraph(vec![Inline::text_node("hi")]);
        let (out, map) = simplify_blocks_with_map(&[block]);
        assert_eq!(out.len(), 1);
        assert_eq!(map, vec![0]);
    }

    #[test]
    fn image_dropped() {
        let block = Block::image("x", "y");
        let (out, map) = simplify_blocks_with_map(&[block]);
        assert!(out.is_empty());
        assert_eq!(map, vec![0]);
    }

    #[test]
    fn poem_to_paragraphs() {
        let stanza = crate::model::Stanza {
            lines: vec![vec![Inline::text_node("a")], vec![Inline::text_node("b")]],
        };
        let block = Block::poem(vec![stanza]);
        let (out, _) = simplify_blocks_with_map(&[block]);
        assert_eq!(out.len(), 1);
        let plain = crate::renderer::blocks::inline_text(out[0].children.as_deref().unwrap_or(&[]));
        assert_eq!(plain, "a b");
    }
}