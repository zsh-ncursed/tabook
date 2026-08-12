//! Encoding detection — port of `src/formats/encoding.ts`.

const UTF8_BOM: [u8; 3] = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM: [u8; 2] = [0xff, 0xfe];
const UTF16BE_BOM: [u8; 2] = [0xfe, 0xff];

pub fn detect_encoding_inner(data: &[u8]) -> String {
    if data.len() >= 3 && data[0..3] == UTF8_BOM {
        return "utf-8".to_owned();
    }
    if data.len() >= 2 && data[0..2] == UTF16LE_BOM {
        return "utf-16le".to_owned();
    }
    if data.len() >= 2 && data[0..2] == UTF16BE_BOM {
        return "utf-16be".to_owned();
    }
    let head_len = data.len().min(1024);
    let head = String::from_utf8_lossy(&data[..head_len]);
    if let Some(start) = head.find("encoding") {
        let after = &head[start..];
        if let Some(q_start) = after.find(['"', '\'']) {
            let quote_char = &after[q_start..q_start + 1];
            let rest = &after[q_start + 1..];
            if let Some(end) = rest.find(quote_char) {
                let enc = &rest[..end];
                return normalize_encoding_inner(enc);
            }
        }
    }
    if data.len() >= 2 {
        if data[0] == 0x3c && data[1] == 0x00 {
            return "utf-16le".to_owned();
        }
        if data[0] == 0x00 && data[1] == 0x3c {
            return "utf-16be".to_owned();
        }
    }
    "utf-8".to_owned()
}

pub fn normalize_encoding_inner(enc: &str) -> String {
    let e: String = enc.trim().to_lowercase().replace(['_', '-'], "");
    match e.as_str() {
        "utf8" | "utf" => "utf-8".to_owned(),
        "utf16" | "utf16le" => "utf-16le".to_owned(),
        "utf16be" => "utf-16be".to_owned(),
        "windows1251" | "win1251" | "cp1251" => "windows-1251".to_owned(),
        "cp1252" => "windows-1252".to_owned(),
        "koi8r" => "koi8-r".to_owned(),
        "iso88591" | "latin1" | "latin" => "iso-8859-1".to_owned(),
        _ => e,
    }
}

pub fn decode_xml_buffer_inner(data: &[u8]) -> String {
    let encoding = detect_encoding_inner(data);
    let bytes = if encoding == "utf-8" && data.len() >= 3 && data[0..3] == UTF8_BOM {
        &data[3..]
    } else {
        data
    };
    let enc = match encoding.as_str() {
        "utf-8" => encoding_rs::UTF_8,
        "utf-16le" => encoding_rs::UTF_16LE,
        "utf-16be" => encoding_rs::UTF_16BE,
        "windows-1251" => encoding_rs::WINDOWS_1251,
        "windows-1252" => encoding_rs::WINDOWS_1252,
        "koi8-r" => encoding_rs::KOI8_R,
        "iso-8859-1" => encoding_rs::WINDOWS_1252, // closest available
        _ => encoding_rs::UTF_8,
    };
    let (cow, _, _) = enc.decode(bytes);
    cow.into_owned()
}

pub fn file_extension_inner(name: &str) -> String {
    match name.rfind('.') {
        Some(dot) => name[dot + 1..].to_lowercase(),
        None => String::new(),
    }
}

pub fn is_zip_buffer_inner(data: &[u8]) -> bool {
    data.len() >= 4 && data[0] == 0x50 && data[1] == 0x4b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_utf8_bom() {
        let data = [0xef, 0xbb, 0xbf, b'<', b'a'];
        assert_eq!(detect_encoding_inner(&data), "utf-8");
    }

    #[test]
    fn detect_utf16le_bom() {
        let data = [0xff, 0xfe, 0x00, 0x00];
        assert_eq!(detect_encoding_inner(&data), "utf-16le");
    }

    #[test]
    fn detect_declared_encoding() {
        let xml = b"<?xml version=\"1.0\" encoding=\"windows-1251\"?><a/>";
        assert_eq!(detect_encoding_inner(xml), "windows-1251");
    }

    #[test]
    fn detect_utf16_heuristic() {
        let data = [0x3c, 0x00, 0x61, 0x00];
        assert_eq!(detect_encoding_inner(&data), "utf-16le");
    }

    #[test]
    fn normalize_variants() {
        assert_eq!(normalize_encoding_inner("UTF-8"), "utf-8");
        assert_eq!(normalize_encoding_inner("Windows-1251"), "windows-1251");
        assert_eq!(normalize_encoding_inner("cp1251"), "windows-1251");
        assert_eq!(normalize_encoding_inner("koi8-r"), "koi8-r");
    }

    #[test]
    fn decode_utf8_plain() {
        let data = "hello".as_bytes();
        assert_eq!(decode_xml_buffer_inner(data), "hello");
    }

    #[test]
    fn decode_windows1251() {
        // 0xC0 = 'А' in windows-1251; need XML declaration for detection.
        let xml = b"<?xml version=\"1.0\" encoding=\"windows-1251\"?><a>\xC0</a>";
        assert_eq!(decode_xml_buffer_inner(xml), "<?xml version=\"1.0\" encoding=\"windows-1251\"?><a>\u{0410}</a>");
    }

    #[test]
    fn zip_signature() {
        assert!(is_zip_buffer_inner(&[0x50, 0x4b, 0x03, 0x04]));
        assert!(!is_zip_buffer_inner(&[0x50, 0x00]));
    }

    #[test]
    fn ext_lowercased() {
        assert_eq!(file_extension_inner("book.EPUB"), "epub");
        assert_eq!(file_extension_inner("noext"), "");
    }
}