//! Inline parsing — port of `src/formats/inline.ts`. Phase 3.

use crate::model::Inline;
use crate::xml::{attr_of, children_of, XmlNode};

pub fn parse_inlines(nodes: &[XmlNode]) -> Vec<Inline> {
    parse_children(nodes)
}

fn parse_children(nodes: &[XmlNode]) -> Vec<Inline> {
    let mut result = Vec::new();
    for kid in nodes {
        match kid {
            XmlNode::Text(t) => {
                let decoded = crate::text::decode_entities_standalone(t);
                if !decoded.is_empty() {
                    result.push(Inline::text_node(decoded));
                }
            }
            XmlNode::Element { .. } => {
                let tag = crate::xml::normalize_tag(kid.tag());
                result.extend(parse_element(kid, tag));
            }
        }
    }
    result
}

fn parse_element(node: &XmlNode, tag: &str) -> Vec<Inline> {
    let kids: Vec<XmlNode> = children_of(node).into_iter().cloned().collect();
    match tag {
        "br" => vec![Inline::line_break()],
        "image" => vec![Inline::image(
            attr_of(Some(node), "href").unwrap_or_default(),
            attr_of(Some(node), "alt").unwrap_or_default(),
        )],
        "a" => {
            let href = attr_of(Some(node), "href").unwrap_or_default();
            vec![Inline::link(href, parse_children(&kids))]
        }
        "span" => parse_children(&kids),
        "strong" | "b" => vec![Inline::style("bold", parse_children(&kids))],
        "emphasis" | "em" | "i" => vec![Inline::style("italic", parse_children(&kids))],
        "strikethrough" | "strike" | "s" | "del" => {
            vec![Inline::style("strike", parse_children(&kids))]
        }
        "u" | "ins" => vec![Inline::style("underline", parse_children(&kids))],
        "code" => vec![Inline::code(plain_of(&parse_children(&kids)))],
        _ => parse_children(&kids),
    }
}

pub fn plain_of(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline.kind.as_str() {
            "text" => out.push_str(inline.text.as_deref().unwrap_or("")),
            "bold" | "italic" | "underline" | "strike" | "link" => {
                if let Some(children) = &inline.children {
                    out.push_str(&plain_of(children));
                }
            }
            "code" => out.push_str(inline.text.as_deref().unwrap_or("")),
            "image" => out.push_str(inline.alt.as_deref().unwrap_or("")),
            "lineBreak" => out.push('\n'),
            _ => {}
        }
    }
    out
}

pub fn normalize_inlines(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut result = Vec::new();
    for inline in inlines {
        match inline.kind.as_str() {
            "text" => {
                // Mirror src/formats/inline.ts normalizeInlines: collapse runs
                // of whitespace to a single space WITHOUT trimming the node — a
                // leading/trailing space inside a text node separates it from
                // the neighboring inline element ("Привет <b>мир</b>" keeps the
                // space before <b>). The earlier port used
                // split_whitespace().join(" "), which trimmed every node and
                // merged words across inline markup ("First paragraph
                // with<strong>bold</strong>"). Whole-list trimming happens in
                // trim_inlines below, exactly like the TS original.
                let mut collapsed =
                    String::with_capacity(inline.text.as_deref().map_or(0, str::len));
                let mut prev_space = false;
                for c in inline.text.as_deref().unwrap_or("").chars() {
                    if c.is_whitespace() {
                        if prev_space {
                            continue;
                        }
                        prev_space = true;
                        collapsed.push(' ');
                    } else {
                        prev_space = false;
                        collapsed.push(c);
                    }
                }
                if !collapsed.is_empty() {
                    result.push(Inline::text_node(collapsed));
                }
            }
            "lineBreak" | "code" | "image" => result.push(inline),
            "bold" | "italic" | "underline" | "strike" | "link" => {
                let children = inline.children.clone().unwrap_or_default();
                let normalized = normalize_inlines(children);
                if !normalized.is_empty() {
                    result.push(Inline {
                        children: Some(normalized),
                        ..inline
                    });
                }
            }
            _ => {}
        }
    }
    trim_inlines(result)
}

fn trim_inlines(mut inlines: Vec<Inline>) -> Vec<Inline> {
    while let Some(first) = inlines.first() {
        if first.kind == "text" {
            let t = first.text.as_deref().unwrap_or("");
            let trimmed = t.trim_start();
            if trimmed.is_empty() {
                inlines.remove(0);
                continue;
            }
            if trimmed.len() != t.len() {
                inlines[0] = Inline::text_node(trimmed.to_owned());
            }
        }
        break;
    }
    while let Some(last) = inlines.last() {
        if last.kind == "text" {
            let t = last.text.as_deref().unwrap_or("");
            let trimmed = t.trim_end();
            if trimmed.is_empty() {
                inlines.pop();
                continue;
            }
            if trimmed.len() != t.len() {
                let new_last = Inline::text_node(trimmed.to_owned());
                *inlines.last_mut().unwrap() = new_last;
            }
        }
        break;
    }
    inlines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse_xml_inner;

    #[test]
    fn parse_simple_inlines() {
        let nodes = parse_xml_inner("<p>hello <b>bold</b></p>").unwrap();
        let inlines = parse_inlines(&nodes[0].children());
        assert_eq!(inlines.len(), 2);
        assert_eq!(inlines[0].kind, "text");
        assert_eq!(inlines[1].kind, "bold");
    }

    #[test]
    fn link_parsed() {
        let nodes = parse_xml_inner("<a href=\"/x\">link text</a>").unwrap();
        let inlines = parse_inlines(&nodes);
        assert_eq!(inlines.len(), 1);
        assert_eq!(inlines[0].kind, "link");
        assert_eq!(inlines[0].href.as_deref(), Some("/x"));
    }

    #[test]
    fn normalize_collapses_whitespace() {
        let raw = vec![Inline::text_node("  hello   world  ".to_owned())];
        let out = normalize_inlines(raw);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text.as_deref(), Some("hello world"));
    }

    #[test]
    fn normalize_keeps_inter_element_spaces() {
        // Regression: the per-node split_whitespace() trim merged words across
        // inline markup — "<p>with <strong>bold</strong> and</p>" rendered
        // "withboldand". A single leading/trailing space inside a text node is
        // significant (it separates the word from the neighboring element); only
        // runs of whitespace collapse, and whole-list trimming stays in
        // trim_inlines (parity: src/parity/fb2.parity.test.ts).
        let raw = vec![
            Inline::text_node("with ".to_owned()),
            Inline::style("bold", vec![Inline::text_node("bold".to_owned())]),
            Inline::text_node(" and".to_owned()),
        ];
        let out = normalize_inlines(raw);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].text.as_deref(), Some("with "));
        assert_eq!(out[2].text.as_deref(), Some(" and"));
        // A run of spaces still collapses to one.
        let spaced = vec![Inline::text_node("a   b".to_owned())];
        let out2 = normalize_inlines(spaced);
        assert_eq!(out2[0].text.as_deref(), Some("a b"));
    }
}
