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
                let collapsed: String = inline
                    .text
                    .as_deref()
                    .unwrap_or("")
                    .chars()
                    .map(|c| if c.is_whitespace() { ' ' } else { c })
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
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
}