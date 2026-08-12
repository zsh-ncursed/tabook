//! EPUB parser — Rust port of `src/formats/epub/parser.ts` (363 LOC).
//!
//! Parses EPUB 2/3 ZIP archives into `ParsedBook`. Reads container.xml → OPF,
//! extracts metadata, spine content (XHTML → blocks), TOC (NCX or nav), images.
//! Metadata-only fast path for scans. Bugfix: findContainingBlock assigns id
//! to the first content block, not the last.

use crate::encoding::decode_xml_buffer_inner;
use crate::epub::xhtml::parse_xhtml_blocks;
use crate::href::resolve_href;
use crate::model::{Author, Block, BookMetadata, Inline, ParsedBook, ResourceEntry, TocEntry};
use crate::text::normalize_whitespace_inner;
use crate::xml::{
    attr_of, children_of, find_children, first_child, normalize_tag, parse_xml_inner, text_of,
    XmlNode,
};
use crate::zip::ZipArchive;
use std::collections::HashMap;
use std::path::Path;

struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
}

struct OpfData {
    metadata: BookMetadata,
    manifest: HashMap<String, ManifestItem>,
    spine: Vec<String>,
    ncx_id: Option<String>,
    cover_id: Option<String>,
    cover_href_from_properties: Option<String>,
}

fn read_text_file(zip: &ZipArchive, entry_name: &str) -> Result<String, String> {
    let bytes = zip.read(entry_name)?;
    Ok(decode_xml_buffer_inner(&bytes))
}

fn find_node<'a>(children: &'a [XmlNode], tag: &str) -> Option<&'a XmlNode> {
    children
        .iter()
        .find(|n| normalize_tag(n.tag()) == tag)
}

fn parse_container(zip: &ZipArchive) -> Result<String, String> {
    let container_text = read_text_file(zip, "META-INF/container.xml")
        .map_err(|_| "Not a valid EPUB: missing META-INF/container.xml".to_owned())?;
    let children = parse_xml_inner(&container_text)?;
    let container_node = find_node(&children, "container")
        .ok_or("Invalid EPUB container.xml: missing <container>")?;
    let rootfiles_node = first_child(Some(container_node), "rootfiles");
    if let Some(rootfiles) = rootfiles_node {
        for rf in find_children(rootfiles, "rootfile") {
            let full_path = attr_of(Some(rf), "full-path");
            if let Some(fp) = full_path {
                return Ok(fp);
            }
        }
    }
    Err("Invalid EPUB container.xml: no rootfile found".into())
}

fn posix_dirname(p: &str) -> String {
    match p.rfind('/') {
        Some(idx) => p[..idx].to_owned(),
        None => String::new(),
    }
}

fn parse_opf(zip: &ZipArchive, opf_path: &str) -> Result<OpfData, String> {
    let text = read_text_file(zip, opf_path)?;
    let children = parse_xml_inner(&text)?;
    let package_node = find_node(&children, "package")
        .ok_or("Invalid EPUB OPF: missing <package>")?;
    let opf_dir = posix_dirname(opf_path);

    let metadata_node = first_child(Some(package_node), "metadata");
    let mut metadata = BookMetadata {
        title: String::new(),
        authors: Vec::new(),
        series: None,
        genres: Vec::new(),
        annotation: String::new(),
        lang: None,
        cover_key: None,
        publisher: None,
        isbn: None,
        year: None,
    };
    if let Some(md_node) = metadata_node {
        metadata.title = normalize_whitespace_inner(&text_of(first_child(Some(md_node), "title")));
        metadata.authors = find_children(md_node, "creator")
            .iter()
            .map(|c| {
                let name = normalize_whitespace_inner(&text_of(Some(c)));
                if name.is_empty() {
                    Author {
                        first_name: String::new(),
                        last_name: String::new(),
                        middle_name: None,
                        nickname: None,
                    }
                } else {
                    let parts: Vec<&str> = name.split_whitespace().collect();
                    if parts.len() >= 2 {
                        Author {
                            first_name: parts[0].to_owned(),
                            last_name: parts[1..].join(" "),
                            middle_name: None,
                            nickname: Some(name),
                        }
                    } else {
                        Author {
                            first_name: String::new(),
                            last_name: name.clone(),
                            middle_name: None,
                            nickname: Some(name),
                        }
                    }
                }
            })
            .collect();
        metadata.genres = find_children(md_node, "subject")
            .iter()
            .map(|s| normalize_whitespace_inner(&text_of(Some(s))))
            .filter(|s| !s.is_empty())
            .collect();
        let lang = normalize_whitespace_inner(&text_of(first_child(Some(md_node), "language")));
        if !lang.is_empty() {
            metadata.lang = Some(lang);
        }
        metadata.annotation = find_children(md_node, "description")
            .iter()
            .map(|d| normalize_whitespace_inner(&text_of(Some(d))))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        let publisher = normalize_whitespace_inner(&text_of(first_child(Some(md_node), "publisher")));
        if !publisher.is_empty() {
            metadata.publisher = Some(publisher);
        }
        let isbn = normalize_whitespace_inner(&text_of(first_child(Some(md_node), "identifier")));
        if !isbn.is_empty() {
            metadata.isbn = Some(isbn);
        }
        let date = normalize_whitespace_inner(&text_of(first_child(Some(md_node), "date")));
        if let Some(year) = date.get(0..4).and_then(|y| y.parse::<f64>().ok()) {
            metadata.year = Some(year);
        }
    }

    let mut manifest = HashMap::new();
    if let Some(manifest_node) = first_child(Some(package_node), "manifest") {
        for item in find_children(manifest_node, "item") {
            let id = attr_of(Some(item), "id").unwrap_or_default();
            let href = attr_of(Some(item), "href").unwrap_or_default();
            if id.is_empty() || href.is_empty() {
                continue;
            }
            manifest.insert(
                id.clone(),
                ManifestItem {
                    id,
                    href: resolve_href(&opf_dir, &href),
                    media_type: attr_of(Some(item), "media-type").unwrap_or_default(),
                },
            );
        }
    }

    let mut spine = Vec::new();
    let mut ncx_id = None;
    if let Some(spine_node) = first_child(Some(package_node), "spine") {
        ncx_id = attr_of(Some(spine_node), "toc");
        for itemref in find_children(spine_node, "itemref") {
            if let Some(idref) = attr_of(Some(itemref), "idref") {
                spine.push(idref);
            }
        }
    }

    let mut cover_id = None;
    let mut cover_href_from_properties = None;
    if let Some(md_node) = metadata_node {
        for meta in find_children(md_node, "meta") {
            if attr_of(Some(meta), "name").as_deref() == Some("cover") {
                cover_id = attr_of(Some(meta), "content");
            }
        }
    }
    if let Some(manifest_node) = first_child(Some(package_node), "manifest") {
        for item in find_children(manifest_node, "item") {
            let props = attr_of(Some(item), "properties").unwrap_or_default();
            if props.split_whitespace().any(|p| p == "cover-image") {
                if let Some(id) = attr_of(Some(item), "id") {
                    cover_href_from_properties = attr_of(Some(item), "href");
                    if cover_id.is_none() {
                        cover_id = Some(id);
                    }
                }
            }
        }
    }

    Ok(OpfData {
        metadata,
        manifest,
        spine,
        ncx_id,
        cover_id,
        cover_href_from_properties,
    })
}

struct TocLink {
    label: String,
    href: String,
    fragment: Option<String>,
    level: i32,
    children: Vec<TocLink>,
}

fn parse_nav_point(node: &XmlNode, opf_dir: &str, level: i32) -> TocLink {
    let nav_label = first_child(Some(node), "navLabel");
    let label = normalize_whitespace_inner(&text_of(nav_label.and_then(|nl| first_child(Some(nl), "text"))));
    let content = first_child(Some(node), "content");
    let src = attr_of(content, "src").unwrap_or_default();
    let (file, fragment) = match src.find('#') {
        Some(idx) => (src[..idx].to_owned(), Some(src[idx + 1..].to_owned())),
        None => (src.clone(), None),
    };
    let fragment = fragment.filter(|f| !f.is_empty());
    TocLink {
        label,
        href: resolve_href(opf_dir, &file),
        fragment,
        level,
        children: find_children(node, "navPoint")
            .iter()
            .map(|np| parse_nav_point(np, opf_dir, level + 1))
            .collect(),
    }
}

fn parse_ncx(zip: &ZipArchive, ncx_href: &str, opf_dir: &str) -> Result<Vec<TocLink>, String> {
    let text = read_text_file(zip, ncx_href)?;
    let children = parse_xml_inner(&text)?;
    let ncx_node = find_node(&children, "ncx");
    let Some(ncx_node) = ncx_node else { return Ok(Vec::new()) };
    let nav_map = first_child(Some(ncx_node), "navMap");
    let Some(nav_map) = nav_map else { return Ok(Vec::new()) };
    Ok(find_children(nav_map, "navPoint")
        .iter()
        .map(|np| parse_nav_point(np, opf_dir, 1))
        .collect())
}

fn parse_nav_li(node: &XmlNode, opf_dir: &str, level: i32) -> TocLink {
    let mut label = String::new();
    let mut href = String::new();
    let mut fragment = None;
    for kid in children_of(node) {
        let tag = normalize_tag(kid.tag());
        if tag == "a" || tag == "span" {
            if let Some(target) = attr_of(Some(kid), "href") {
                let (file, frag) = match target.find('#') {
                    Some(idx) => (target[..idx].to_owned(), Some(target[idx + 1..].to_owned())),
                    None => (target.clone(), None),
                };
                href = resolve_href(opf_dir, &file);
                fragment = frag.filter(|f| !f.is_empty());
            }
            if label.is_empty() {
                label = normalize_whitespace_inner(&text_of(Some(kid)));
            }
        }
    }
    let mut children = Vec::new();
    for ol in find_children(node, "ol") {
        for li in find_children(ol, "li") {
            children.push(parse_nav_li(li, opf_dir, level + 1));
        }
    }
    TocLink {
        label,
        href,
        fragment,
        level,
        children,
    }
}

fn parse_nav_doc(zip: &ZipArchive, nav_href: &str, opf_dir: &str) -> Result<Vec<TocLink>, String> {
    let text = read_text_file(zip, nav_href)?;
    let children = parse_xml_inner(&text)?;
    let html = find_node(&children, "html");
    let body = html.and_then(|h| first_child(Some(h), "body"));
    let Some(body) = body else { return Ok(Vec::new()) };
    let mut nav_node = None;
    for nav in find_children(body, "nav") {
        if attr_of(Some(nav), "type").as_deref() == Some("toc") {
            nav_node = Some(nav);
            break;
        }
    }
    if nav_node.is_none() {
        nav_node = find_children(body, "nav").into_iter().next();
    }
    let Some(nav_node) = nav_node else { return Ok(Vec::new()) };
    let ol = first_child(Some(nav_node), "ol");
    let Some(ol) = ol else { return Ok(Vec::new()) };
    Ok(find_children(ol, "li")
        .iter()
        .map(|li| parse_nav_li(li, opf_dir, 1))
        .collect())
}

fn read_epub_opf(zip: &ZipArchive) -> Result<(OpfData, String), String> {
    let opf_path = parse_container(zip)?;
    let opf_dir = posix_dirname(&opf_path);
    let opf = parse_opf(zip, &opf_path)?;
    Ok((opf, opf_dir))
}

fn flatten_toc(
    links: &[TocLink],
    id_to_block: &HashMap<String, i32>,
    file_to_block: &HashMap<String, i32>,
    out: &mut Vec<TocEntry>,
) {
    for link in links {
        if link.label.is_empty() {
            continue;
        }
        let with_frag = match &link.fragment {
            Some(f) => format!("{}#{}", link.href, f),
            None => link.href.clone(),
        };
        let block_index = id_to_block.get(&with_frag)
            .or_else(|| file_to_block.get(&link.href))
            .copied()
            .unwrap_or(0);
        out.push(TocEntry {
            id: format!("epub-{}", out.len() + 1),
            label: link.label.clone(),
            level: link.level,
            block_index,
        });
        flatten_toc(&link.children, id_to_block, file_to_block, out);
    }
}

pub fn parse_epub_buffer_inner(data: &[u8], file_path: &str) -> Result<ParsedBook, String> {
    if !crate::encoding::is_zip_buffer_inner(data) {
        return Err("EPUB file is not a ZIP archive".into());
    }
    let zip = ZipArchive::open(data.to_vec())?;
    let (opf, opf_dir) = read_epub_opf(&zip)?;

    let mut toc_links = Vec::new();
    if let Some(ncx_id) = &opf.ncx_id {
        if let Some(ncx_item) = opf.manifest.get(ncx_id) {
            if let Ok(links) = parse_ncx(&zip, &ncx_item.href, &opf_dir) {
                toc_links.extend(links);
            }
        }
    }
    if toc_links.is_empty() {
        for item in opf.manifest.values() {
            if item.media_type == "application/xhtml+xml" {
                let re = regex::Regex::new(r"(?i)nav\.x?html$").unwrap();
                if re.is_match(&item.href) {
                    if let Ok(links) = parse_nav_doc(&zip, &item.href, &opf_dir) {
                        toc_links.extend(links);
                    }
                    break;
                }
            }
        }
    }

    let mut content_blocks: Vec<Block> = Vec::new();
    let mut id_to_block: HashMap<String, i32> = HashMap::new();
    let mut file_to_block: HashMap<String, i32> = HashMap::new();
    let mut block_index = 0i32;

    for idref in &opf.spine {
        let Some(item) = opf.manifest.get(idref) else { continue };
        let xhtml_re = regex::Regex::new(r"(?i)\.x?html?$").unwrap();
        if !xhtml_re.is_match(&item.href) && !item.media_type.contains("html") && !item.media_type.contains("xml") {
            continue;
        }
        let doc_text = read_text_file(&zip, &item.href)
            .map_err(|e| format!("Cannot read EPUB content file {}: {}", item.href, e))?;
        let parsed = parse_xml_inner(&doc_text)?;
        let html = find_node(&parsed, "html");
        let body = html.and_then(|h| first_child(Some(h), "body"));
        let body_children: Vec<XmlNode> = match body {
            Some(b) => children_of(b).into_iter().cloned().collect(),
            None => parsed,
        };
        let base_dir = posix_dirname(&item.href);
        let (blocks, ids) = parse_xhtml_blocks(&body_children, &base_dir);
        file_to_block.insert(item.href.clone(), block_index);
        for (frag_id, idx) in ids {
            id_to_block.insert(format!("{}#{}", item.href, frag_id), idx + block_index);
        }
        content_blocks.extend(blocks);
        block_index += content_blocks.len() as i32 - block_index;
    }

    let mut toc = Vec::new();
    flatten_toc(&toc_links, &id_to_block, &file_to_block, &mut toc);

    let mut resources = Vec::new();
    for item in opf.manifest.values() {
        if item.media_type.starts_with("image/") {
            if let Ok(data) = zip.read(&item.href) {
                resources.push(ResourceEntry {
                    key: item.href.clone(),
                    data,
                });
            }
        }
    }

    let cover_href = opf
        .cover_id
        .as_ref()
        .and_then(|id| opf.manifest.get(id).map(|m| m.href.clone()))
        .or(opf.cover_href_from_properties.clone());
    let mut metadata = opf.metadata;
    if let Some(ch) = cover_href {
        metadata.cover_key = Some(ch);
    }

    let filename = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if metadata.title.is_empty() {
        let dot = filename.rfind('.').unwrap_or(filename.len());
        metadata.title = filename[..dot].to_owned();
    }

    Ok(ParsedBook {
        format: "epub".to_owned(),
        path: file_path.to_owned(),
        filename,
        size: data.len() as f64,
        metadata,
        toc,
        content: content_blocks,
        resources,
    })
}

pub fn parse_epub_metadata_inner(data: &[u8], file_path: &str) -> Result<BookMetadata, String> {
    if !crate::encoding::is_zip_buffer_inner(data) {
        return Err("EPUB file is not a ZIP archive".into());
    }
    let zip = ZipArchive::open(data.to_vec())?;
    let (opf, _) = read_epub_opf(&zip)?;
    let cover_href = opf
        .cover_id
        .as_ref()
        .and_then(|id| opf.manifest.get(id).map(|m| m.href.clone()))
        .or(opf.cover_href_from_properties.clone());
    let mut metadata = opf.metadata;
    if let Some(ch) = cover_href {
        metadata.cover_key = Some(ch);
    }
    if metadata.title.is_empty() {
        let filename = Path::new(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let dot = filename.rfind('.').unwrap_or(filename.len());
        metadata.title = filename[..dot].to_owned();
    }
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_epub() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();

            zip.start_file("META-INF/container.xml", opts).unwrap();
            zip.write_all(b"<?xml version=\"1.0\"?><container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>").unwrap();

            zip.start_file("OEBPS/content.opf", opts).unwrap();
            zip.write_all(b"<?xml version=\"1.0\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"uid\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>Epub Book</dc:title><dc:creator>Jane Roe</dc:creator><dc:language>en</dc:language><dc:description>A description.</dc:description><dc:subject>Fiction</dc:subject><dc:identifier id=\"uid\">urn:isbn:9781234567890</dc:identifier><meta name=\"cover\" content=\"cover-image\"/></metadata><manifest><item id=\"cover-image\" href=\"images/cover.jpg\" media-type=\"image/jpeg\"/><item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"chap1\" href=\"chap1.xhtml\" media-type=\"application/xhtml+xml\"/></manifest><spine><itemref idref=\"chap1\"/></spine></package>").unwrap();

            zip.start_file("OEBPS/nav.xhtml", opts).unwrap();
            zip.write_all(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><body><nav epub:type=\"toc\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><ol><li><a href=\"chap1.xhtml#start\">Chapter One</a></li></ol></nav></body></html>").unwrap();

            zip.start_file("OEBPS/chap1.xhtml", opts).unwrap();
            zip.write_all(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>chap1.xhtml</title></head><body><h1 id=\"start\">Chapter One</h1><p>First paragraph.</p><p>Second with <strong>bold</strong>.</p><ul><li>Bullet one</li></ul><img src=\"images/cover.jpg\" alt=\"cover\"/></body></html>").unwrap();

            zip.start_file("OEBPS/images/cover.jpg", opts).unwrap();
            zip.write_all(&[0xff, 0xd8, 0xff, 0xe0]).unwrap();

            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn parses_epub_metadata() {
        let data = build_epub();
        let metadata = parse_epub_metadata_inner(&data, "/test.epub").unwrap();
        assert_eq!(metadata.title, "Epub Book");
        assert_eq!(metadata.authors.len(), 1);
        assert_eq!(metadata.authors[0].nickname.as_deref(), Some("Jane Roe"));
        assert_eq!(metadata.genres, vec!["Fiction"]);
        assert_eq!(metadata.lang.as_deref(), Some("en"));
        assert_eq!(metadata.isbn.as_deref(), Some("urn:isbn:9781234567890"));
        assert_eq!(metadata.cover_key.as_deref(), Some("OEBPS/images/cover.jpg"));
    }

    #[test]
    fn parses_epub_content() {
        let data = build_epub();
        let book = parse_epub_buffer_inner(&data, "/test.epub").unwrap();
        assert_eq!(book.format, "epub");
        assert_eq!(book.metadata.title, "Epub Book");
        assert!(!book.content.is_empty());
        let has_heading = book.content.iter().any(|b| b.r#type == "heading");
        assert!(has_heading);
        let has_image = book.content.iter().any(|b| b.r#type == "image");
        assert!(has_image);
    }

    #[test]
    fn parses_epub_toc() {
        let data = build_epub();
        let book = parse_epub_buffer_inner(&data, "/test.epub").unwrap();
        assert!(!book.toc.is_empty());
        assert_eq!(book.toc[0].label, "Chapter One");
    }

    #[test]
    fn parses_epub_resources() {
        let data = build_epub();
        let book = parse_epub_buffer_inner(&data, "/test.epub").unwrap();
        assert!(!book.resources.is_empty());
        let cover = book.resources.iter().find(|r| r.key == "OEBPS/images/cover.jpg");
        assert!(cover.is_some());
    }

    #[test]
    fn rejects_non_zip() {
        let result = parse_epub_buffer_inner(b"not a zip", "/test.epub");
        assert!(result.is_err());
    }
}