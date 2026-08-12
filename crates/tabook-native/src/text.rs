//! Text utilities — Rust port of `src/utils/text.ts`.
//!
//! Pure logic in `pub` functions (testable via `cargo test`).
//! napi exports are thin wrappers, gated by `cfg(not(test))`.

use once_cell::sync::Lazy;
use regex::Regex;

static WIDE_RANGES: Lazy<Vec<(u32, u32)>> = Lazy::new(|| {
    let mut v = vec![
        (0x1100, 0x115f),
        (0x2329, 0x232a),
        (0x2e80, 0x303e),
        (0x3041, 0x33ff),
        (0x3400, 0x4dbf),
        (0x4e00, 0x9fff),
        (0xa000, 0xa4cf),
        (0xa960, 0xa97f),
        (0xac00, 0xd7a3),
        (0xf900, 0xfaff),
        (0xfe10, 0xfe19),
        (0xfe30, 0xfe4f),
        (0xff00, 0xff60),
        (0xffe0, 0xffe6),
        (0x1f300, 0x1f64f),
        (0x1f900, 0x1f9ff),
        (0x20000, 0x2fffd),
        (0x30000, 0x3fffd),
        (0x1b000, 0x1b0ff),
        (0x1f000, 0x1f02f),
        (0x1f0a0, 0x1f0ff),
        (0x1f100, 0x1f1ff),
        (0x2800, 0x28ff),
        (0xa8e0, 0xa8ff),
        (0x1a20, 0x1aad),
        (0x1b00, 0x1b7f),
        (0xa490, 0xa4c6),
    ];
    v.sort_by_key(|&(lo, _)| lo);
    v
});

fn is_wide(code: u32) -> bool {
    WIDE_RANGES
        .binary_search_by(|&(lo, hi)| {
            if code < lo {
                std::cmp::Ordering::Greater
            } else if code > hi {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

pub fn display_width_inner(input: &str) -> i32 {
    let mut width = 0i32;
    for ch in input.chars() {
        width += if is_wide(ch as u32) { 2 } else { 1 };
    }
    width
}

fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => "\u{00a0}",
        "mdash" => "\u{2014}",
        "ndash" => "\u{2013}",
        "hellip" => "\u{2026}",
        "laquo" => "\u{00ab}",
        "raquo" => "\u{00bb}",
        "lsquo" => "\u{2018}",
        "rsquo" => "\u{2019}",
        "ldquo" => "\u{201c}",
        "rdquo" => "\u{201d}",
        "sbquo" => "\u{201a}",
        "bdquo" => "\u{201e}",
        "bull" => "\u{2022}",
        "middot" => "\u{00b7}",
        "copy" => "\u{00a9}",
        "reg" => "\u{00ae}",
        "trade" => "\u{2122}",
        "deg" => "\u{00b0}",
        "plusmn" => "\u{00b1}",
        "euro" => "\u{20ac}",
        "pound" => "\u{00a3}",
        "yen" => "\u{00a5}",
        "sect" => "\u{00a7}",
        "para" => "\u{00b6}",
        "times" => "\u{00d7}",
        "divide" => "\u{00f7}",
        "dagger" => "\u{2020}",
        "Dagger" => "\u{2021}",
        "permil" => "\u{2030}",
        "prime" => "\u{2032}",
        "Prime" => "\u{2033}",
        "lsaquo" => "\u{2039}",
        "rsaquo" => "\u{203a}",
        "minus" => "\u{2212}",
        "infin" => "\u{221e}",
        "ne" => "\u{2260}",
        "le" => "\u{2264}",
        "ge" => "\u{2265}",
        "lowast" => "\u{2217}",
        "weierp" => "\u{2118}",
        "real" => "\u{211c}",
        "part" => "\u{2202}",
        "nabla" => "\u{2207}",
        "sum" => "\u{2211}",
        "prod" => "\u{220f}",
        "radic" => "\u{221a}",
        "prop" => "\u{221d}",
        "ang" => "\u{2220}",
        "and" => "\u{2227}",
        "or" => "\u{2228}",
        "cap" => "\u{2229}",
        "cup" => "\u{222a}",
        "int" => "\u{222b}",
        "sim" => "\u{223c}",
        "cong" => "\u{2245}",
        "asymp" => "\u{2248}",
        "equiv" => "\u{2261}",
        "fnof" => "\u{0192}",
        "alpha" => "\u{03b1}",
        "beta" => "\u{03b2}",
        "gamma" => "\u{03b3}",
        "delta" => "\u{03b4}",
        "epsilon" => "\u{03b5}",
        "zeta" => "\u{03b6}",
        "eta" => "\u{03b7}",
        "theta" => "\u{03b8}",
        "iota" => "\u{03b9}",
        "kappa" => "\u{03ba}",
        "lambda" => "\u{03bb}",
        "mu" => "\u{03bc}",
        "nu" => "\u{03bd}",
        "xi" => "\u{03be}",
        "omicron" => "\u{03bf}",
        "pi" => "\u{03c0}",
        "rho" => "\u{03c1}",
        "sigma" => "\u{03c3}",
        "tau" => "\u{03c4}",
        "upsilon" => "\u{03c5}",
        "phi" => "\u{03c6}",
        "chi" => "\u{03c7}",
        "psi" => "\u{03c8}",
        "omega" => "\u{03c9}",
        "Alpha" => "\u{0391}",
        "Beta" => "\u{0392}",
        "Gamma" => "\u{0393}",
        "Delta" => "\u{0394}",
        "Epsilon" => "\u{0395}",
        "Zeta" => "\u{0396}",
        "Eta" => "\u{0397}",
        "Theta" => "\u{0398}",
        "Iota" => "\u{0399}",
        "Kappa" => "\u{039a}",
        "Lambda" => "\u{039b}",
        "Mu" => "\u{039c}",
        "Nu" => "\u{039d}",
        "Xi" => "\u{039e}",
        "Omicron" => "\u{039f}",
        "Pi" => "\u{03a0}",
        "Rho" => "\u{03a1}",
        "Sigma" => "\u{03a3}",
        "Tau" => "\u{03a4}",
        "Upsilon" => "\u{03a5}",
        "Phi" => "\u{03a6}",
        "Chi" => "\u{03a7}",
        "Psi" => "\u{03a8}",
        "Omega" => "\u{03a9}",
        "spades" => "\u{2660}",
        "clubs" => "\u{2663}",
        "hearts" => "\u{2665}",
        "diams" => "\u{2666}",
        "larr" => "\u{2190}",
        "uarr" => "\u{2191}",
        "rarr" => "\u{2192}",
        "darr" => "\u{2193}",
        "harr" => "\u{2194}",
        "crarr" => "\u{21b5}",
        "lArr" => "\u{21d0}",
        "uArr" => "\u{21d1}",
        "rArr" => "\u{21d2}",
        "dArr" => "\u{21d3}",
        "hArr" => "\u{21d4}",
        "enspace" => "\u{2002}",
        "emspace" => "\u{2003}",
        "thinsp" => "\u{2009}",
        "zwnj" => "\u{200c}",
        "zwj" => "\u{200d}",
        "lrm" => "\u{200e}",
        "rlm" => "\u{200f}",
        _ => return None,
    })
}

fn is_noncharacter(code: u32) -> bool {
    if (code & 0xfffe) == 0xfffe {
        return true;
    }
    (code >= 0xfdd0 && code <= 0xfdef)
        || matches!(
            code,
            0xfffe | 0xffff
                | 0x1fffe | 0x1ffff
                | 0x2fffe | 0x2ffff
                | 0x3fffe | 0x3ffff
                | 0x4fffe | 0x4ffff
                | 0x5fffe | 0x5ffff
                | 0x6fffe | 0x6ffff
                | 0x7fffe | 0x7ffff
                | 0x8fffe | 0x8ffff
                | 0x9fffe | 0x9ffff
                | 0xafffe | 0xaffff
                | 0xbfffe | 0xbffff
                | 0xcfffe | 0xcffff
                | 0xdfffe | 0xdffff
                | 0xefffe | 0xeffff
                | 0x10fffe | 0x10ffff
        )
}

fn safe_code_point(code: u32) -> char {
    if code <= 0x10ffff
        && !(code >= 0xd800 && code <= 0xdfff)
        && !is_noncharacter(code)
    {
        char::from_u32(code).unwrap_or('\u{fffd}')
    } else {
        '\u{fffd}'
    }
}

fn find_byte(haystack: &[u8], needle: u8) -> Option<usize> {
    haystack.iter().position(|&b| b == needle)
}

pub fn decode_entities_standalone(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(semi) = find_byte(&bytes[i..], b';') {
                // semi is the index of ';' within bytes[i..], so the entity
                // body is input[i+1 .. i+semi] (between '&' and ';').
                let inner = &input[i + 1..i + semi];
                if let Some(rest) = inner.strip_prefix("#x").or_else(|| inner.strip_prefix("#X")) {
                    if let Ok(code) = u32::from_str_radix(rest, 16) {
                        out.push(safe_code_point(code));
                        i += semi + 1;
                        continue;
                    }
                } else if let Some(rest) = inner.strip_prefix('#') {
                    if let Ok(code) = rest.parse::<u32>() {
                        out.push(safe_code_point(code));
                        i += semi + 1;
                        continue;
                    }
                } else if let Some(decoded) = named_entity(inner) {
                    out.push_str(decoded);
                    i += semi + 1;
                    continue;
                }
            }
        }
        let ch = input[i..].chars().next().unwrap_or('\u{fffd}');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

pub fn normalize_whitespace_inner(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_space = true;
    for ch in input.chars() {
        if ch.is_whitespace() {
            prev_space = true;
        } else {
            if prev_space && !out.is_empty() {
                out.push(' ');
            }
            out.push(ch);
            prev_space = false;
        }
    }
    out
}

static BR: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<br\s*/?>").unwrap());
static CLOSE_BLOCK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</(p|div|blockquote|h[1-6]|li)>").unwrap());
static LI_OPEN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<li[^>]*>").unwrap());
static BLOCK_OPEN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</?(p|div|blockquote|h[1-6]|ul|ol|hr|tr|table)[^>]*>").unwrap());
static ANY_TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());
static BLANKS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{3,}").unwrap());
static TRAIL_WS: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]+$").unwrap());

pub fn strip_html_inner(html: &str) -> String {
    let s1 = BR.replace_all(html, "\n");
    let s2 = CLOSE_BLOCK.replace_all(&s1, "\n");
    let s3 = LI_OPEN.replace_all(&s2, "\n\u{2022} ");
    let s4 = BLOCK_OPEN.replace_all(&s3, "\n");
    let s5 = ANY_TAG.replace_all(&s4, "");
    let decoded = decode_entities_standalone(&s5);
    let s6 = BLANKS.replace_all(&decoded, "\n\n");
    let s7 = TRAIL_WS.replace_all(&s6, "");
    s7.trim().to_owned()
}

pub fn truncate_inner(input: &str, max_length: usize, suffix: Option<&str>) -> String {
    let suf = suffix.unwrap_or("...");
    let len = input.chars().count();
    if len <= max_length {
        return input.to_owned();
    }
    let suf_len = suf.chars().count();
    if max_length <= suf_len {
        return suf.chars().take(max_length).collect();
    }
    let keep = max_length - suf_len;
    let body: String = input.chars().take(keep).collect();
    format!("{body}{suf}")
}

pub fn truncate_w_inner(text: &str, max: i32) -> String {
    let max = max.max(0);
    if display_width_inner(text) <= max {
        return text.to_owned();
    }
    let mut out = String::new();
    let mut w = 0i32;
    for ch in text.chars() {
        let cw = if is_wide(ch as u32) { 2 } else { 1 };
        if w + cw > max - 1 {
            break;
        }
        out.push(ch);
        w += cw;
    }
    out.push('\u{2026}');
    out
}

pub fn split_chars_inner(input: &str) -> Vec<String> {
    input.chars().map(|c| c.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_width_basic() {
        assert_eq!(display_width_inner("hello"), 5);
        assert_eq!(display_width_inner("こんにちは"), 10);
        assert_eq!(display_width_inner("abc😀"), 5);
    }

    #[test]
    fn display_width_empty() {
        assert_eq!(display_width_inner(""), 0);
    }

    #[test]
    fn decode_basic_entities() {
        assert_eq!(decode_entities_standalone("&amp;"), "&");
        assert_eq!(decode_entities_standalone("&lt;"), "<");
        assert_eq!(decode_entities_standalone("&copy;"), "\u{00a9}");
    }

    #[test]
    fn decode_numeric_entities() {
        assert_eq!(decode_entities_standalone("&#65;"), "A");
        assert_eq!(decode_entities_standalone("&#x41;"), "A");
        assert_eq!(decode_entities_standalone("&#x2014;"), "\u{2014}");
    }

    #[test]
    fn decode_unknown_preserved() {
        assert_eq!(decode_entities_standalone("&unknown;"), "&unknown;");
    }

    #[test]
    fn decode_mixed() {
        assert_eq!(decode_entities_standalone("a&amp;b"), "a&b");
        assert_eq!(
            decode_entities_standalone("&#x48;&#x65;&#x6C;&#x6C;&#x6F;"),
            "Hello"
        );
    }

    #[test]
    fn normalize_whitespace_collapses() {
        assert_eq!(normalize_whitespace_inner("  a   b  "), "a b");
        assert_eq!(normalize_whitespace_inner("\t\tx\n\ty"), "x y");
    }

    #[test]
    fn truncate_basic() {
        assert_eq!(truncate_inner("hello world", 8, None), "hello...");
        assert_eq!(truncate_inner("hi", 10, None), "hi");
    }

    #[test]
    fn truncate_w_wide() {
        assert_eq!(truncate_w_inner("日本語", 4), "日\u{2026}");
    }

    #[test]
    fn split_chars_emoji() {
        let parts = split_chars_inner("a😀b");
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[1], "😀");
    }
}