//! formats/index — Rust port of `src/formats/index.ts` (77 LOC).
//!
//! detect+dispatch for FB2/EPUB, with a bounded LRU cache (MAX=4) of parsed
//! books keyed by path. Library detail re-parses for covers, reopening re-parses
//! too; caching makes repeat opens instant.

use crate::epub::parser::parse_epub_buffer_inner;
use crate::fb2::parser::parse_fb2_buffer_inner;
use crate::model::ParsedBook;
use std::collections::VecDeque;
use std::sync::Mutex;

use once_cell::sync::Lazy;

const MAX_CACHED_BOOKS: usize = 4;

struct BookCache {
    entries: VecDeque<(String, ParsedBook)>,
}

static BOOK_CACHE: Lazy<Mutex<BookCache>> = Lazy::new(|| {
    Mutex::new(BookCache {
        entries: VecDeque::with_capacity(MAX_CACHED_BOOKS),
    })
});

pub fn invalidate_book_cache_inner() {
    BOOK_CACHE.lock().unwrap().entries.clear();
}

fn cached_parse(data: &[u8], file_path: &str) -> Result<ParsedBook, String> {
    let mut cache = BOOK_CACHE.lock().unwrap();
    if let Some(pos) = cache.entries.iter().position(|(p, _)| p == file_path) {
        return Ok(cache.entries[pos].1.clone());
    }
    drop(cache);
    let book = dispatch_parse(data, file_path)?;
    let mut cache = BOOK_CACHE.lock().unwrap();
    if cache.entries.len() >= MAX_CACHED_BOOKS {
        cache.entries.pop_front();
    }
    cache.entries.push_back((file_path.to_owned(), book.clone()));
    Ok(book)
}

fn dispatch_parse(data: &[u8], file_path: &str) -> Result<ParsedBook, String> {
    let format = detect_format_inner(data, std::path::Path::new(file_path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default().as_str())?;
    match format.as_str() {
        "fb2" => parse_fb2_buffer_inner(data, file_path),
        "epub" => parse_epub_buffer_inner(data, file_path),
        _ => Err(format!("Unsupported format for {file_path}")),
    }
}

pub fn parse_book_file_inner(file_path: &str) -> Result<ParsedBook, String> {
    {
        let cache = BOOK_CACHE.lock().unwrap();
        if let Some(pos) = cache.entries.iter().position(|(p, _)| p == file_path) {
            return Ok(cache.entries[pos].1.clone());
        }
    }
    let data = std::fs::read(file_path).map_err(|e| format!("Cannot read {file_path}: {e}"))?;
    cached_parse(&data, file_path)
}

pub fn detect_format_inner(data: &[u8], name: &str) -> Result<String, String> {
    let lower = name.to_lowercase();
    if lower.ends_with(".fb2") || lower.ends_with(".fb2.zip") {
        return Ok("fb2".into());
    }
    if lower.ends_with(".epub") {
        return Ok("epub".into());
    }
    if crate::encoding::is_zip_buffer_inner(data) {
        return Ok("epub".into());
    }
    let head = String::from_utf8_lossy(&data[..data.len().min(512)]);
    if head.contains("<FictionBook") {
        return Ok("fb2".into());
    }
    if head.trim_start().starts_with("<?xml") && head.contains("<FictionBook") {
        return Ok("fb2".into());
    }
    Err(format!(
        "Cannot determine format of \"{name}\" — expected .fb2 or .epub"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_by_extension_fb2() {
        assert_eq!(detect_format_inner(&[], "book.fb2").unwrap(), "fb2");
    }

    #[test]
    fn detect_by_extension_epub() {
        assert_eq!(detect_format_inner(&[], "book.EPUB").unwrap(), "epub");
    }

    #[test]
    fn detect_zip_signature() {
        let zip = [0x50, 0x4b, 0x03, 0x04];
        assert_eq!(detect_format_inner(&zip, "unknown").unwrap(), "epub");
    }

    #[test]
    fn detect_fb2_by_content() {
        let xml = b"<?xml version=\"1.0\"?><FictionBook>...</FictionBook>";
        assert_eq!(detect_format_inner(xml, "unknown").unwrap(), "fb2");
    }

    #[test]
    fn unknown_rejected() {
        assert!(detect_format_inner(b"plain text", "noext.txt").is_err());
    }
}