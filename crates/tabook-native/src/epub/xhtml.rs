//! EPUB XHTML → Block — Rust port of `src/formats/epub/xhtml.ts` (189 LOC).
//!
//! Bugfix from audit: `findContainingBlock` assigned the container id to the
//! LAST emitted block. The correct behavior (and what TOC links expect) is to
//! assign it to the FIRST content block inside the container. The TS version
//! at xhtml.ts:160 already does this via `findFirstContentBlock`, but the
//! audit noted the bug was in an earlier version. We keep the correct behavior
//! here and test it explicitly.

use crate::inline::{normalize_inlines, parse_inlines};
use crate::model::{Block, Inline, ListItem};
use crate::xml::{attr_of, children_of, find_children, full_text_of, normalize_tag, XmlNode};
use std::collections::HashMap;

pub fn parse_xhtml_blocks(
    nodes: &[XmlNode],
    base_dir: &str,
) -> (Vec<Block>, HashMap<String, i32>) {
    let mut blocks = Vec::new();
    let mut id_to_block = HashMap::new();
    let mut block_index = 0i32;
    parse_nodes(&mut blocks, &mut id_to_block, &mut block_index, nodes, base_dir);
    (blocks, id_to_block)
}

fn emit(blocks: &mut Vec<Block>, block_index: &mut i32, block: Block) {
    blocks.push(block);
    *block_index += 1;
}

fn parse_list_element(node: &XmlNode, ordered: bool) -> Block {
    let mut items = Vec::new();
    for li in find_children(node, "li") {
        let kids = children_of(li);
        let mut item_inlines = Vec::new();
        let mut nested = Vec::new();
        for kid in kids {
            let tag = normalize_tag(kid.tag());
            if tag == "ul" || tag == "ol" {
                nested.push(parse_list_element(kid, tag == "ol"));
            } else {
                item_inlines.extend(parse_inlines(std::slice::from_ref(kid)));
            }
        }
        items.push(ListItem {
            children: normalize_inlines(item_inlines),
            nested,
        });
    }
    Block::list(ordered, items)
}

fn parse_table_element(node: &XmlNode) -> Block {
    let rows = find_children(node, "tr");
    let mut table_rows = Vec::new();
    let mut headers: Vec<Vec<Inline>> = Vec::new();
    for tr in rows {
        let tds = find_children(tr, "td");
        let ths = find_children(tr, "th");
        let cells: Vec<&XmlNode> = tds.iter().chain(ths.iter()).copied().collect();
        let cell_inlines: Vec<Vec<Inline>> = cells
            .iter()
            .map(|c| normalize_inlines(parse_inlines(std::slice::from_ref(c))))
            .collect();
        if headers.is_empty() && !ths.is_empty() {
            headers = cell_inlines;
        } else {
            table_rows.push(cell_inlines);
        }
    }
    Block::table(headers, table_rows)
}

fn find_first_content_block(blocks: &[Block], from: i32) -> Option<i32> {
    let start = from as usize;
    for (i, block) in blocks.iter().enumerate().skip(start) {
        if block.r#type == "heading" || block.r#type == "paragraph" || block.r#type == "image" {
            return Some(i as i32);
        }
    }
    None
}

fn parse_nodes(
    blocks: &mut Vec<Block>,
    id_to_block: &mut HashMap<String, i32>,
    block_index: &mut i32,
    nodes: &[XmlNode],
    base_dir: &str,
) {
    for node in nodes {
        parse_node(blocks, id_to_block, block_index, node, base_dir);
    }
}

fn parse_node(
    blocks: &mut Vec<Block>,
    id_to_block: &mut HashMap<String, i32>,
    block_index: &mut i32,
    node: &XmlNode,
    base_dir: &str,
) {
    let tag = normalize_tag(node.tag()).to_owned();
    let id = attr_of(Some(node), "id");
    let children = children_of(node);
    match tag.as_str() {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            let level = tag[1..].parse::<i32>().unwrap_or(1);
            emit(blocks, block_index, Block::heading(level, normalize_inlines(parse_inlines(std::slice::from_ref(node)))));
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "p" => {
            let inlines = normalize_inlines(parse_inlines(std::slice::from_ref(node)));
            if inlines.is_empty() {
                emit(blocks, block_index, Block::empty());
            } else {
                emit(blocks, block_index, Block::paragraph(inlines));
            }
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "pre" => {
            let raw = full_text_of(Some(node));
            let inlines = if !raw.is_empty() {
                vec![Inline::code(raw)]
            } else {
                Vec::new()
            };
            emit(blocks, block_index, Block::code(inlines));
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "blockquote" => {
            emit(blocks, block_index, Block::quote(normalize_inlines(parse_inlines(std::slice::from_ref(node)))));
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "ul" => {
            emit(blocks, block_index, parse_list_element(node, false));
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "ol" => {
            emit(blocks, block_index, parse_list_element(node, true));
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "table" => {
            emit(blocks, block_index, parse_table_element(node));
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "img" => {
            let src = attr_of(Some(node), "src").unwrap_or_default();
            let resolved = if src.is_empty() { src } else { crate::href::resolve_href(base_dir, &src) };
            emit(blocks, block_index, Block::image(resolved, attr_of(Some(node), "alt").unwrap_or_default()));
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "hr" => {
            emit(blocks, block_index, Block::empty());
            if let Some(id) = id {
                id_to_block.insert(id, *block_index - 1);
            }
        }
        "figure" | "div" | "section" | "article" | "main" | "aside" | "hgroup" | "form" => {
            // Bugfix: assign container id to the FIRST content block inside,
            // not the last. The TS version already does this correctly via
            // findFirstContentBlock; we mirror it here and test explicitly.
            let start = *block_index;
            let kids: Vec<XmlNode> = children.into_iter().cloned().collect();
            parse_nodes(blocks, id_to_block, block_index, &kids, base_dir);
            if let Some(id) = id {
                if blocks.len() as i32 > start {
                    if let Some(idx) = find_first_content_block(blocks, start) {
                        id_to_block.insert(id, idx);
                    }
                }
            }
        }
        "header" | "footer" | "nav" | "script" | "style" | "title" | "head" => {}
        _ => {
            if !children.is_empty() {
                let kids: Vec<XmlNode> = children.into_iter().cloned().collect();
                parse_nodes(blocks, id_to_block, block_index, &kids, base_dir);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse_xml_inner;

    #[test]
    fn parses_heading_with_id() {
        let nodes = parse_xml_inner("<h1 id=\"start\">Chapter One</h1>").unwrap();
        let (blocks, ids) = parse_xhtml_blocks(&nodes, "");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].r#type, "heading");
        assert_eq!(ids.get("start"), Some(&0));
    }

    #[test]
    fn parses_paragraph() {
        let nodes = parse_xml_inner("<p>hello <b>world</b></p>").unwrap();
        let (blocks, _) = parse_xhtml_blocks(&nodes, "");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].r#type, "paragraph");
    }

    #[test]
    fn empty_paragraph_becomes_empty_block() {
        let nodes = parse_xml_inner("<p></p>").unwrap();
        let (blocks, _) = parse_xhtml_blocks(&nodes, "");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].r#type, "empty");
    }

    #[test]
    fn parses_list() {
        let nodes = parse_xml_inner("<ul><li>a</li><li>b</li></ul>").unwrap();
        let (blocks, _) = parse_xhtml_blocks(&nodes, "");
        assert_eq!(blocks.len(), 1);
        let items = blocks[0].items.as_ref().unwrap();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn parses_table() {
        let nodes = parse_xml_inner("<table><tr><th>H</th></tr><tr><td>v</td></tr></table>").unwrap();
        let (blocks, _) = parse_xhtml_blocks(&nodes, "");
        assert_eq!(blocks.len(), 1);
        let t = &blocks[0];
        assert_eq!(t.headers.as_ref().unwrap().len(), 1);
        assert_eq!(t.rows.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn container_id_goes_to_first_content_block_not_last() {
        // Bugfix test: <section id="s"> with a heading then paragraph.
        // The id should map to the heading (first content block), not the
        // trailing paragraph (which the buggy version assigned).
        let nodes = parse_xml_inner("<section id=\"s\"><h1>Title</h1><p>Body</p></section>").unwrap();
        let (blocks, ids) = parse_xhtml_blocks(&nodes, "");
        assert!(blocks.len() >= 2);
        assert_eq!(blocks[0].r#type, "heading");
        assert_eq!(blocks[1].r#type, "paragraph");
        assert_eq!(ids.get("s"), Some(&0), "id should map to first content block (heading), not last");
    }

    #[test]
    fn img_src_resolved_against_base_dir() {
        let nodes = parse_xml_inner("<img src=\"images/cover.jpg\" alt=\"cover\"/>").unwrap();
        let (blocks, _) = parse_xhtml_blocks(&nodes, "OEBPS");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].src.as_deref(), Some("OEBPS/images/cover.jpg"));
    }

    #[test]
    fn pre_preserves_whitespace() {
        let nodes = parse_xml_inner("<pre>line1\nline2</pre>").unwrap();
        let (blocks, _) = parse_xhtml_blocks(&nodes, "");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].r#type, "code");
        let children = blocks[0].children.as_ref().unwrap();
        assert_eq!(children[0].kind, "code");
        assert!(children[0].text.as_deref().unwrap().contains("line1"));
    }
}