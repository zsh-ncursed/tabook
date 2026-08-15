#![deny(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    dead_code
)]

mod db;
mod encoding;
mod epub;
mod fb2;
mod formats_index;
mod href;
mod image;
mod inline;
mod model;
mod opds_parser;
mod renderer;
mod scan;
mod search;
mod text;
mod xml;
mod zip;

// Test symbol to verify cdylib exports work.
#[no_mangle]
pub extern "C" fn tabook_test_symbol() -> i32 {
    42
}

// ----- napi exports -----
// napi-rs scans top-level `#[napi]` items. To keep `cargo test` linkable
// (without the napi runtime), all napi items live behind `cfg(feature = "napi-runtime")`.

#[cfg(feature = "napi-runtime")]
use napi::bindgen_prelude::{Buffer, Error as NapiError, Result as NapiResult};
#[cfg(feature = "napi-runtime")]
use napi_derive::napi;

#[cfg(feature = "napi-runtime")]
use crate::model::{Author, Block, BookMetadata, ParsedBook, SeriesInfo};

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn hello() -> String {
    format!("tabook-native {}", env!("CARGO_PKG_VERSION"))
}

// text.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn display_width(input: String) -> i32 {
    crate::text::display_width_inner(&input)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn decode_entities(input: String) -> String {
    crate::text::decode_entities_standalone(&input)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn normalize_whitespace(input: String) -> String {
    crate::text::normalize_whitespace_inner(&input)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn strip_html(html: String) -> String {
    crate::text::strip_html_inner(&html)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn truncate(input: String, max_length: i32, suffix: Option<String>) -> String {
    crate::text::truncate_inner(&input, max_length.max(0) as usize, suffix.as_deref())
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn truncate_w(text: String, max: i32) -> String {
    crate::text::truncate_w_inner(&text, max)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn split_chars(input: String) -> Vec<String> {
    crate::text::split_chars_inner(&input)
}

// encoding.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn detect_encoding(data: Buffer) -> String {
    crate::encoding::detect_encoding_inner(&data)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn normalize_encoding(enc: String) -> String {
    crate::encoding::normalize_encoding_inner(&enc)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn decode_xml_buffer(data: Buffer) -> String {
    crate::encoding::decode_xml_buffer_inner(&data)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn file_extension(name: String) -> String {
    crate::encoding::file_extension_inner(&name)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn is_zip_buffer(data: Buffer) -> bool {
    crate::encoding::is_zip_buffer_inner(&data)
}

// zip.rs
#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct ZipEntryInfo {
    pub name: String,
    pub size: u32,
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub struct ZipArchiveHandle {
    pub entries: Vec<ZipEntryInfo>,
    bytes: Vec<u8>,
}

#[cfg(feature = "napi-runtime")]
#[napi]
impl ZipArchiveHandle {
    #[napi]
    pub fn read(&self, name: String) -> NapiResult<Buffer> {
        let archive = crate::zip::ZipArchive {
            entries: Vec::new(),
            bytes: self.bytes.clone(),
        };
        archive
            .read(&name)
            .map(Buffer::from)
            .map_err(NapiError::from_reason)
    }
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn open_zip(data: Buffer) -> NapiResult<ZipArchiveHandle> {
    let bytes = data.to_vec();
    let archive = crate::zip::ZipArchive::open(bytes).map_err(NapiError::from_reason)?;
    let entries = archive
        .entries
        .into_iter()
        .map(|e| ZipEntryInfo {
            name: e.name,
            size: e.size,
        })
        .collect();
    Ok(ZipArchiveHandle {
        entries,
        bytes: archive.bytes,
    })
}

// xml.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_xml(text: String) -> NapiResult<()> {
    let _ = crate::xml::parse_xml_inner(&text).map_err(NapiError::from_reason)?;
    Ok(())
}

// formats_index.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn detect_format(data: Buffer, name: String) -> NapiResult<String> {
    crate::formats_index::detect_format_inner(&data, &name).map_err(NapiError::from_reason)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_book_file(file_path: String) -> NapiResult<ParsedBook> {
    crate::formats_index::parse_book_file_inner(&file_path).map_err(NapiError::from_reason)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn invalidate_book_cache() {
    crate::formats_index::invalidate_book_cache_inner()
}

// fb2/parser.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_fb2_buffer(data: Buffer, file_path: String) -> NapiResult<ParsedBook> {
    crate::fb2::parser::parse_fb2_buffer_inner(&data, &file_path).map_err(NapiError::from_reason)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_fb2_metadata(data: Buffer, file_path: String) -> NapiResult<BookMetadata> {
    crate::fb2::parser::parse_fb2_metadata_inner(&data, &file_path).map_err(NapiError::from_reason)
}

// epub/parser.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_epub_buffer(data: Buffer, file_path: String) -> NapiResult<ParsedBook> {
    crate::epub::parser::parse_epub_buffer_inner(&data, &file_path).map_err(NapiError::from_reason)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_epub_metadata(data: Buffer, file_path: String) -> NapiResult<BookMetadata> {
    crate::epub::parser::parse_epub_metadata_inner(&data, &file_path)
        .map_err(NapiError::from_reason)
}

// image.rs
#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct ImageToPng {
    pub data: Buffer,
    pub width: u32,
    pub height: u32,
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn image_to_png(data: Buffer) -> NapiResult<ImageToPng> {
    let out = crate::image::image_to_png_inner(&data).map_err(NapiError::from_reason)?;
    Ok(ImageToPng {
        data: Buffer::from(out.data),
        width: out.width,
        height: out.height,
    })
}

// opds_parser.rs
#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct OpdsLink {
    pub rel: String,
    pub href: String,
    pub r#type: Option<String>,
    pub title: Option<String>,
    pub length: Option<f64>,
    pub facet_group: Option<String>,
    pub active_facet: bool,
    pub count: Option<f64>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct OpdsFacet {
    pub group: String,
    pub title: String,
    pub href: String,
    pub active: bool,
    pub count: Option<f64>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct OpdsAuthor {
    pub name: String,
    pub uri: Option<String>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct OpdsCategory {
    pub scheme: Option<String>,
    pub term: String,
    pub label: Option<String>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
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

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
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

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_opds_atom(text: String) -> NapiResult<OpdsFeed> {
    crate::opds_parser::parse_opds_atom_inner(&text)
        .map(|feed| OpdsFeed {
            id: feed.id,
            title: feed.title,
            subtitle: feed.subtitle,
            updated: feed.updated,
            kind: feed.kind,
            links: feed
                .links
                .into_iter()
                .map(|l| OpdsLink {
                    rel: l.rel,
                    href: l.href,
                    r#type: l.type_,
                    title: l.title,
                    length: l.length,
                    facet_group: l.facet_group,
                    active_facet: l.active_facet,
                    count: l.count,
                })
                .collect(),
            facets: feed
                .facets
                .into_iter()
                .map(|f| OpdsFacet {
                    group: f.group,
                    title: f.title,
                    href: f.href,
                    active: f.active,
                    count: f.count,
                })
                .collect(),
            entries: feed
                .entries
                .into_iter()
                .map(|e| OpdsEntry {
                    id: e.id,
                    title: e.title,
                    updated: e.updated,
                    summary: e.summary,
                    content: e.content,
                    authors: e
                        .authors
                        .into_iter()
                        .map(|a| OpdsAuthor {
                            name: a.name,
                            uri: a.uri,
                        })
                        .collect(),
                    categories: e
                        .categories
                        .into_iter()
                        .map(|c| OpdsCategory {
                            scheme: c.scheme,
                            term: c.term,
                            label: c.label,
                        })
                        .collect(),
                    language: e.language,
                    issued: e.issued,
                    publisher: e.publisher,
                    identifier: e.identifier,
                    rights: e.rights,
                    published: e.published,
                    links: e
                        .links
                        .into_iter()
                        .map(|l| OpdsLink {
                            rel: l.rel,
                            href: l.href,
                            r#type: l.type_,
                            title: l.title,
                            length: l.length,
                            facet_group: l.facet_group,
                            active_facet: l.active_facet,
                            count: l.count,
                        })
                        .collect(),
                    acquisition_links: e
                        .acquisition_links
                        .into_iter()
                        .map(|l| OpdsLink {
                            rel: l.rel,
                            href: l.href,
                            r#type: l.type_,
                            title: l.title,
                            length: l.length,
                            facet_group: l.facet_group,
                            active_facet: l.active_facet,
                            count: l.count,
                        })
                        .collect(),
                    thumbnail_href: e.thumbnail_href,
                    image_href: e.image_href,
                    is_acquisition: e.is_acquisition,
                    is_navigation: e.is_navigation,
                    subsection_href: e.subsection_href,
                })
                .collect(),
            self_href: feed.self_href,
            start_href: feed.start_href,
            up_href: feed.up_href,
            next_href: feed.next_href,
            prev_href: feed.prev_href,
            search_href: feed.search_href,
            total_results: feed.total_results,
            items_per_page: feed.items_per_page,
            start_index: feed.start_index,
        })
        .map_err(NapiError::from_reason)
}

// search.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn build_search_index(blocks: Vec<Block>) -> BookSearchIndex {
    let blocks_owned: Vec<crate::model::Block> = blocks;
    BookSearchIndex(crate::search::BookSearchIndex::new(&blocks_owned))
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub struct BookSearchIndex(pub(crate) crate::search::BookSearchIndex);

#[cfg(feature = "napi-runtime")]
#[napi]
impl BookSearchIndex {
    #[napi(constructor)]
    pub fn new(blocks: Vec<Block>) -> Self {
        BookSearchIndex(crate::search::BookSearchIndex::new(&blocks))
    }

    #[napi(getter)]
    pub fn block_count(&self) -> i32 {
        self.0.block_count()
    }

    #[napi]
    pub fn search(&self, query: String) -> Vec<SearchMatch> {
        self.0
            .search(&query)
            .into_iter()
            .map(|m| SearchMatch {
                block_index: m.block_index,
                start: m.start,
                end: m.end,
            })
            .collect()
    }

    #[napi]
    pub fn block_highlights(&self, query: String, block_index: i32) -> Vec<HighlightRange> {
        self.0
            .block_highlights(&query, block_index)
            .into_iter()
            .map(|h| HighlightRange {
                start: h.start,
                end: h.end,
            })
            .collect()
    }

    /// All block highlight ranges for a query in a single crossing (avoids
    /// per-block napi calls when the layout wrapper syncs highlights).
    #[napi]
    pub fn highlight_ranges(&self, query: String) -> Vec<BlockHighlights> {
        self.0
            .highlight_ranges(&query)
            .into_iter()
            .map(|(block_index, ranges)| BlockHighlights {
                block_index,
                ranges: ranges
                    .into_iter()
                    .map(|h| HighlightRange {
                        start: h.start,
                        end: h.end,
                    })
                    .collect(),
            })
            .collect()
    }
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
pub struct SearchMatch {
    pub block_index: i32,
    pub start: i32,
    pub end: i32,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct HighlightRange {
    pub start: i32,
    pub end: i32,
}

// renderer/layout.rs — TextLine and StyledSpan as napi objects
#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct StyledSpan {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub link: bool,
    pub highlight: bool,
}

// Per-block search-highlight ranges pushed into BookLayout from TS. The napi
// boundary cannot carry Box<dyn Fn> closures, so readerModel computes ranges
// via BookSearchIndex.blockHighlights and feeds them here as data.
#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct BlockHighlights {
    pub block_index: i32,
    pub ranges: Vec<HighlightRange>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct TextLine {
    pub role: String,
    pub spans: Vec<StyledSpan>,
    pub indent: i32,
    pub prefix: String,
    pub block_index: i32,
    pub char_offset: i32,
}

// BookLayout — napi class. Highlights are passed via set_highlights (TS calls
// block_highlights from BookSearchIndex and feeds results here), because napi
// cannot carry Box<dyn Fn> closures across the boundary.
#[cfg(feature = "napi-runtime")]
#[napi]
pub struct BookLayout {
    inner: parking_lot::Mutex<crate::renderer::layout::BookLayout>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
pub struct TypographyConfigNapi {
    pub measure: i32,
    pub line_spacing: i32,
    pub paragraph_indent: i32,
    pub paragraph_spacing: i32,
    pub hyphenation: bool,
    pub justify: bool,
}

#[cfg(feature = "napi-runtime")]
#[napi]
impl BookLayout {
    #[napi(constructor)]
    pub fn new(blocks: Vec<Block>, typo: TypographyConfigNapi, width: i32, justify: bool) -> Self {
        let opts = crate::renderer::layout::LayoutOptions {
            typo: crate::renderer::layout::TypographyConfig {
                measure: typo.measure,
                line_spacing: typo.line_spacing,
                paragraph_indent: typo.paragraph_indent,
                paragraph_spacing: typo.paragraph_spacing,
                hyphenation: typo.hyphenation,
                justify: typo.justify,
            },
            width,
            justify,
            hyphenation: typo.hyphenation,
            get_highlights: None,
        };
        Self {
            inner: parking_lot::Mutex::new(crate::renderer::layout::BookLayout::new(blocks, opts)),
        }
    }

    #[napi(getter)]
    pub fn block_count(&self) -> i32 {
        self.inner.lock().block_count
    }

    #[napi(getter)]
    pub fn total_chars(&self) -> i32 {
        self.inner.lock().total_chars
    }

    #[napi]
    pub fn ensure_blocks_up_to(&self, block_index: i32) {
        self.inner.lock().ensure_blocks_up_to(block_index);
    }

    #[napi]
    pub fn ensure_line_count(&self, count: i32) -> i32 {
        self.inner.lock().ensure_line_count(count)
    }

    #[napi]
    pub fn line_count(&self) -> i32 {
        self.inner.lock().line_count()
    }

    #[napi]
    pub fn get_page(&self, page: i32, page_height: i32) -> Vec<TextLine> {
        self.inner
            .lock()
            .get_page(page, page_height)
            .into_iter()
            .map(text_line_to_napi)
            .collect()
    }

    #[napi]
    pub fn get_range(&self, start: i32, count: i32) -> Vec<TextLine> {
        self.inner
            .lock()
            .get_range(start, count)
            .into_iter()
            .map(text_line_to_napi)
            .collect()
    }

    #[napi]
    pub fn page_for_char_offset(&self, char_offset: i32, page_height: i32) -> i32 {
        self.inner
            .lock()
            .page_for_char_offset(char_offset, page_height)
    }

    #[napi]
    pub fn text_near(&self, char_offset: i32, length: i32) -> String {
        self.inner.lock().text_near(char_offset, length)
    }

    #[napi]
    pub fn estimate_line_count(&self) -> i32 {
        self.inner.lock().estimate_line_count()
    }

    #[napi]
    pub fn block_start_line(&self, block_index: i32) -> Option<i32> {
        self.inner.lock().block_start_line(block_index)
    }

    #[napi]
    pub fn line_for_block(&self, block_index: i32) -> i32 {
        self.inner.lock().line_for_block(block_index)
    }

    #[napi]
    pub fn block_char_start(&self, block_index: i32) -> i32 {
        self.inner.lock().block_char_start(block_index)
    }

    #[napi]
    pub fn line_for_char_offset(&self, char_offset: i32) -> i32 {
        self.inner.lock().line_for_char_offset(char_offset)
    }

    #[napi]
    pub fn char_offset_for_line(&self, line: i32) -> i32 {
        self.inner.lock().char_offset_for_line(line)
    }

    #[napi]
    pub fn invalidate(&self) {
        self.inner.lock().invalidate();
    }

    /// Replace the per-block search-highlight ranges. Ranges are in block-
    /// local char offsets (same coordinates as BookSearchIndex.blockHighlights).
    #[napi]
    pub fn set_highlights(&self, highlights: Vec<BlockHighlights>) {
        let map: std::collections::HashMap<i32, Vec<crate::renderer::layout::HighlightRange>> =
            highlights
                .into_iter()
                .map(|h| {
                    let ranges = h
                        .ranges
                        .into_iter()
                        .map(|r| crate::renderer::layout::HighlightRange {
                            start: r.start,
                            end: r.end,
                        })
                        .collect();
                    (h.block_index, ranges)
                })
                .collect();
        self.inner.lock().set_highlights(map);
    }
}

#[cfg(feature = "napi-runtime")]
fn text_line_to_napi(tl: crate::renderer::layout::TextLine) -> TextLine {
    TextLine {
        role: tl.role,
        spans: tl
            .spans
            .into_iter()
            .map(|s| StyledSpan {
                text: s.text,
                bold: s.bold,
                italic: s.italic,
                underline: s.underline,
                strike: s.strike,
                link: s.link,
                highlight: s.highlight,
            })
            .collect(),
        indent: tl.indent,
        prefix: tl.prefix,
        block_index: tl.block_index,
        char_offset: tl.char_offset,
    }
}

// db.rs — LibraryDb napi class
#[cfg(feature = "napi-runtime")]
#[napi]
pub struct LibraryDb {
    inner: crate::db::LibraryDb,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct BookRecord {
    pub id: i32,
    pub path: String,
    pub filename: String,
    pub format: String,
    pub size: f64,
    pub title: String,
    pub authors: Vec<Author>,
    pub series: Option<SeriesInfo>,
    pub genres: Vec<String>,
    pub annotation: String,
    pub lang: Option<String>,
    pub cover_key: Option<String>,
    pub publisher: Option<String>,
    pub isbn: Option<String>,
    pub year: Option<f64>,
    pub added_at: String,
    pub last_opened_at: Option<String>,
    pub progress_percent: Option<f64>,
    pub progress_position: Option<f64>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct BookmarkRecord {
    pub id: i32,
    pub book_id: i32,
    pub position: f64,
    pub label: String,
    pub created_at: String,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct ProgressRecord {
    pub book_id: i32,
    pub position: f64,
    pub percent: f64,
    pub updated_at: String,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct HistoryRecord {
    pub book_id: i32,
    pub title: String,
    pub opened_at: String,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct SessionStats {
    pub total_seconds: f64,
    pub total_pages: f64,
    pub session_count: f64,
    pub last_read_at: Option<String>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct CatalogRecord {
    pub id: i32,
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct LibraryFolderRecord {
    pub id: i32,
    pub path: String,
    pub added_at: String,
    pub last_scanned_at: Option<f64>,
}

#[cfg(feature = "napi-runtime")]
#[napi]
impl LibraryDb {
    #[napi(getter)]
    pub fn file_path(&self) -> String {
        self.inner.file_path.clone()
    }

    #[napi]
    pub fn close(&self) {
        self.inner.close();
    }

    #[napi]
    pub fn file_exists(&self) -> bool {
        self.inner.file_exists()
    }

    #[napi]
    pub fn add_book(
        &self,
        path: String,
        filename: String,
        format: String,
        size: f64,
        metadata: BookMetadata,
        library_root: Option<String>,
    ) -> NapiResult<f64> {
        self.inner
            .add_book(
                &path,
                &filename,
                &format,
                size as i64,
                &metadata,
                library_root.as_deref(),
            )
            .map(|id| id as f64)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn get_book(&self, id: f64) -> Option<BookRecord> {
        self.inner
            .get_book(id as i32)
            .ok()
            .flatten()
            .map(book_record_to_napi)
    }

    #[napi]
    pub fn get_book_by_path(&self, path: String) -> Option<BookRecord> {
        self.inner
            .get_book_by_path(&path)
            .ok()
            .flatten()
            .map(book_record_to_napi)
    }

    #[napi]
    pub fn list_books(&self, limit: Option<f64>, offset: f64, order_by: String) -> Vec<BookRecord> {
        self.inner
            .list_books(limit.map(|l| l as i32), offset as i32, &order_by)
            .unwrap_or_default()
            .into_iter()
            .map(book_record_to_napi)
            .collect()
    }

    #[napi]
    pub fn remove_book(&self, id: f64) -> bool {
        self.inner.remove_book(id as i32).unwrap_or(false)
    }

    #[napi]
    pub fn set_progress(&self, book_id: f64, position: f64, percent: f64) -> NapiResult<()> {
        self.inner
            .set_progress(book_id as i32, position as i64, percent)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn get_progress(&self, book_id: f64) -> Option<ProgressRecord> {
        self.inner
            .get_progress(book_id as i32)
            .ok()
            .flatten()
            .map(|p| ProgressRecord {
                book_id: p.book_id,
                position: p.position as f64,
                percent: p.percent,
                updated_at: p.updated_at,
            })
    }

    #[napi]
    pub fn add_bookmark(&self, book_id: f64, position: f64, label: String) -> NapiResult<f64> {
        self.inner
            .add_bookmark(book_id as i32, position as i64, &label)
            .map(|id| id as f64)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn list_bookmarks(&self, book_id: f64) -> Vec<BookmarkRecord> {
        self.inner
            .list_bookmarks(book_id as i32)
            .unwrap_or_default()
            .into_iter()
            .map(|b| BookmarkRecord {
                id: b.id,
                book_id: b.book_id,
                position: b.position as f64,
                label: b.label,
                created_at: b.created_at,
            })
            .collect()
    }

    #[napi]
    pub fn get_bookmark(&self, id: f64) -> Option<BookmarkRecord> {
        self.inner
            .get_bookmark(id as i32)
            .ok()
            .flatten()
            .map(|b| BookmarkRecord {
                id: b.id,
                book_id: b.book_id,
                position: b.position as f64,
                label: b.label,
                created_at: b.created_at,
            })
    }

    #[napi]
    pub fn delete_bookmark(&self, id: f64) -> bool {
        self.inner.delete_bookmark(id as i32).unwrap_or(false)
    }

    #[napi]
    pub fn update_bookmark_label(&self, id: f64, label: String) -> bool {
        self.inner
            .update_bookmark_label(id as i32, &label)
            .unwrap_or(false)
    }

    #[napi]
    pub fn record_open(&self, book_id: f64) -> NapiResult<()> {
        self.inner
            .record_open(book_id as i32)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn list_history(&self, limit: f64) -> Vec<HistoryRecord> {
        self.inner
            .list_history(limit as i32)
            .unwrap_or_default()
            .into_iter()
            .map(|h| HistoryRecord {
                book_id: h.book_id,
                title: h.title,
                opened_at: h.opened_at,
            })
            .collect()
    }

    #[napi]
    pub fn list_recent_books(&self, limit: f64) -> Vec<BookRecord> {
        self.inner
            .list_recent_books(limit as i32)
            .unwrap_or_default()
            .into_iter()
            .map(book_record_to_napi)
            .collect()
    }

    #[napi]
    pub fn list_continue_books(&self, limit: f64) -> Vec<BookRecord> {
        self.inner
            .list_continue_books(limit as i32)
            .unwrap_or_default()
            .into_iter()
            .map(book_record_to_napi)
            .collect()
    }

    #[napi]
    pub fn start_session(&self, book_id: f64) -> NapiResult<f64> {
        self.inner
            .start_session(book_id as i32)
            .map(|id| id as f64)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn end_session(&self, session_id: f64, pages_read: f64) -> NapiResult<()> {
        self.inner
            .end_session(session_id as i32, pages_read as i32)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn get_stats(&self, book_id: f64) -> SessionStats {
        let s = self
            .inner
            .get_stats(book_id as i32)
            .unwrap_or(crate::db::SessionStats {
                total_seconds: 0,
                total_pages: 0,
                session_count: 0,
                last_read_at: None,
            });
        SessionStats {
            total_seconds: s.total_seconds as f64,
            total_pages: s.total_pages as f64,
            session_count: s.session_count as f64,
            last_read_at: s.last_read_at,
        }
    }

    #[napi]
    pub fn add_catalog(
        &self,
        name: String,
        url: String,
        username: Option<String>,
        password: Option<String>,
    ) -> NapiResult<f64> {
        self.inner
            .add_catalog(&name, &url, username.as_deref(), password.as_deref())
            .map(|id| id as f64)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn list_catalogs(&self) -> Vec<CatalogRecord> {
        self.inner
            .list_catalogs()
            .unwrap_or_default()
            .into_iter()
            .map(|c| CatalogRecord {
                id: c.id,
                name: c.name,
                url: c.url,
                username: c.username,
                password: c.password,
            })
            .collect()
    }

    #[napi]
    pub fn get_catalog(&self, id: f64) -> Option<CatalogRecord> {
        self.inner
            .get_catalog(id as i32)
            .ok()
            .flatten()
            .map(|c| CatalogRecord {
                id: c.id,
                name: c.name,
                url: c.url,
                username: c.username,
                password: c.password,
            })
    }

    #[napi]
    pub fn get_catalog_by_name(&self, name: String) -> Option<CatalogRecord> {
        self.inner
            .get_catalog_by_name(&name)
            .ok()
            .flatten()
            .map(|c| CatalogRecord {
                id: c.id,
                name: c.name,
                url: c.url,
                username: c.username,
                password: c.password,
            })
    }

    #[napi]
    pub fn update_catalog(
        &self,
        id: f64,
        name: Option<String>,
        url: Option<String>,
        username: Option<String>,
        password: Option<String>,
    ) -> NapiResult<()> {
        self.inner
            .update_catalog(
                id as i32,
                name.as_deref(),
                url.as_deref(),
                username.as_deref(),
                password.as_deref(),
            )
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn remove_catalog(&self, id: f64) -> NapiResult<()> {
        self.inner
            .remove_catalog(id as i32)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn add_library_folder(&self, path: String) -> NapiResult<f64> {
        self.inner
            .add_library_folder(&path)
            .map(|id| id as f64)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn list_library_folders(&self) -> Vec<LibraryFolderRecord> {
        self.inner
            .list_library_folders()
            .unwrap_or_default()
            .into_iter()
            .map(|f| LibraryFolderRecord {
                id: f.id,
                path: f.path,
                added_at: f.added_at,
                last_scanned_at: f.last_scanned_at.map(|v| v as f64),
            })
            .collect()
    }

    #[napi]
    pub fn get_library_folder_by_path(&self, path: String) -> Option<LibraryFolderRecord> {
        self.inner
            .get_library_folder_by_path(&path)
            .ok()
            .flatten()
            .map(|f| LibraryFolderRecord {
                id: f.id,
                path: f.path,
                added_at: f.added_at,
                last_scanned_at: f.last_scanned_at.map(|v| v as f64),
            })
    }

    #[napi]
    pub fn set_folder_scanned_at(&self, id: f64, scanned_at_ms: f64) -> NapiResult<()> {
        self.inner
            .set_folder_scanned_at(id as i32, scanned_at_ms as i64)
            .map_err(NapiError::from_reason)
    }

    #[napi]
    pub fn remove_library_folder(&self, id: f64) -> bool {
        self.inner.remove_library_folder(id as i32).unwrap_or(false)
    }

    #[napi]
    pub fn list_paths_by_library_root(&self, root: String) -> Vec<String> {
        self.inner
            .list_paths_by_library_root(&root)
            .unwrap_or_default()
    }

    #[napi]
    pub fn remove_books_by_paths(&self, paths: Vec<String>) -> f64 {
        self.inner.remove_books_by_paths(&paths).unwrap_or(0) as f64
    }

    #[napi]
    pub fn remove_books_by_library_root(&self, root: String) -> f64 {
        self.inner.remove_books_by_library_root(&root).unwrap_or(0) as f64
    }
}

#[cfg(feature = "napi-runtime")]
fn book_record_to_napi(b: crate::db::BookRecord) -> BookRecord {
    BookRecord {
        id: b.id,
        path: b.path,
        filename: b.filename,
        format: b.format,
        size: b.size as f64,
        title: b.title,
        authors: b.authors,
        series: b.series,
        genres: b.genres,
        annotation: b.annotation,
        lang: b.lang,
        cover_key: b.cover_key,
        publisher: b.publisher,
        isbn: b.isbn,
        year: b.year,
        added_at: b.added_at,
        last_opened_at: b.last_opened_at,
        progress_percent: b.progress_percent,
        progress_position: b.progress_position.map(|p| p as f64),
    }
}

// db.rs — LibraryDb napi class. No `#[napi(constructor)]`: napi-rs constructors
// cannot return Result, and panicking inside one aborts the whole process
// (napi-rs does not catch panics). Opening failures (unwritable path, corrupt
// file, directory as path) must surface as a JS error, so instances are created
// via the `open_library_db` factory below, which maps Err to a napi error value
// that the TS facade turns into DatabaseError.
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn open_library_db(file_path: String) -> NapiResult<LibraryDb> {
    crate::db::LibraryDb::open(&file_path)
        .map(|inner| LibraryDb { inner })
        .map_err(NapiError::from_reason)
}

// scan.rs
#[cfg(feature = "napi-runtime")]
#[napi(object)]
#[derive(Clone)]
pub struct ScanSummaryNapi {
    pub total: f64,
    pub added: f64,
    pub updated: f64,
    pub removed: f64,
    pub failed: f64,
    pub errors: Vec<String>,
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn walk_book_files(root: String) -> Vec<String> {
    crate::scan::walk_book_files(&root)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn scan_library_folder(db: &LibraryDb, root: String) -> NapiResult<ScanSummaryNapi> {
    crate::scan::scan_library_folder(&db.inner, &root)
        .map(|s| ScanSummaryNapi {
            total: s.total as f64,
            added: s.added as f64,
            updated: s.updated as f64,
            removed: s.removed as f64,
            failed: s.failed as f64,
            errors: s.errors,
        })
        .map_err(NapiError::from_reason)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn folder_needs_rescan(db: &LibraryDb, folder: LibraryFolderRecord) -> bool {
    let f = crate::db::LibraryFolderRecord {
        id: folder.id,
        path: folder.path,
        added_at: folder.added_at,
        last_scanned_at: folder.last_scanned_at.map(|v| v as i64),
    };
    crate::scan::folder_needs_rescan(&db.inner, &f)
}

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn resolve_folder_path(p: String) -> String {
    crate::scan::resolve_folder_path(&p)
}
