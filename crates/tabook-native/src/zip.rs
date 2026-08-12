//! ZIP archive reader — port of `src/utils/zip.ts`.

use std::io::Cursor;

#[derive(Clone, Debug)]
pub struct ZipEntryInfoInner {
    pub name: String,
    pub size: u32,
}

pub struct ZipArchive {
    pub entries: Vec<ZipEntryInfoInner>,
    pub bytes: Vec<u8>,
}

impl ZipArchive {
    pub fn open(data: Vec<u8>) -> Result<Self, String> {
        let cursor = Cursor::new(&data);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid ZIP archive: {e}"))?;
        let mut entries = Vec::with_capacity(archive.len());
        for i in 0..archive.len() {
            let entry = archive
                .by_index(i)
                .map_err(|e| format!("ZIP read error: {e}"))?;
            if entry.is_dir() {
                continue;
            }
            let norm = normalize_zip_path(entry.name());
            if norm.starts_with("../") || std::path::Path::new(&norm).is_absolute() {
                return Err(format!("ZIP entry escapes archive root: {}", entry.name()));
            }
            entries.push(ZipEntryInfoInner {
                name: norm,
                size: entry.size() as u32,
            });
        }
        Ok(ZipArchive { entries, bytes: data })
    }

    pub fn read(&self, name: &str) -> Result<Vec<u8>, String> {
        let cursor = Cursor::new(&self.bytes);
        let mut zip = zip::ZipArchive::new(cursor).map_err(|e| format!("ZIP reopen: {e}"))?;
        let idx = (0..zip.len())
            .find(|&i| {
                zip.by_index_raw(i)
                    .map(|e| e.name() == name && !e.is_dir())
                    .unwrap_or(false)
            })
            .ok_or_else(|| format!("ZIP entry not found: {name}"))?;
        let mut entry = zip
            .by_index(idx)
            .map_err(|e| format!("ZIP read {name}: {e}"))?;
        let mut buf = Vec::with_capacity(entry.size() as usize);
        std::io::Read::read_to_end(&mut entry, &mut buf)
            .map_err(|e| format!("ZIP read {name}: {e}"))?;
        Ok(buf)
    }
}

fn normalize_zip_path(p: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            for (name, data) in files {
                zip.start_file(name, opts).unwrap();
                zip.write_all(data).unwrap();
            }
            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn reads_entries() {
        let zip_bytes = make_zip(&[("a.txt", b"hello"), ("b.txt", b"world")]);
        let archive = ZipArchive::open(zip_bytes).unwrap();
        assert_eq!(archive.entries.len(), 2);
    }

    #[test]
    fn read_returns_data() {
        let zip_bytes = make_zip(&[("a.txt", b"hello")]);
        let archive = ZipArchive::open(zip_bytes).unwrap();
        let data = archive.read("a.txt").unwrap();
        assert_eq!(data, b"hello");
    }

    #[test]
    fn normalize_strips_dotdot() {
        assert_eq!(normalize_zip_path("a/b/../c"), "a/c");
        assert_eq!(normalize_zip_path("../escape"), "escape");
    }
}