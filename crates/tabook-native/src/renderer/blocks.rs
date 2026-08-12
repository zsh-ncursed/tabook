//! blockToPlainText — port of `src/renderer/blocks.ts`. Phase 7.

use crate::model::{Block, Inline};

pub fn inline_text(inlines: &[Inline]) -> String {
    let mut out = String::new();
    walk_inlines(inlines, &mut out);
    out
}

fn walk_inlines(inlines: &[Inline], out: &mut String) {
    for inline in inlines {
        match inline.kind.as_str() {
            "text" => out.push_str(inline.text.as_deref().unwrap_or("")),
            "bold" | "italic" | "underline" | "strike" | "link" => {
                if let Some(children) = &inline.children {
                    walk_inlines(children, out);
                }
            }
            "code" => out.push_str(inline.text.as_deref().unwrap_or("")),
            "image" => out.push_str(inline.alt.as_deref().unwrap_or("")),
            "lineBreak" => out.push(' '),
            _ => {}
        }
    }
}

pub fn block_to_plain_text(block: &Block) -> String {
    match block.r#type.as_str() {
        "paragraph" | "code" | "heading" | "quote" | "annotation" | "epigraph" => {
            inline_text(block.children.as_deref().unwrap_or(&[]))
        }
        "list" => {
            let mut parts = Vec::new();
            for item in block.items.as_deref().unwrap_or(&[]) {
                let t = inline_text(&item.children);
                if !t.is_empty() {
                    parts.push(t);
                }
                for nested in &item.nested {
                    let nt = block_to_plain_text(nested);
                    if !nt.is_empty() {
                        parts.push(nt);
                    }
                }
            }
            parts.join("\n")
        }
        "table" => {
            let mut parts = Vec::new();
            if let Some(headers) = &block.headers {
                let h: Vec<String> = headers.iter().map(|h| inline_text(h)).collect();
                let joined = h.join(" | ");
                if !joined.is_empty() {
                    parts.push(joined);
                }
            }
            if let Some(rows) = &block.rows {
                for row in rows {
                    let r: Vec<String> = row.iter().map(|c| inline_text(c)).collect();
                    let joined = r.join(" | ");
                    if !joined.is_empty() {
                        parts.push(joined);
                    }
                }
            }
            parts.join("\n")
        }
        "poem" => {
            let stanzas = block.stanzas.as_deref().unwrap_or(&[]);
            let mut lines = Vec::new();
            for stanza in stanzas {
                for line in &stanza.lines {
                    lines.push(inline_text(line));
                }
            }
            lines.join("\n")
        }
        "image" => block.alt.clone().unwrap_or_default(),
        "empty" => String::new(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraph_plain() {
        let block = Block::paragraph(vec![Inline::text_node("hello")]);
        assert_eq!(block_to_plain_text(&block), "hello");
    }

    #[test]
    fn empty_block() {
        let block = Block::empty();
        assert_eq!(block_to_plain_text(&block), "");
    }

    #[test]
    fn image_alt() {
        let block = Block::image("src", "cover alt");
        assert_eq!(block_to_plain_text(&block), "cover alt");
    }
}