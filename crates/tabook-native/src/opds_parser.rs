//! OPDS Atom parser — Rust port of `src/opds/parser.ts` (204 LOC).
//!
//! Parses OPDS Atom XML feeds into structured OpdsFeed. Used by the OPDS
//! browser (TS HTTP client fetches, Rust parses).

use crate::text::{normalize_whitespace_inner, strip_html_inner};
use crate::xml::{
    attr_of, attributes_of, find_children, first_child, full_text_of, normalize_tag, parse_xml_inner,
    text_of, XmlNode,
};

const ACQUISITION_RELS: &[&str] = &[
    "http://opds-spec.org/acquisition",
    "http://opds-spec.org/acquisition/open-access",
    "http://opds-spec.org/acquisition/buy",
    "http://opds-spec.org/acquisition/borrow",
    "http://opds-spec.org/acquisition/sample",
    "http://opds-spec.org/acquisition/subscribe",
];

#[derive(Debug, Clone)]
pub struct OpdsLink {
    pub rel: String,
    pub href: String,
    pub type_: Option<String>,
    pub title: Option<String>,
    pub length: Option<f64>,
    pub facet_group: Option<String>,
    pub active_facet: bool,
    pub count: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct OpdsFacet {
    pub group: String,
    pub title: String,
    pub href: String,
    pub active: bool,
    pub count: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct OpdsAuthor {
    pub name: String,
    pub uri: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OpdsCategory {
    pub scheme: Option<String>,
    pub term: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OpdsEntry {
    pub id: String,
    pub title: String,
    pub updated: String,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub authors: Vec<OpdsAuthor>,
    pub categories: Vec<OpdsCategory>,
    pub language: Option<String>,
    pub issued: Option<String>,
    pub publisher: Option<String>,
    pub identifier: Option<String>,
    pub rights: Option<String>,
    pub published: Option<String>,
    pub links: Vec<OpdsLink>,
    pub acquisition_links: Vec<OpdsLink>,
    pub thumbnail_href: Option<String>,
    pub image_href: Option<String>,
    pub is_acquisition: bool,
    pub is_navigation: bool,
    pub subsection_href: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OpdsFeed {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub updated: String,
    pub kind: String,
    pub links: Vec<OpdsLink>,
    pub facets: Vec<OpdsFacet>,
    pub entries: Vec<OpdsEntry>,
    pub self_href: Option<String>,
    pub start_href: Option<String>,
    pub up_href: Option<String>,
    pub next_href: Option<String>,
    pub prev_href: Option<String>,
    pub search_href: Option<String>,
    pub total_results: Option<f64>,
    pub items_per_page: Option<f64>,
    pub start_index: Option<f64>,
}

pub fn parse_opds_atom_inner(xml: &str) -> Result<OpdsFeed, String> {
    let root = parse_xml_inner(xml)?;
    let feed_node = root
        .iter()
        .find(|n| normalize_tag(n.tag()) == "feed")
        .ok_or("No <feed> root element in OPDS document")?;
    Ok(parse_feed(feed_node))
}

fn parse_feed(node: &XmlNode) -> OpdsFeed {
    let id = text_of(first_child(Some(node), "id"));
    let title = text_of(first_child(Some(node), "title"));
    let subtitle = {
        let s = text_of(first_child(Some(node), "subtitle"));
        if s.is_empty() { None } else { Some(s) }
    };
    let updated = text_of(first_child(Some(node), "updated"));

    let links: Vec<OpdsLink> = find_children(node, "link")
        .iter()
        .filter_map(|n| parse_link(n))
        .collect();

    let facets: Vec<OpdsFacet> = links
        .iter()
        .filter(|l| l.rel == "http://opds-spec.org/facet")
        .map(|l| OpdsFacet {
            group: l.facet_group.clone().unwrap_or_default(),
            title: l.title.clone().unwrap_or_default(),
            href: l.href.clone(),
            active: l.active_facet,
            count: l.count,
        })
        .collect();

    let entries: Vec<OpdsEntry> = find_children(node, "entry")
        .iter()
        .map(|n| parse_entry(n))
        .collect();

    let kind = infer_feed_kind(&links, &entries);

    let self_href = find_rel(&links, "self");
    let start_href = find_rel(&links, "start");
    let up_href = find_rel(&links, "up");
    let next_href = find_rel(&links, "next");
    let prev_href = find_rel(&links, "previous").or_else(|| find_rel(&links, "prev"));
    let search_href = find_rel(&links, "search");
    let total_results = num_child(node, "totalResults");
    let items_per_page = num_child(node, "itemsPerPage");
    let start_index = num_child(node, "startIndex");

    OpdsFeed {
        id,
        title,
        subtitle,
        updated,
        kind,
        links,
        facets,
        entries,
        self_href,
        start_href,
        up_href,
        next_href,
        prev_href,
        search_href,
        total_results,
        items_per_page,
        start_index,
    }
}

fn parse_entry(node: &XmlNode) -> OpdsEntry {
    let id = text_of(first_child(Some(node), "id"));
    let title = text_of(first_child(Some(node), "title"));
    let updated = text_of(first_child(Some(node), "updated"));
    let summary = {
        let s = text_of(first_child(Some(node), "summary"));
        if s.is_empty() { None } else { Some(s) }
    };
    let content_node = first_child(Some(node), "content");
    let content = content_node.and_then(|c| {
        let attrs = attributes_of(c);
        let content_type = attrs.iter().find(|(k, _)| *k == "type").map(|(_, v)| v.to_string());
        let raw = full_text_of(Some(c));
        if let Some(ct) = content_type {
            let re = regex::Regex::new("(?i)html").unwrap();
            if re.is_match(&ct) {
                Some(strip_html_inner(&raw))
            } else {
                Some(raw)
            }
        } else {
            Some(raw)
        }
    });
    let rights = {
        let s = text_of(first_child(Some(node), "rights"));
        if s.is_empty() { None } else { Some(s) }
    };
    let published = {
        let s = text_of(first_child(Some(node), "published"));
        if s.is_empty() { None } else { Some(s) }
    };

    let authors: Vec<OpdsAuthor> = find_children(node, "author")
        .iter()
        .map(|an| OpdsAuthor {
            name: text_of(first_child(Some(an), "name")),
            uri: {
                let u = text_of(first_child(Some(an), "uri"));
                if u.is_empty() { None } else { Some(u) }
            },
        })
        .collect();

    let categories: Vec<OpdsCategory> = find_children(node, "category")
        .iter()
        .map(|cn| {
            let attrs = attributes_of(cn);
            let scheme = attrs.iter().find(|(k, _)| *k == "scheme").map(|(_, v)| v.to_string());
            let term = attrs.iter().find(|(k, _)| *k == "term").map(|(_, v)| v.to_string()).unwrap_or_default();
            let label = attrs.iter().find(|(k, _)| *k == "label").map(|(_, v)| v.to_string());
            OpdsCategory { scheme, term, label }
        })
        .collect();

    let language = {
        let s = text_of(first_child(Some(node), "language"));
        if s.is_empty() { None } else { Some(s) }
    };
    let issued = {
        let s = text_of(first_child(Some(node), "issued"));
        if s.is_empty() { None } else { Some(s) }
    };
    let publisher = {
        let s = text_of(first_child(Some(node), "publisher"));
        if s.is_empty() { None } else { Some(s) }
    };
    let identifier = {
        let s = text_of(first_child(Some(node), "identifier"));
        if s.is_empty() { None } else { Some(s) }
    };

    let links: Vec<OpdsLink> = find_children(node, "link")
        .iter()
        .filter_map(|n| parse_link(n))
        .collect();
    let acquisition_links: Vec<OpdsLink> = links
        .iter()
        .filter(|l| ACQUISITION_RELS.contains(&l.rel.as_str()))
        .cloned()
        .collect();

    let thumbnail_href = links
        .iter()
        .find(|l| l.rel == "http://opds-spec.org/image/thumbnail")
        .map(|l| l.href.clone());
    let image_href = links
        .iter()
        .find(|l| l.rel == "http://opds-spec.org/image")
        .map(|l| l.href.clone());
    let subsection_href = links
        .iter()
        .find(|l| l.rel == "subsection" || l.rel == "http://opds-spec.org/subsection")
        .map(|l| l.href.clone())
        .or_else(|| {
            links.iter().find(|l| {
                !ACQUISITION_RELS.contains(&l.rel.as_str())
                    && l.rel != "alternate"
                    && l.rel != "http://opds-spec.org/image"
                    && l.rel != "http://opds-spec.org/image/thumbnail"
                    && l.rel != "related"
                    && l.type_.as_deref().map(|t| t.contains("opds-catalog")).unwrap_or(false)
            }).map(|l| l.href.clone())
        });

    let is_acquisition = !acquisition_links.is_empty();
    let is_navigation = !is_acquisition && subsection_href.is_some();

    OpdsEntry {
        id,
        title,
        updated,
        summary,
        content,
        authors,
        categories,
        language,
        issued,
        publisher,
        identifier,
        rights,
        published,
        links,
        acquisition_links,
        thumbnail_href,
        image_href,
        is_acquisition,
        is_navigation,
        subsection_href,
    }
}

fn parse_link(node: &XmlNode) -> Option<OpdsLink> {
    let attrs = attributes_of(node);
    let get = |name: &str| attrs.iter().find(|(k, _)| *k == name).map(|(_, v)| (*v).to_owned());
    let rel = get("rel").unwrap_or_default();
    let href = get("href").unwrap_or_default();
    if href.is_empty() {
        return None;
    }
    let type_ = get("type");
    let title = get("title");
    let length = get("length").and_then(|s| s.parse::<f64>().ok());
    let facet_group = get("facetGroup");
    let active_facet = get("activeFacet").as_deref() == Some("true");
    let count = get("count").and_then(|s| s.parse::<f64>().ok());
    Some(OpdsLink {
        rel,
        href,
        type_,
        title,
        length,
        facet_group,
        active_facet,
        count,
    })
}

fn infer_feed_kind(links: &[OpdsLink], entries: &[OpdsEntry]) -> String {
    if let Some(self_link) = links.iter().find(|l| l.rel == "self") {
        if let Some(t) = &self_link.type_ {
            if t.contains("kind=acquisition") {
                return "acquisition".to_owned();
            }
            if t.contains("kind=navigation") {
                return "navigation".to_owned();
            }
        }
    }
    if !entries.is_empty() && entries.iter().any(|e| e.is_acquisition) {
        return "acquisition".to_owned();
    }
    if !entries.is_empty() && entries.iter().any(|e| e.is_navigation) {
        return "navigation".to_owned();
    }
    "unknown".to_owned()
}

fn find_rel(links: &[OpdsLink], rel: &str) -> Option<String> {
    links.iter().find(|l| l.rel == rel).map(|l| l.href.clone())
}

fn num_child(node: &XmlNode, tag: &str) -> Option<f64> {
    let child = first_child(Some(node), tag)?;
    let text = text_of(Some(child));
    if text.is_empty() {
        return None;
    }
    text.parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_FEED: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:uuid:test-feed</id>
  <title>Test Catalog</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <link rel="self" href="/feed.atom" type="application/atom+xml"/>
  <link rel="next" href="/page2.atom"/>
  <link rel="search" href="/opensearch.xml"/>
  <entry>
    <id>urn:uuid:book1</id>
    <title>Book One</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <author><name>Jane Roe</name></author>
    <link rel="http://opds-spec.org/acquisition" href="/book1.epub" type="application/epub+zip"/>
    <link rel="http://opds-spec.org/image" href="/cover1.jpg" type="image/jpeg"/>
  </entry>
  <entry>
    <id>urn:uuid:cat1</id>
    <title>Category One</title>
    <updated>2026-01-01T00:00:00Z</updated>
    <link rel="subsection" href="/cat1.atom" type="application/atom+xml"/>
  </entry>
</feed>"##;

    #[test]
    fn parses_feed_metadata() {
        let feed = parse_opds_atom_inner(SAMPLE_FEED).unwrap();
        assert_eq!(feed.id, "urn:uuid:test-feed");
        assert_eq!(feed.title, "Test Catalog");
        assert_eq!(feed.kind, "acquisition");
    }

    #[test]
    fn parses_feed_links() {
        let feed = parse_opds_atom_inner(SAMPLE_FEED).unwrap();
        assert_eq!(feed.self_href.as_deref(), Some("/feed.atom"));
        assert_eq!(feed.next_href.as_deref(), Some("/page2.atom"));
        assert_eq!(feed.search_href.as_deref(), Some("/opensearch.xml"));
    }

    #[test]
    fn parses_entries() {
        let feed = parse_opds_atom_inner(SAMPLE_FEED).unwrap();
        assert_eq!(feed.entries.len(), 2);
        let book = &feed.entries[0];
        assert_eq!(book.title, "Book One");
        assert!(book.is_acquisition);
        assert!(!book.is_navigation);
        assert_eq!(book.image_href.as_deref(), Some("/cover1.jpg"));
    }

    #[test]
    fn navigation_entry_detected() {
        let feed = parse_opds_atom_inner(SAMPLE_FEED).unwrap();
        let cat = &feed.entries[1];
        assert!(!cat.is_acquisition);
        assert!(cat.is_navigation);
        assert_eq!(cat.subsection_href.as_deref(), Some("/cat1.atom"));
    }

    #[test]
    fn parses_authors() {
        let feed = parse_opds_atom_inner(SAMPLE_FEED).unwrap();
        assert_eq!(feed.entries[0].authors.len(), 1);
        assert_eq!(feed.entries[0].authors[0].name, "Jane Roe");
    }

    #[test]
    fn rejects_no_feed() {
        let result = parse_opds_atom_inner("<html>not opds</html>");
        assert!(result.is_err());
    }

    #[test]
    fn empty_feed() {
        let xml = r##"<feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>Empty</title><updated>2026-01-01T00:00:00Z</updated></feed>"##;
        let feed = parse_opds_atom_inner(xml).unwrap();
        assert_eq!(feed.entries.len(), 0);
        assert_eq!(feed.kind, "unknown");
    }
}