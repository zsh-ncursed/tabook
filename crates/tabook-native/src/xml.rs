//! XML parsing — port of `src/formats/xml.ts`. Phase 3.

use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Clone)]
pub struct XmlAttr {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub enum XmlNode {
    Element {
        tag: String,
        attrs: Vec<XmlAttr>,
        children: Vec<XmlNode>,
    },
    Text(String),
}

impl XmlNode {
    pub fn tag(&self) -> &str {
        match self {
            XmlNode::Element { tag, .. } => tag,
            _ => "",
        }
    }

    pub fn children(&self) -> &[XmlNode] {
        match self {
            XmlNode::Element { children, .. } => children,
            _ => &[],
        }
    }

    pub fn attrs(&self) -> &[XmlAttr] {
        match self {
            XmlNode::Element { attrs, .. } => attrs,
            _ => &[],
        }
    }
}

/// Strip namespace prefix: `ns:tag` → `tag`.
pub fn normalize_tag(tag: &str) -> &str {
    match tag.find(':') {
        Some(idx) => &tag[idx + 1..],
        None => tag,
    }
}

fn normalize_attr_name(name: &str) -> &str {
    match name.find(':') {
        Some(idx) => &name[idx + 1..],
        None => name,
    }
}

fn xx_check_inner(text: &str) -> Result<(), String> {
    // Byte-slicing at an arbitrary index would panic when a multi-byte UTF-8
    // char (e.g. Cyrillic) straddles the 2048 boundary — clamp to the nearest
    // char boundary instead.
    let doctype_slice = &text[..text.floor_char_boundary(text.len().min(2048))];
    if let Some(start) = doctype_slice.find("<!DOCTYPE") {
        if let Some(end) = doctype_slice[start..].find('>') {
            let decl = &doctype_slice[start..start + end];
            if decl.contains("SYSTEM") || decl.contains("PUBLIC") {
                return Err(
                    "Refused XML with external entity declaration (potential XXE)".to_owned(),
                );
            }
        }
    }
    Ok(())
}

pub(crate) fn parse_xml_inner(text: &str) -> Result<Vec<XmlNode>, String> {
    xx_check_inner(text)?;
    parse_xml_inner_raw(text).map_err(|e| format!("XML parse error: {e}"))
}

fn parse_xml_inner_raw(text: &str) -> Result<Vec<XmlNode>, quick_xml::Error> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(false);
    let mut stack: Vec<XmlNode> = Vec::new();
    let mut roots: Vec<XmlNode> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Empty(e) => {
                let attrs = attrs_from_event(&e);
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let node = XmlNode::Element {
                    tag,
                    attrs,
                    children: vec![],
                };
                if let Some(XmlNode::Element { children, .. }) = stack.last_mut() {
                    children.push(node);
                } else {
                    roots.push(node);
                }
            }
            Event::Start(e) => {
                let attrs = attrs_from_event(&e);
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let node = XmlNode::Element {
                    tag,
                    attrs,
                    children: vec![],
                };
                stack.push(node);
            }
            Event::End(_) => {
                if let Some(node) = stack.pop() {
                    if let Some(XmlNode::Element { children, .. }) = stack.last_mut() {
                        children.push(node);
                    } else {
                        roots.push(node);
                    }
                }
            }
            Event::Text(e) => {
                let text = e.unescape()?;
                let node = XmlNode::Text(text.into_owned());
                if let Some(XmlNode::Element { children, .. }) = stack.last_mut() {
                    children.push(node);
                } else {
                    roots.push(node);
                }
            }
            Event::CData(e) => {
                let text = String::from_utf8_lossy(e.into_inner().as_ref()).into_owned();
                let node = XmlNode::Text(text);
                if let Some(XmlNode::Element { children, .. }) = stack.last_mut() {
                    children.push(node);
                } else {
                    roots.push(node);
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(roots)
}

fn attrs_from_event(e: &quick_xml::events::BytesStart) -> Vec<XmlAttr> {
    e.attributes()
        .filter_map(Result::ok)
        .map(|a| XmlAttr {
            name: String::from_utf8_lossy(a.key.as_ref()).into_owned(),
            value: String::from_utf8_lossy(&a.value).into_owned(),
        })
        .collect()
}

// ----- Helpers (port of xml.ts) -----

pub fn children_of(node: &XmlNode) -> Vec<&XmlNode> {
    node.children().iter().collect()
}

pub fn find_children<'a>(node: &'a XmlNode, tag: &str) -> Vec<&'a XmlNode> {
    node.children()
        .iter()
        .filter(|kid| normalize_tag(kid.tag()) == tag)
        .collect()
}

pub fn first_child<'a>(node: Option<&'a XmlNode>, tag: &str) -> Option<&'a XmlNode> {
    node.and_then(|n| find_children(n, tag).into_iter().next())
}

pub fn text_of(node: Option<&XmlNode>) -> String {
    let Some(node) = node else { return String::new() };
    let mut out = String::new();
    for kid in node.children() {
        if let XmlNode::Text(t) = kid {
            out.push_str(t);
        }
    }
    crate::text::decode_entities_standalone(&out)
}

pub fn full_text_of(node: Option<&XmlNode>) -> String {
    let Some(node) = node else { return String::new() };
    let mut out = String::new();
    collect_text(node, &mut out);
    crate::text::decode_entities_standalone(&out)
}

fn collect_text(node: &XmlNode, out: &mut String) {
    for kid in node.children() {
        match kid {
            XmlNode::Text(t) => out.push_str(t),
            XmlNode::Element { .. } => collect_text(kid, out),
        }
    }
}

pub fn attributes_of(node: &XmlNode) -> Vec<(&str, &str)> {
    node.attrs()
        .iter()
        .map(|a| (normalize_attr_name(&a.name), a.value.as_str()))
        .collect()
}

pub fn attr_of(node: Option<&XmlNode>, name: &str) -> Option<String> {
    node.and_then(|n| {
        n.attrs().iter().find(|a| normalize_attr_name(&a.name) == name).map(|a| a.value.clone())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple() {
        let nodes = parse_xml_inner("<root><a>hi</a></root>").unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].tag(), "root");
        let kids = nodes[0].children();
        assert_eq!(kids.len(), 1);
        assert_eq!(kids[0].tag(), "a");
        let text = text_of(Some(&kids[0]));
        assert_eq!(text, "hi");
    }

    #[test]
    fn namespaces_stripped() {
        let nodes = parse_xml_inner("<ns:root xmlns:ns=\"x\"><ns:a>v</ns:a></ns:root>").unwrap();
        assert_eq!(normalize_tag(nodes[0].tag()), "root");
        let kid = &nodes[0].children()[0];
        assert_eq!(normalize_tag(kid.tag()), "a");
    }

    #[test]
    fn xxe_rejected() {
        let xml = "<!DOCTYPE foo SYSTEM \"file:///etc/passwd\"><root/>";
        let result = xx_check_inner(xml);
        assert!(result.is_err());
    }

    #[test]
    fn xx_check_multibyte_straddle_no_panic() {
        // A Cyrillic 'в' straddling byte 2048 used to panic with "end byte
        // index 2048 is not a char boundary" (real Flibusta OPDS feeds with
        // Russian titles hit this). Must not panic and must still detect a
        // DOCTYPE that sits inside the scanned window.
        let mut xml = String::from("<!DOCTYPE a SYSTEM \"x\">");
        // Pad with ASCII to exactly 2047 bytes, so the 'в' below occupies
        // bytes 2047..2049 — straddling byte 2048.
        while xml.len() < 2047 {
            xml.push('a');
        }
        assert_eq!(xml.len(), 2047);
        xml.push('в');
        xml.push_str("<root/>");
        assert!(xx_check_inner(&xml).is_err());

        // A safe feed with Cyrillic content past the boundary must parse.
        let mut ok = String::from("<feed><title>Книги по авторам</title>");
        while ok.len() < 3000 {
            ok.push_str("Пелевин ");
        }
        ok.push_str("</feed>");
        let nodes = parse_xml_inner(&ok).unwrap();
        assert_eq!(normalize_tag(nodes[0].tag()), "feed");
    }

    #[test]
    fn attrs_preserved() {
        let nodes =
            parse_xml_inner("<a id=\"x\" class=\"c\" xmlns:y=\"u\" y:href=\"link\">t</a>").unwrap();
        let a = &nodes[0];
        let attrs = attributes_of(a);
        let ids: Vec<_> = attrs.iter().filter(|(k, _)| *k == "id").collect();
        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0].1, "x");
    }

    #[test]
    fn full_text_recurses() {
        let nodes = parse_xml_inner("<a>x<b>y</b>z</a>").unwrap();
        assert_eq!(full_text_of(Some(&nodes[0])), "xyz");
    }
}