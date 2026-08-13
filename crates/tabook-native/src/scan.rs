//! Library scanner — Rust port of `src/db/scan.ts` (259 LOC).
//!
//! Recursive folder walk, batch metadata extraction, vanished-file cleanup.
//! mtime-based dirty check for skipping rescans of unchanged folders.

use crate::db::{LibraryDb, LibraryFolderRecord, ScanSummary};
use crate::epub::parser::parse_epub_metadata_inner;
use crate::fb2::parser::parse_fb2_metadata_inner;
use crate::formats_index::detect_format_inner;
use std::path::Path;
use walkdir::WalkDir;

const BOOK_FILE_RE: &str = r"\.(?:epub|fb2(?:\.zip)?)$";
const MAX_REPORTED_ERRORS: usize = 5;

pub fn resolve_folder_path(p: &str) -> String {
    let expanded = expand_tilde(p);
    Path::new(&expanded)
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(expanded)
}

fn expand_tilde(p: &str) -> String {
    if p == "~" {
        return dirs::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or(p.to_owned());
    }
    if p.starts_with("~/") || p.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.to_string_lossy(), &p[1..]);
        }
    }
    p.to_owned()
}

fn is_book_file(name: &str) -> bool {
    let re = regex::Regex::new(&format!("(?i){BOOK_FILE_RE}")).unwrap();
    re.is_match(name)
}

pub fn walk_book_files(root: &str) -> Vec<String> {
    let mut files = Vec::new();
    let walker = WalkDir::new(root).follow_links(false);
    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_book_file(&name) {
            continue;
        }
        // Skip hidden directories
        let mut is_hidden = false;
        for comp in entry.path().components() {
            if let std::path::Component::Normal(s) = comp {
                if s.to_string_lossy().starts_with('.') && s.to_string_lossy() != "." {
                    is_hidden = true;
                    break;
                }
            }
        }
        if is_hidden && entry.path() != Path::new(root) {
            continue;
        }
        files.push(entry.path().to_string_lossy().into_owned());
    }
    files.sort();
    files
}

pub fn scan_library_folder(
    db: &LibraryDb,
    root: &str,
) -> Result<ScanSummary, String> {
    let stat = std::fs::metadata(root).map_err(|_| format!("Folder not found: {root}"))?;
    if !stat.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }

    let files = walk_book_files(root);
    let seen: std::collections::HashSet<String> = files.iter().cloned().collect();
    let total = files.len() as i32;

    let attached_at_start = db.get_library_folder_by_path(root).unwrap_or(None).is_some();

    let mut summary = ScanSummary {
        total,
        added: 0,
        updated: 0,
        removed: 0,
        failed: 0,
        errors: Vec::new(),
    };

    let existing: std::collections::HashSet<String> =
        db.list_paths_by_library_root(root).unwrap_or_default().into_iter().collect();

    for file in &files {
        if attached_at_start && db.get_library_folder_by_path(root).unwrap_or(None).is_none() {
            break;
        }
        match scan_one_file(db, file, root) {
            Ok(was_new) => {
                if was_new {
                    summary.added += 1;
                } else {
                    summary.updated += 1;
                }
            }
            Err(e) => {
                summary.failed += 1;
                if summary.errors.len() < MAX_REPORTED_ERRORS {
                    let name = Path::new(file)
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    summary.errors.push(format!("{name}: {e}"));
                }
            }
        }
    }

    // Remove vanished files
    let vanished: Vec<String> = existing.iter().filter(|p| !seen.contains(*p)).cloned().collect();
    if !vanished.is_empty() {
        summary.removed = db.remove_books_by_paths(&vanished).unwrap_or(0);
    }

    // Record scan completion
    if let Ok(Some(folder)) = db.get_library_folder_by_path(root) {
        let _ = db.set_folder_scanned_at(folder.id, chrono_now_ms());
    }

    Ok(summary)
}

fn scan_one_file(db: &LibraryDb, file: &str, root: &str) -> Result<bool, String> {
    let data = std::fs::read(file).map_err(|e| e.to_string())?;
    let name = Path::new(file)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let format = detect_format_inner(&data, &name)?;
    let metadata = match format.as_str() {
        "fb2" => parse_fb2_metadata_inner(&data, file)?,
        "epub" => parse_epub_metadata_inner(&data, file)?,
        _ => return Err(format!("Unsupported format: {format}")),
    };
    let existing = db.get_book_by_path(file).unwrap_or(None);
    db.add_book(file, &name, &format, data.len() as i64, &metadata, Some(root))?;
    Ok(existing.is_none())
}

pub fn folder_needs_rescan(db: &LibraryDb, folder: &LibraryFolderRecord) -> bool {
    let Some(last_scanned_at) = folder.last_scanned_at else {
        return true;
    };
    let stat = match std::fs::metadata(&folder.path) {
        Ok(s) => s,
        Err(_) => return false,
    };
    if !stat.is_dir() {
        return false;
    }

    let db_paths: std::collections::HashSet<String> =
        db.list_paths_by_library_root(&folder.path).unwrap_or_default().into_iter().collect();
    let mut walked = std::collections::HashSet::new();
    let mut dirty = false;
    for file in walk_book_files(&folder.path) {
        walked.insert(file.clone());
        if let Ok(meta) = std::fs::metadata(&file) {
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            if mtime_ms > last_scanned_at {
                dirty = true;
                break;
            }
        }
    }
    if dirty {
        return true;
    }
    for p in &db_paths {
        if !walked.contains(p) {
            return true;
        }
    }
    false
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_fb2(path: &Path) {
        let content = r##"<?xml version="1.0"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info><book-title>Test</book-title><author><first-name>A</first-name><last-name>B</last-name></author></title-info></description>
  <body><section><p>Hello</p></section></body>
</FictionBook>"##;
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn walk_finds_book_files() {
        let dir = std::env::temp_dir().join(format!("tabook-scan-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        make_fb2(&dir.join("a.fb2"));
        make_fb2(&dir.join("b.fb2"));
        std::fs::write(dir.join("c.txt"), b"not a book").unwrap();
        let files = walk_book_files(dir.to_string_lossy().as_ref());
        assert_eq!(files.len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scan_imports_metadata() {
        let dir = std::env::temp_dir().join(format!("tabook-scan-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        make_fb2(&dir.join("book.fb2"));
        let db = LibraryDb::open(":memory:").unwrap();
        db.add_library_folder(dir.to_string_lossy().as_ref()).unwrap();
        let summary = scan_library_folder(&db, dir.to_string_lossy().as_ref()).unwrap();
        assert_eq!(summary.total, 1);
        assert_eq!(summary.added, 1);
        let books = db.list_books(None, 0, "title").unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].title, "Test");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn folder_needs_rescan_when_new_file() {
        let dir = std::env::temp_dir().join(format!("tabook-scan-test3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        make_fb2(&dir.join("a.fb2"));
        let db = LibraryDb::open(":memory:").unwrap();
        let fid = db.add_library_folder(dir.to_string_lossy().as_ref()).unwrap();
        let _ = scan_library_folder(&db, dir.to_string_lossy().as_ref()).unwrap();
        // After scan, no rescan needed
        let folder = db.get_library_folder_by_path(dir.to_string_lossy().as_ref()).unwrap().unwrap();
        assert!(!folder_needs_rescan(&db, &folder));
        // Add a new file → needs rescan. Set its mtime explicitly to a time
        // after the scan timestamp: filesystem mtime granularity is coarse (1s
        // on some CI filesystems), so a file created in the same second as the
        // scan could compare as "not newer" and flake this assertion.
        let b = dir.join("b.fb2");
        make_fb2(&b);
        let f = std::fs::File::options().write(true).open(&b).unwrap();
        f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(5))
            .unwrap();
        drop(f);
        assert!(folder_needs_rescan(&db, &folder));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resolve_folder_path_expands_tilde() {
        let p = resolve_folder_path("~");
        // Should resolve to home dir (not literally "~")
        assert_ne!(p, "~");
    }
}