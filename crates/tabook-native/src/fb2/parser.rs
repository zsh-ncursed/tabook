//! FB2 parser — Rust port of `src/formats/fb2/parser.ts` (475 LOC).
//!
//! Parses FB2 (and .fb2.zip) into the shared `ParsedBook` model. Mirrors the
//! TS implementation 1:1: metadata extraction, resource collection (base64),
//! body selection, container walking with heading emission, poems, tables,
//! epigraphs, lists. Metadata-only fast path for scans.

use crate::encoding::{decode_xml_buffer_inner, is_zip_buffer_inner};
use crate::inline::{normalize_inlines, parse_inlines};
use crate::model::{
    Author, Block, BookMetadata, Inline, ListItem, ParsedBook, ResourceEntry, Stanza, TocEntry,
};
use crate::text::normalize_whitespace_inner;
use crate::xml::{
    attr_of, children_of, find_children, first_child, full_text_of, normalize_tag, parse_xml_inner,
    text_of, XmlNode,
};
use crate::zip::ZipArchive;
use std::path::Path;

struct ParseState {
    blocks: Vec<Block>,
    toc: Vec<TocEntry>,
    block_index: i32,
}

fn find_root(children: &[XmlNode]) -> Result<(&XmlNode, Vec<XmlNode>), String> {
    for node in children {
        if normalize_tag(node.tag()) == "FictionBook" {
            return Ok((node, children_of(node).into_iter().cloned().collect()));
        }
    }
    Err("Not an FB2 document: missing <FictionBook> root element".into())
}

fn title_info<'a>(root: &'a XmlNode) -> Option<&'a XmlNode> {
    let description = first_child(Some(root), "description")?;
    first_child(Some(description), "title-info")
}

fn parse_author(node: &XmlNode) -> Vec<Author> {
    let mut result = Vec::new();
    for author in find_children(node, "author") {
        let nickname = text_of(first_child(Some(author), "nickname"));
        let first_name = text_of(first_child(Some(author), "first-name"));
        let last_name = text_of(first_child(Some(author), "last-name"));
        let middle_name = text_of(first_child(Some(author), "middle-name"));
        if !nickname.is_empty()
            || !first_name.is_empty()
            || !last_name.is_empty()
            || !middle_name.is_empty()
        {
            result.push(Author {
                first_name,
                last_name,
                middle_name: if middle_name.is_empty() {
                    None
                } else {
                    Some(middle_name)
                },
                nickname: if nickname.is_empty() {
                    None
                } else {
                    Some(nickname)
                },
            });
        }
    }
    result
}

fn parse_annotation(node: Option<&XmlNode>) -> String {
    let Some(node) = node else {
        return String::new();
    };
    let paragraphs = find_children(node, "p");
    if !paragraphs.is_empty() {
        let parts: Vec<String> = paragraphs
            .iter()
            .map(|p| normalize_whitespace_inner(&full_text_of(Some(p))))
            .filter(|s| !s.is_empty())
            .collect();
        return parts.join("\n\n");
    }
    normalize_whitespace_inner(&full_text_of(Some(node)))
}

fn collect_genres(title_info_node: &XmlNode) -> Vec<String> {
    find_children(title_info_node, "genre")
        .iter()
        .map(|g| normalize_whitespace_inner(&text_of(Some(g))))
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_metadata(root: &XmlNode, fallback_title: &str) -> BookMetadata {
    let info = title_info(root);
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
    let Some(info) = info else {
        metadata.title = fallback_title.to_owned();
        return metadata;
    };
    let book_title = text_of(first_child(Some(info), "book-title"));
    metadata.title = if normalize_whitespace_inner(&book_title).is_empty() {
        fallback_title.to_owned()
    } else {
        normalize_whitespace_inner(&book_title)
    };
    metadata.authors = parse_author(info);
    metadata.genres = collect_genres(info);
    metadata.annotation = parse_annotation(first_child(Some(info), "annotation"));
    let lang = text_of(first_child(Some(info), "lang"));
    if !lang.is_empty() {
        metadata.lang = Some(lang);
    }

    if let Some(sequence) = first_child(Some(info), "sequence") {
        let name = attr_of(Some(sequence), "name").unwrap_or_default();
        if !name.is_empty() {
            let number_raw = attr_of(Some(sequence), "number");
            let number = number_raw.and_then(|n| n.parse::<f64>().ok());
            metadata.series = Some(crate::model::SeriesInfo { name, number });
        }
    }

    let coverpage = first_child(Some(info), "coverpage");
    let cover = coverpage.and_then(|c| first_child(Some(c), "image"));
    if let Some(cover) = cover {
        let href = attr_of(Some(cover), "href").unwrap_or_default();
        if !href.is_empty() {
            metadata.cover_key = Some(href.trim_start_matches('#').to_owned());
        }
    }
    let description = first_child(Some(root), "description");
    let publish_info = description.and_then(|d| first_child(Some(d), "publish-info"));
    if let Some(publish_info) = publish_info {
        let publisher = text_of(first_child(Some(publish_info), "publisher"));
        if !publisher.is_empty() {
            metadata.publisher = Some(publisher);
        }
        let isbn = text_of(first_child(Some(publish_info), "isbn"));
        if !isbn.is_empty() {
            metadata.isbn = Some(isbn);
        }
        let year_text = text_of(first_child(Some(publish_info), "year"));
        if !year_text.is_empty() {
            if let Ok(year) = year_text.parse::<f64>() {
                metadata.year = Some(year);
            }
        }
    }
    metadata
}

fn collect_resources(root_children: &[XmlNode]) -> Vec<ResourceEntry> {
    let mut resources = Vec::new();
    for node in root_children {
        if normalize_tag(node.tag()) == "binary" {
            let id = attr_of(Some(node), "id").unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let raw = text_of(Some(node));
            let cleaned: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
            if let Ok(decoded) = base64_decode(&cleaned) {
                resources.push(ResourceEntry {
                    key: id,
                    data: decoded,
                });
            } else {
                resources.push(ResourceEntry {
                    key: id,
                    data: Vec::new(),
                });
            }
        }
    }
    resources
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let filtered: Vec<u8> = input
        .as_bytes()
        .iter()
        .filter(|b| !b.is_ascii_whitespace())
        .copied()
        .collect();
    let mut out = Vec::with_capacity(filtered.len() * 3 / 4);
    let mut buf = 0u32;
    let mut n_bits = 0u32;
    for &b in &filtered {
        if b == b'=' {
            break;
        }
        let v = TABLE
            .iter()
            .position(|&t| t == b)
            .ok_or_else(|| format!("invalid base64 char: {}", b as char))? as u32;
        buf = (buf << 6) | v;
        n_bits += 6;
        if n_bits >= 8 {
            n_bits -= 8;
            out.push(((buf >> n_bits) & 0xFF) as u8);
        }
    }
    Ok(out)
}

fn plain_heading_text(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline.kind.as_str() {
            "text" => out.push_str(inline.text.as_deref().unwrap_or("")),
            "bold" | "italic" | "underline" | "strike" | "link" => {
                if let Some(children) = &inline.children {
                    out.push_str(&plain_heading_text(children));
                }
            }
            "code" => out.push_str(inline.text.as_deref().unwrap_or("")),
            _ => {}
        }
    }
    normalize_whitespace_inner(&out)
}

fn parse_list(node: &XmlNode) -> Block {
    let mut items = Vec::new();
    for li in find_children(node, "li") {
        let kids = children_of(li);
        let mut item_inlines = Vec::new();
        let mut nested = Vec::new();
        for kid in kids {
            let tag = normalize_tag(kid.tag());
            if tag == "list" || tag == "section" {
                nested.push(parse_list(kid));
            } else {
                item_inlines.extend(parse_inlines(std::slice::from_ref(kid)));
            }
        }
        items.push(ListItem {
            children: normalize_inlines(item_inlines),
            nested,
        });
    }
    Block::list(false, items)
}

fn parse_poem(node: &XmlNode) -> Block {
    let mut stanzas: Vec<Stanza> = Vec::new();
    let mut current: Vec<Vec<Inline>> = Vec::new();
    let flush = |cur: &mut Vec<Vec<Inline>>, stanzas: &mut Vec<Stanza>| {
        if !cur.is_empty() {
            let moved = std::mem::take(cur);
            stanzas.push(Stanza { lines: moved });
        }
    };
    for kid in children_of(node) {
        let tag = normalize_tag(kid.tag());
        if tag == "stanza" {
            flush(&mut current, &mut stanzas);
            for v in find_children(kid, "v") {
                current.push(normalize_inlines(parse_inlines(std::slice::from_ref(v))));
            }
            for sub in find_children(kid, "subtitle") {
                current.push(normalize_inlines(parse_inlines(std::slice::from_ref(sub))));
            }
        } else if tag == "v" {
            current.push(normalize_inlines(parse_inlines(std::slice::from_ref(kid))));
        } else if tag == "subtitle" {
            current.push(normalize_inlines(parse_inlines(std::slice::from_ref(kid))));
        } else if tag == "title" {
            flush(&mut current, &mut stanzas);
            let p = first_child(Some(kid), "p").unwrap_or(kid);
            stanzas.push(Stanza {
                lines: vec![normalize_inlines(parse_inlines(std::slice::from_ref(p)))],
            });
        }
    }
    flush(&mut current, &mut stanzas);
    Block::poem(stanzas)
}

fn parse_table(node: &XmlNode) -> Block {
    let rows = find_children(node, "tr");
    let mut table_rows: Vec<Vec<Vec<Inline>>> = Vec::new();
    let mut headers: Vec<Vec<Inline>> = Vec::new();
    let mut is_first = true;
    for tr in rows {
        let tds = find_children(tr, "td");
        let ths = find_children(tr, "th");
        let cells: Vec<&XmlNode> = tds.iter().chain(ths.iter()).copied().collect();
        let cell_inlines: Vec<Vec<Inline>> = cells
            .iter()
            .map(|c| normalize_inlines(parse_inlines(std::slice::from_ref(c))))
            .collect();
        if is_first && !ths.is_empty() {
            headers = cell_inlines;
        } else {
            table_rows.push(cell_inlines);
        }
        is_first = false;
    }
    Block::table(headers, table_rows)
}

fn parse_epigraph(node: &XmlNode) -> Vec<Block> {
    let mut result = Vec::new();
    for kid in children_of(node) {
        let tag = normalize_tag(kid.tag());
        if tag == "p" {
            result.push(Block::epigraph(normalize_inlines(parse_inlines(
                std::slice::from_ref(kid),
            ))));
        } else if tag == "poem" {
            result.push(parse_poem(kid));
        } else if tag == "text-author" {
            result.push(Block::epigraph(vec![Inline::style(
                "italic",
                normalize_inlines(parse_inlines(std::slice::from_ref(kid))),
            )]));
        }
    }
    if result.is_empty() {
        result.push(Block::epigraph(normalize_inlines(parse_inlines(
            std::slice::from_ref(node),
        ))));
    }
    result
}

fn emit_heading(
    state: &mut ParseState,
    level: i32,
    inlines: Vec<Inline>,
    id: Option<String>,
    is_toc_entry: bool,
) {
    let normalized = normalize_inlines(inlines);
    state.blocks.push(Block::heading(level, normalized.clone()));
    if is_toc_entry && !normalized.is_empty() {
        let toc_id = id.unwrap_or_else(|| format!("h{}", state.toc.len() + 1));
        state.toc.push(TocEntry {
            id: toc_id,
            label: plain_heading_text(&normalized),
            level,
            block_index: state.block_index,
        });
    }
    state.block_index += 1;
}

fn emit_block(state: &mut ParseState, block: Block) {
    let blocks = match block {
        Block { r#type: _, .. } => vec![block],
    };
    for b in blocks {
        state.blocks.push(b);
        state.block_index += 1;
    }
}

fn parse_container(state: &mut ParseState, nodes: &[XmlNode], depth: i32) {
    for node in nodes {
        let tag = normalize_tag(node.tag()).to_owned();
        match tag.as_str() {
            "section" => {
                let kids = children_of(node);
                for kid in kids {
                    let kid_tag = normalize_tag(kid.tag()).to_owned();
                    if kid_tag == "title" {
                        let p = first_child(Some(kid), "p").unwrap_or(kid);
                        let level = depth.min(6);
                        emit_heading(
                            state,
                            level,
                            parse_inlines(std::slice::from_ref(p)),
                            attr_of(Some(kid), "id"),
                            true,
                        );
                    } else {
                        parse_container(state, std::slice::from_ref(kid), depth + 1);
                    }
                }
            }
            "title" => {
                let p = first_child(Some(node), "p").unwrap_or(node);
                emit_heading(
                    state,
                    depth.min(6),
                    parse_inlines(std::slice::from_ref(p)),
                    attr_of(Some(node), "id"),
                    true,
                );
            }
            "subtitle" => {
                emit_heading(
                    state,
                    3,
                    parse_inlines(std::slice::from_ref(node)),
                    attr_of(Some(node), "id"),
                    false,
                );
            }
            "p" => {
                let inlines = normalize_inlines(parse_inlines(std::slice::from_ref(node)));
                if inlines.is_empty() {
                    emit_block(state, Block::empty());
                } else {
                    emit_block(state, Block::paragraph(inlines));
                }
            }
            "empty-line" => emit_block(state, Block::empty()),
            "cite" => emit_block(
                state,
                Block::quote(normalize_inlines(parse_inlines(std::slice::from_ref(node)))),
            ),
            "poem" => emit_block(state, parse_poem(node)),
            "table" => emit_block(state, parse_table(node)),
            "image" => {
                let src = attr_of(Some(node), "href")
                    .unwrap_or_default()
                    .trim_start_matches('#')
                    .to_owned();
                emit_block(
                    state,
                    Block::image(src, attr_of(Some(node), "alt").unwrap_or_default()),
                );
            }
            "list" => emit_block(state, parse_list(node)),
            "epigraph" => {
                for b in parse_epigraph(node) {
                    emit_block(state, b);
                }
            }
            "annotation" => emit_block(
                state,
                Block::annotation(normalize_inlines(parse_inlines(std::slice::from_ref(node)))),
            ),
            "text-author" => emit_block(
                state,
                Block::paragraph(vec![Inline::style(
                    "italic",
                    normalize_inlines(parse_inlines(std::slice::from_ref(node))),
                )]),
            ),
            "code" => emit_block(
                state,
                Block::paragraph(normalize_inlines(parse_inlines(std::slice::from_ref(node)))),
            ),
            _ => {
                let kids: Vec<XmlNode> = children_of(node).into_iter().cloned().collect();
                if !kids.is_empty() {
                    parse_container(state, &kids, depth);
                }
            }
        }
    }
}

fn select_main_body<'a>(root_children: &'a [XmlNode]) -> Vec<&'a XmlNode> {
    let bodies: Vec<&XmlNode> = root_children
        .iter()
        .filter(|n| normalize_tag(n.tag()) == "body")
        .collect();
    if bodies.is_empty() {
        return Vec::new();
    }
    for body in &bodies {
        if attr_of(Some(body), "name").is_none() {
            return children_of(body);
        }
    }
    children_of(bodies[0])
}

pub struct ParsedBookResult {
    pub metadata: BookMetadata,
    pub resources: Vec<ResourceEntry>,
    pub blocks: Vec<Block>,
    pub toc: Vec<TocEntry>,
}

pub fn parse_fb2_text(
    xml_text: &str,
    _path: &str,
    filename: &str,
) -> Result<ParsedBookResult, String> {
    let children = parse_xml_inner(xml_text)?;
    let (root, root_children) = find_root(&children)?;
    let fallback_title = filename
        .rsplit('.')
        .nth(1)
        .map(|_| {
            let dot = filename.rfind('.').unwrap_or(filename.len());
            &filename[..dot]
        })
        .unwrap_or(filename);
    let metadata = parse_metadata(root, fallback_title);
    let resources = collect_resources(&root_children);
    let mut state = ParseState {
        blocks: Vec::new(),
        toc: Vec::new(),
        block_index: 0,
    };
    let body: Vec<&XmlNode> = select_main_body(&root_children);
    let body_owned: Vec<XmlNode> = body.into_iter().cloned().collect();
    parse_container(&mut state, &body_owned, 2);
    Ok(ParsedBookResult {
        metadata,
        resources,
        blocks: state.blocks,
        toc: state.toc,
    })
}

fn build_book_from_result(result: ParsedBookResult, file_path: &str, size: i64) -> ParsedBook {
    let filename = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    ParsedBook {
        format: "fb2".to_owned(),
        path: file_path.to_owned(),
        filename,
        size: size as f64,
        metadata: result.metadata,
        toc: result.toc,
        content: result.blocks,
        resources: result.resources,
    }
}

pub fn parse_fb2_buffer_inner(data: &[u8], file_path: &str) -> Result<ParsedBook, String> {
    if is_zip_buffer_inner(data) {
        return parse_fb2_zip(data, file_path);
    }
    let xml_text = decode_xml_buffer_inner(data);
    let filename = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let result = parse_fb2_text(&xml_text, file_path, &filename)?;
    Ok(build_book_from_result(result, file_path, data.len() as i64))
}

fn parse_fb2_zip(data: &[u8], file_path: &str) -> Result<ParsedBook, String> {
    let zip = ZipArchive::open(data.to_vec())?;
    let entries: Vec<_> = zip
        .entries
        .iter()
        .filter(|e| e.name.ends_with(".fb2") && !e.name.starts_with("__MACOSX"))
        .collect();
    if entries.is_empty() {
        return Err("ZIP archive does not contain an .fb2 file".into());
    }
    let mut sorted = entries;
    sorted.sort_by(|a, b| a.name.cmp(&b.name));
    let entry = &sorted[0];
    let inner = zip.read(&entry.name)?;
    let xml_text = decode_xml_buffer_inner(&inner);
    let filename = entry
        .name
        .rsplit('/')
        .next()
        .unwrap_or(&entry.name)
        .to_owned();
    let result = parse_fb2_text(&xml_text, file_path, &filename)?;
    Ok(build_book_from_result(result, file_path, data.len() as i64))
}

pub fn parse_fb2_metadata_inner(data: &[u8], file_path: &str) -> Result<BookMetadata, String> {
    if is_zip_buffer_inner(data) {
        let zip = ZipArchive::open(data.to_vec())?;
        let entries: Vec<_> = zip
            .entries
            .iter()
            .filter(|e| e.name.ends_with(".fb2") && !e.name.starts_with("__MACOSX"))
            .collect();
        if entries.is_empty() {
            return Err("ZIP archive does not contain an .fb2 file".into());
        }
        let mut sorted = entries;
        sorted.sort_by(|a, b| a.name.cmp(&b.name));
        let entry = &sorted[0];
        let inner = zip.read(&entry.name)?;
        let children = parse_xml_inner(&decode_xml_buffer_inner(&inner))?;
        let (root, _) = find_root(&children)?;
        // Fallback title = entry *basename* without the extension, mirroring
        // the TS parser ((name.split('/').pop() ?? name).replace(/\.[^.]+$/, ''))
        // — the previous port stripped the extension off the full archive path,
        // so a zip with the fb2 in a subdirectory got "subdir/book" as the
        // title fallback (parity: src/parity/fb2.parity.test.ts).
        let base = entry.name.rsplit('/').next().unwrap_or(&entry.name);
        let fallback = match base.rfind('.') {
            Some(dot) => base[..dot].to_owned(),
            None => base.to_owned(),
        };
        return Ok(parse_metadata(root, &fallback));
    }
    let children = parse_xml_inner(&decode_xml_buffer_inner(data))?;
    let (root, _) = find_root(&children)?;
    let fallback = Path::new(file_path)
        .file_name()
        .map(|n| {
            let s = n.to_string_lossy();
            let dot = s.rfind('.').unwrap_or(s.len());
            s[..dot].to_owned()
        })
        .unwrap_or_default();
    Ok(parse_metadata(root, &fallback))
}
