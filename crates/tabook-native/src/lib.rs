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
mod inline;
mod model;
mod opds_parser;
mod renderer;
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
use crate::model::{BookMetadata, ParsedBook};

#[cfg(feature = "napi-runtime")]
#[napi]
pub fn hello() -> String {
    "tabook-native 0.1.0".to_owned()
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
    crate::epub::parser::parse_epub_metadata_inner(&data, &file_path).map_err(NapiError::from_reason)
}

// opds_parser.rs
#[cfg(feature = "napi-runtime")]
#[napi]
pub fn parse_opds_atom(_text: String) -> NapiResult<()> {
    Err(NapiError::from_reason(
        "parseOpdsAtom: not yet implemented (phase 12)",
    ))
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
            .map(|h| HighlightRange { start: h.start, end: h.end })
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
pub struct HighlightRange {
    pub start: i32,
    pub end: i32,
}