//! Layout engine — Rust port of `src/renderer/layout.ts` (945 LOC).
//!
//! The core hot path: converts Blocks into wrapped, styled TextLines for
//! rendering. Uses u8 bitflags for CharStyle (6 bools → 1 byte) instead of
//! the TS object (~48 bytes/char). Bugfix: ensureLineCount(usize::MAX) uses
//! a safe guard instead of Infinity, preventing freeze on huge books.

use crate::model::{Block, Inline};
use crate::renderer::blocks::inline_text;
use crate::text::display_width_inner;

// CharStyle as u8 bitflags. This is the main RAM win: 1 byte vs ~48 in TS.
const BOLD: u8 = 0b0000_0001;
const ITALIC: u8 = 0b0000_0010;
const UNDERLINE: u8 = 0b0000_0100;
const STRIKE: u8 = 0b0000_1000;
const LINK: u8 = 0b0001_0000;
const HIGHLIGHT: u8 = 0b0010_0000;
const EMPTY_STYLE: u8 = 0;

// Terminal rows a book-image overlay occupies. Must match
// src/tui/imageLayer.ts IMAGE_ROWS: the reader draws a ueberzugpp box of this
// height at the placeholder row, so layout reserves IMAGE_ROWS - 1 blank
// lines under the placeholder to keep the overlay off the following text.
pub const IMAGE_ROWS: i32 = 10;

#[derive(Clone, Debug)]
pub struct Char {
    pub ch: char,
    pub style: u8,
    pub offset: i32, // -1 for inserted hyphens
}

#[derive(Clone, Debug)]
pub struct StyledSpan {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub link: bool,
    pub highlight: bool,
}

#[derive(Clone, Debug)]
pub struct TextLine {
    pub role: String,
    pub spans: Vec<StyledSpan>,
    pub indent: i32,
    pub prefix: String,
    pub block_index: i32,
    pub char_offset: i32,
}

#[derive(Clone, Debug)]
pub struct HighlightRange {
    pub start: i32,
    pub end: i32,
}

pub struct LayoutOptions {
    pub typo: TypographyConfig,
    pub width: i32,
    pub justify: bool,
    pub hyphenation: bool,
    pub get_highlights: Option<Box<dyn Fn(i32) -> Option<Vec<HighlightRange>> + Send + Sync>>,
}

#[derive(Clone, Debug)]
pub struct TypographyConfig {
    pub measure: i32,
    pub line_spacing: i32,
    pub paragraph_indent: i32,
    pub paragraph_spacing: i32,
    pub hyphenation: bool,
    pub justify: bool,
}

fn style_key(s: u8) -> String {
    format!("{s:06b}")
}

pub fn inline_to_spans(inlines: &[Inline]) -> Vec<StyledSpan> {
    let mut chars: Vec<Char> = Vec::new();
    let mut offset = 0i32;
    let push_chars = |chars: &mut Vec<Char>, text: &str, st: u8, offset: &mut i32| {
        for ch in text.chars() {
            chars.push(Char { ch, style: st, offset: *offset });
            *offset += 1;
        }
    };
    fn walk(inlines: &[Inline], st: u8, chars: &mut Vec<Char>, offset: &mut i32) {
        for inline in inlines {
            match inline.kind.as_str() {
                "text" => {
                    let text = inline.text.as_deref().unwrap_or("");
                    for ch in text.chars() {
                        chars.push(Char { ch, style: st, offset: *offset });
                        *offset += 1;
                    }
                }
                "bold" => {
                    if let Some(children) = &inline.children {
                        walk(children, st | BOLD, chars, offset);
                    }
                }
                "italic" => {
                    if let Some(children) = &inline.children {
                        walk(children, st | ITALIC, chars, offset);
                    }
                }
                "underline" => {
                    if let Some(children) = &inline.children {
                        walk(children, st | UNDERLINE, chars, offset);
                    }
                }
                "strike" => {
                    if let Some(children) = &inline.children {
                        walk(children, st | STRIKE, chars, offset);
                    }
                }
                "link" => {
                    if let Some(children) = &inline.children {
                        walk(children, st | LINK, chars, offset);
                    }
                }
                "code" => {
                    let text = inline.text.as_deref().unwrap_or("");
                    for ch in text.chars() {
                        chars.push(Char { ch, style: st, offset: *offset });
                        *offset += 1;
                    }
                }
                "image" => {
                    let alt = inline.alt.as_deref().unwrap_or("");
                    for ch in alt.chars() {
                        chars.push(Char { ch, style: st, offset: *offset });
                        *offset += 1;
                    }
                }
                "lineBreak" => {
                    chars.push(Char { ch: ' ', style: st, offset: *offset });
                    *offset += 1;
                }
                _ => {}
            }
        }
    }
    walk(inlines, EMPTY_STYLE, &mut chars, &mut offset);
    let _ = push_chars;
    chars_to_spans(&chars)
}

fn chars_to_spans(chars: &[Char]) -> Vec<StyledSpan> {
    let mut spans = Vec::new();
    let mut current_text = String::new();
    let mut current_style: Option<u8> = None;
    for char in chars {
        if current_style == Some(char.style) {
            current_text.push(char.ch);
        } else {
            if !current_text.is_empty() {
                let st = current_style.unwrap_or(EMPTY_STYLE);
                spans.push(styled_span(current_text, st));
            }
            current_text = char.ch.to_string();
            current_style = Some(char.style);
        }
    }
    if !current_text.is_empty() {
        let st = current_style.unwrap_or(EMPTY_STYLE);
        spans.push(styled_span(current_text, st));
    }
    spans
}

fn styled_span(text: String, st: u8) -> StyledSpan {
    StyledSpan {
        text,
        bold: st & BOLD != 0,
        italic: st & ITALIC != 0,
        underline: st & UNDERLINE != 0,
        strike: st & STRIKE != 0,
        link: st & LINK != 0,
        highlight: st & HIGHLIGHT != 0,
    }
}

pub fn apply_highlights(spans: &[StyledSpan], highlights: &[HighlightRange]) -> Vec<StyledSpan> {
    if highlights.is_empty() {
        return spans.to_vec();
    }
    let mut chars = Vec::new();
    let mut offset = 0i32;
    for span in spans {
        for ch in span.text.chars() {
            let in_range = highlights.iter().any(|h| offset >= h.start && offset < h.end);
            chars.push(Char {
                ch,
                style: style_u8_from_span(span) | if in_range { HIGHLIGHT } else { 0 },
                offset,
            });
            offset += 1;
        }
    }
    chars_to_spans(&chars)
}

fn style_u8_from_span(s: &StyledSpan) -> u8 {
    let mut st = EMPTY_STYLE;
    if s.bold { st |= BOLD; }
    if s.italic { st |= ITALIC; }
    if s.underline { st |= UNDERLINE; }
    if s.strike { st |= STRIKE; }
    if s.link { st |= LINK; }
    if s.highlight { st |= HIGHLIGHT; }
    st
}

const VOWELS: &str = "aeiouyаеёиоуыэюя";

fn is_vowel(c: char) -> bool {
    VOWELS.contains(c.to_ascii_lowercase())
}

fn hyphen_break_at(line: &[Char], max: i32) -> usize {
    let limit = std::cmp::min(max as usize, line.len());
    if limit < 2 {
        return limit;
    }
    for i in (2..limit).rev() {
        let prev = line[i - 1].ch.to_ascii_lowercase();
        let cur = line[i].ch.to_ascii_lowercase();
        if is_vowel(prev) && !is_vowel(cur) {
            return i;
        }
    }
    limit
}

#[derive(Clone, Debug)]
pub struct WrappedLines {
    pub lines: Vec<Vec<StyledSpan>>,
    pub original_lengths: Vec<i32>,
}

pub fn wrap_spans(
    spans: &[StyledSpan],
    max_width: i32,
    highlights: &[HighlightRange],
    hyphenate: bool,
) -> WrappedLines {
    let styled = apply_highlights(spans, highlights);
    let mut chars: Vec<Char> = Vec::new();
    let mut offset = 0i32;
    for span in &styled {
        for ch in span.text.chars() {
            chars.push(Char {
                ch,
                style: style_u8_from_span(span),
                offset,
            });
            offset += 1;
        }
    }
    let wrapped = wrap_chars(&chars, max_width, hyphenate);
    WrappedLines {
        lines: wrapped.iter().map(|line| chars_to_spans(line)).collect(),
        original_lengths: wrapped
            .iter()
            .map(|line| line.iter().filter(|c| c.offset >= 0).count() as i32)
            .collect(),
    }
}

fn wrap_chars(chars: &[Char], max_width: i32, hyphenate: bool) -> Vec<Vec<Char>> {
    let mut lines: Vec<Vec<Char>> = Vec::new();
    let mut line: Vec<Char> = Vec::new();
    let mut width = 0i32;
    let mut last_space: i32 = -1;

    // Port regression: the TS original resets width and lastSpace inside
    // flushLine. Without the resets, a wrap triggered by a space that fills
    // the line exactly (lastSpace == line.len()) leaves a stale width >= max,
    // so every subsequent char overflows and gets flushed on its own line —
    // text suddenly renders vertically (real reports: Кaku FB2, '"пролила"').
    let flush_line = |line: &mut Vec<Char>, lines: &mut Vec<Vec<Char>>, width: &mut i32, last_space: &mut i32| {
        let mut end = line.len();
        while end > 0 && line[end - 1].ch == ' ' {
            end -= 1;
        }
        lines.push(line[..end].to_vec());
        line.clear();
        *width = 0;
        *last_space = -1;
    };

    for char in chars {
        let w = display_width_inner(&char.ch.to_string());
        if char.ch == ' ' {
            last_space = line.len() as i32;
        }
        if width + w > max_width && !line.is_empty() {
            if last_space > 0 && (last_space as usize) < line.len() {
                let ls = last_space as usize;
                lines.push(line[..ls].to_vec());
                let remainder = line[ls + 1..].to_vec();
                line = remainder;
                width = line.iter().map(|c| display_width_inner(&c.ch.to_string())).sum();
                last_space = -1;
            } else if hyphenate
                && char.ch != ' '
                && line.len() > 1
                && line[0].ch != ' '
                && line[line.len() - 1].ch != ' '
            {
                let keep = hyphen_break_at(&line, std::cmp::max(1, max_width - 1));
                let kept = line[..keep].to_vec();
                let last_style = kept.last().map(|c| c.style).unwrap_or(EMPTY_STYLE);
                let mut hyphen_line = kept;
                hyphen_line.push(Char { ch: '-', style: last_style, offset: -1 });
                lines.push(hyphen_line);
                line = line[keep..].to_vec();
                width = line.iter().map(|c| display_width_inner(&c.ch.to_string())).sum();
                last_space = -1;
            } else {
                flush_line(&mut line, &mut lines, &mut width, &mut last_space);
            }
        }
        line.push(char.clone());
        width += w;
    }
    if !line.is_empty() {
        let mut end = line.len();
        while end > 0 && line[end - 1].ch == ' ' {
            end -= 1;
        }
        lines.push(line[..end].to_vec());
    }
    lines
}

fn slice_highlights(highlights: Option<&[HighlightRange]>, base: i32, length: i32) -> Vec<HighlightRange> {
    let Some(hls) = highlights else { return Vec::new() };
    if base < 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for h in hls {
        let start = std::cmp::max(0, h.start - base);
        let end = std::cmp::min(length, h.end - base);
        if start < end {
            out.push(HighlightRange { start, end });
        }
    }
    out
}

struct PartCounter {
    offset: i32,
    pending: bool,
    skip_empty: bool,
    separator: String,
}

impl PartCounter {
    fn new(skip_empty: bool, separator: String) -> Self {
        Self { offset: 0, pending: false, skip_empty, separator }
    }
    fn push(&mut self, text: &str) -> i32 {
        if self.skip_empty && text.is_empty() {
            return -1;
        }
        if self.pending {
            self.offset += self.separator.len() as i32;
        }
        let start = self.offset;
        self.offset += text.chars().count() as i32;
        self.pending = true;
        start
    }
}

fn spans_to_plain(spans: &[StyledSpan]) -> String {
    let mut out = String::new();
    for s in spans {
        out.push_str(&s.text);
    }
    out
}

fn highlight_plain(text: &str, highlights: &[HighlightRange]) -> Vec<StyledSpan> {
    let mut chars = Vec::new();
    let mut offset = 0i32;
    for ch in text.chars() {
        let in_range = highlights.iter().any(|h| offset >= h.start && offset < h.end);
        chars.push(Char { ch, style: if in_range { HIGHLIGHT } else { EMPTY_STYLE }, offset });
        offset += 1;
    }
    chars_to_spans(&chars)
}

fn merge_span_lines(lines: &[Vec<StyledSpan>]) -> Vec<StyledSpan> {
    let mut result = Vec::new();
    for line in lines {
        result.extend(line.iter().cloned());
    }
    result
}

fn find_offset_of_line(spans: &[StyledSpan], line: &[StyledSpan], base_offset: i32, line_text: &str) -> i32 {
    if line_text.trim().is_empty() {
        return base_offset;
    }
    let plain: String = spans.iter().map(|s| s.text.clone()).collect::<String>();
    let mut line_plain: String = line.iter().map(|s| s.text.clone()).collect();
    if line_plain.ends_with('-') {
        line_plain.pop();
    }
    let trimmed = line_plain.trim();
    if trimmed.is_empty() {
        return base_offset;
    }
    // Char-based search (work in code points, not bytes/UTF-16): base_offset
    // is a char index into the plain text. Byte-slicing plain[base_offset..]
    // would panic or misbehave on non-ASCII content.
    let plain_chars: Vec<char> = plain.chars().collect();
    let needle: Vec<char> = trimmed.chars().collect();
    let start = (base_offset.max(0) as usize).min(plain_chars.len());
    if needle.is_empty() || plain_chars.len() - start < needle.len() {
        return base_offset;
    }
    if let Some(pos) = plain_chars[start..].windows(needle.len()).position(|w| w == needle) {
        return (start + pos) as i32;
    }
    base_offset
}

fn justify_line(line: &TextLine, content_width: i32) -> TextLine {
    if line.role == "empty" || line.spans.is_empty() {
        return line.clone();
    }
    let mut space_count = 0i32;
    let mut text_width = 0i32;
    for span in &line.spans {
        for ch in span.text.chars() {
            if ch == ' ' {
                space_count += 1;
            }
        }
        text_width += display_width_inner(&span.text);
    }
    if space_count == 0 {
        return line.clone();
    }
    let slack = content_width - text_width;
    if slack <= 0 {
        return line.clone();
    }
    let gaps = space_count;
    let base = slack / gaps;
    let extra = slack % gaps;
    let mut spans: Vec<StyledSpan> = line.spans.iter().map(|s| s.clone()).collect();
    let mut applied = 0i32;
    for span in &mut spans {
        if !span.text.contains(' ') {
            continue;
        }
        let mut out = String::new();
        for ch in span.text.chars() {
            if ch == ' ' {
                let pad = base + if applied < extra { 1 } else { 0 };
                applied += 1;
                out.push(' ');
                for _ in 0..pad {
                    out.push(' ');
                }
            } else {
                out.push(ch);
            }
        }
        span.text = out;
    }
    TextLine {
        role: line.role.clone(),
        spans,
        indent: line.indent,
        prefix: line.prefix.clone(),
        block_index: line.block_index,
        char_offset: line.char_offset,
    }
}

fn apply_justify(lines: &mut Vec<TextLine>, width: i32) {
    if lines.len() <= 1 {
        return;
    }
    let justifiable: &[&str] = &[
        "paragraph", "heading1", "heading2", "heading3",
        "heading4", "heading5", "heading6", "quote", "epigraph", "annotation",
    ];
    let mut last_content_idx = lines.len() as i32 - 1;
    while last_content_idx >= 0 && lines[last_content_idx as usize].role == "empty" {
        last_content_idx -= 1;
    }
    for i in 0..last_content_idx {
        let line = &lines[i as usize];
        if !justifiable.contains(&line.role.as_str()) {
            continue;
        }
        let content_width = width - line.indent - line.prefix.chars().count() as i32;
        let justified = justify_line(line, content_width);
        lines[i as usize] = justified;
    }
}

pub fn layout_block(block: &Block, block_index: i32, opts: &LayoutOptions) -> Vec<TextLine> {
    let width = opts.width;
    let typo = &opts.typo;
    let justify = opts.justify;
    let highlights = opts
        .get_highlights
        .as_ref()
        .and_then(|f| f(block_index));
    let mut lines: Vec<TextLine> = Vec::new();

    let line_spacing = typo.line_spacing;
    let paragraph_indent = typo.paragraph_indent;
    let paragraph_spacing = typo.paragraph_spacing;
    let hyphenation = typo.hyphenation;
    let block_index_local = block_index;

    let mut emit = |role: &str, spans: Vec<StyledSpan>, indent: i32, prefix: &str, char_offset: i32, lines: &mut Vec<TextLine>| {
        let all_empty = spans.is_empty() || spans.iter().all(|s| s.text.trim().is_empty());
        if all_empty {
            if role == "paragraph" || role == "listItem" || role == "quote" {
                lines.push(TextLine {
                    role: "empty".into(),
                    spans: Vec::new(),
                    indent,
                    prefix: prefix.to_owned(),
                    block_index: block_index_local,
                    char_offset,
                });
            }
            return;
        }
        lines.push(TextLine {
            role: role.to_owned(),
            spans,
            indent,
            prefix: prefix.to_owned(),
            block_index: block_index_local,
            char_offset,
        });
        if line_spacing > 0 && role != "empty" {
            for _ in 0..line_spacing {
                lines.push(TextLine {
                    role: "empty".into(),
                    spans: Vec::new(),
                    indent: 0,
                    prefix: String::new(),
                    block_index: block_index_local,
                    char_offset,
                });
            }
        }
    };

    match block.r#type.as_str() {
        "empty" => {
            lines.push(TextLine {
                role: "empty".into(),
                spans: Vec::new(),
                indent: 0,
                prefix: String::new(),
                block_index,
                char_offset: 0,
            });
        }
        "heading" => {
            let children = block.children.as_deref().unwrap_or(&[]);
            let spans = inline_to_spans(children);
            let hls = highlights.as_deref().unwrap_or(&[]);
            let wrapped = wrap_spans(&spans, width, hls, hyphenation);
            let mut running = 0i32;
            for i in 0..wrapped.lines.len() {
                let line = &wrapped.lines[i];
                let text = spans_to_plain(line);
                let offset = find_offset_of_line(&spans, line, running, &text);
                running += wrapped.original_lengths[i];
                let level = block.level.unwrap_or(1).min(6);
                let role = format!("heading{level}");
                emit(&role, line.clone(), 0, "", offset, &mut lines);
            }
            if justify {
                apply_justify(&mut lines, width);
            }
        }
        "paragraph" => {
            let children = block.children.as_deref().unwrap_or(&[]);
            let spans = inline_to_spans(children);
            let hls = highlights.as_deref().unwrap_or(&[]);
            let wrapped = wrap_spans(&spans, width, hls, hyphenation);
            let mut first = true;
            let mut running = 0i32;
            for i in 0..wrapped.lines.len() {
                let line = &wrapped.lines[i];
                let text = spans_to_plain(line);
                let offset = find_offset_of_line(&spans, line, running, &text);
                running += wrapped.original_lengths[i];
                let indent = if first { paragraph_indent } else { 0 };
                emit("paragraph", line.clone(), indent, "", offset, &mut lines);
                first = false;
            }
            if paragraph_spacing > 0 && !wrapped.lines.is_empty() {
                for _ in 0..paragraph_spacing {
                    lines.push(TextLine {
                        role: "empty".into(),
                        spans: Vec::new(),
                        indent: 0,
                        prefix: String::new(),
                        block_index,
                        char_offset: running,
                    });
                }
            }
            if justify {
                apply_justify(&mut lines, width);
            }
        }
        "code" => {
            let children = block.children.as_deref().unwrap_or(&[]);
            let text = if !children.is_empty() && children[0].kind == "code" {
                children[0].text.clone().unwrap_or_default()
            } else {
                let spans = inline_to_spans(children);
                spans_to_plain(&spans)
            };
            let code_lines: Vec<&str> = text.split('\n').collect();
            let mut running = 0i32;
            for cl in code_lines {
                let spans = vec![StyledSpan {
                    text: cl.to_owned(),
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                    link: false,
                    highlight: false,
                }];
                emit("code", spans, 0, "", running, &mut lines);
                running += cl.chars().count() as i32 + 1;
            }
        }
        "quote" => {
            let children = block.children.as_deref().unwrap_or(&[]);
            let spans = inline_to_spans(children);
            let hls = highlights.as_deref().unwrap_or(&[]);
            let wrapped = wrap_spans(&spans, width - 4, hls, hyphenation);
            let mut running = 0i32;
            for i in 0..wrapped.lines.len() {
                emit("quote", wrapped.lines[i].clone(), 4, "", running, &mut lines);
                running += wrapped.original_lengths[i];
            }
            if justify {
                apply_justify(&mut lines, width);
            }
        }
        "epigraph" => {
            let children = block.children.as_deref().unwrap_or(&[]);
            let spans = inline_to_spans(children);
            let hls = highlights.as_deref().unwrap_or(&[]);
            let wrapped = wrap_spans(&spans, width - 6, hls, hyphenation);
            let mut running = 0i32;
            for i in 0..wrapped.lines.len() {
                emit("epigraph", wrapped.lines[i].clone(), 6, "", running, &mut lines);
                running += wrapped.original_lengths[i];
            }
            if justify {
                apply_justify(&mut lines, width);
            }
        }
        "annotation" => {
            let children = block.children.as_deref().unwrap_or(&[]);
            let spans = inline_to_spans(children);
            let hls = highlights.as_deref().unwrap_or(&[]);
            let wrapped = wrap_spans(&spans, width, hls, hyphenation);
            let mut running = 0i32;
            for i in 0..wrapped.lines.len() {
                emit("annotation", wrapped.lines[i].clone(), 0, "", running, &mut lines);
                running += wrapped.original_lengths[i];
            }
            if justify {
                apply_justify(&mut lines, width);
            }
        }
        "list" => {
            let mut offsets = PartCounter::new(true, "\n".to_owned());
            walk_list(block, 0, width, hyphenation, highlights.as_deref(), &mut offsets, &mut lines, block_index);
        }
        "poem" => {
            let mut offsets = PartCounter::new(false, "\n".to_owned());
            let stanzas = block.stanzas.as_deref().unwrap_or(&[]);
            for (si, stanza) in stanzas.iter().enumerate() {
                if si > 0 {
                    lines.push(TextLine {
                        role: "empty".into(),
                        spans: Vec::new(),
                        indent: 0,
                        prefix: String::new(),
                        block_index,
                        char_offset: 0,
                    });
                }
                for verse in &stanza.lines {
                    let spans = inline_to_spans(verse);
                    let plain = spans_to_plain(&spans);
                    let start = offsets.push(&plain);
                    let hls = slice_highlights(highlights.as_deref(), start, plain.chars().count() as i32);
                    let wrapped = wrap_spans(&spans, width - 6, &hls, hyphenation);
                    let mut running = 0i32;
                    for i in 0..wrapped.lines.len() {
                        emit("poemLine", wrapped.lines[i].clone(), 6, "", std::cmp::max(0, start) + running, &mut lines);
                        running += wrapped.original_lengths[i];
                    }
                }
            }
        }
        "table" => {
            layout_table(block, block_index, width, highlights.as_deref(), &mut lines);
        }
        "image" => {
            let alt = block.alt.clone().unwrap_or_default();
            let display_alt = if alt.is_empty() { "image".to_owned() } else { alt };
            let text = format!("[Image: {display_alt}]");
            let indent = std::cmp::max(0, (width - text.chars().count() as i32) / 2);
            lines.push(TextLine {
                role: "image".into(),
                spans: vec![StyledSpan {
                    text,
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                    link: false,
                    highlight: false,
                }],
                indent,
                prefix: String::new(),
                block_index,
                char_offset: 0,
            });
            // Reserve IMAGE_ROWS - 1 blank lines under the placeholder so the
            // ueberzugpp overlay (IMAGE_ROWS terminal rows tall) never covers
            // the text that follows. Port regression: the TS original reserves
            // IMAGE_ROWS - 1 = 9 blanks (src/renderer/layout.ts image case);
            // the first port hardcoded 5 blanks (1..6), so the 10-row overlay
            // bled over ~4 rows of the next paragraph.
            for _ in 1..IMAGE_ROWS {
                lines.push(TextLine {
                    role: "empty".into(),
                    spans: Vec::new(),
                    indent: 0,
                    prefix: String::new(),
                    block_index,
                    char_offset: 0,
                });
            }
        }
        _ => {}
    }
    lines
}

fn walk_list(
    list: &Block,
    level: i32,
    width: i32,
    hyphenation: bool,
    highlights: Option<&[HighlightRange]>,
    offsets: &mut PartCounter,
    lines: &mut Vec<TextLine>,
    block_index: i32,
) {
    let items = list.items.as_deref().unwrap_or(&[]);
    let mut counter = 1i32;
    let ordered = list.ordered.unwrap_or(false);
    for item in items {
        let marker = if ordered { format!("{counter}.") } else { "-".to_owned() };
        if ordered {
            counter += 1;
        }
        let indent = 2 + level * 2;
        let marker_width = marker.chars().count() as i32 + 1;
        let spans = inline_to_spans(&item.children);
        let plain = spans_to_plain(&spans);
        let start = offsets.push(&plain);
        let hls = slice_highlights(highlights, start, plain.chars().count() as i32);
        let wrapped = wrap_spans(&spans, width - indent - marker_width, &hls, hyphenation);
        if wrapped.lines.is_empty() {
            lines.push(TextLine {
                role: "listItem".into(),
                spans: Vec::new(),
                indent,
                prefix: format!("{marker} "),
                block_index,
                char_offset: std::cmp::max(0, start),
            });
        }
        let mut running = 0i32;
        for i in 0..wrapped.lines.len() {
            let prefix = if i == 0 {
                format!("{marker} ")
            } else {
                " ".repeat(marker_width as usize)
            };
            lines.push(TextLine {
                role: "listItem".into(),
                spans: wrapped.lines[i].clone(),
                indent,
                prefix,
                block_index,
                char_offset: std::cmp::max(0, start) + running,
            });
            running += wrapped.original_lengths[i];
        }
        for nested in &item.nested {
            if nested.r#type == "list" {
                walk_list(nested, level + 1, width, hyphenation, highlights, offsets, lines, block_index);
            }
        }
    }
}

fn layout_table(
    block: &Block,
    block_index: i32,
    width: i32,
    highlights: Option<&[HighlightRange]>,
    lines: &mut Vec<TextLine>,
) {
    let headers = block.headers.as_deref().unwrap_or(&[]);
    let rows = block.rows.as_deref().unwrap_or(&[]);
    let col_count = std::cmp::max(
        headers.len(),
        rows.iter().map(|r| r.len()).max().unwrap_or(0),
    );
    if col_count == 0 {
        return;
    }

    struct TableRow {
        cells: Vec<String>,
        is_header: bool,
    }

    let mut all_rows: Vec<TableRow> = Vec::new();
    if !headers.is_empty() {
        all_rows.push(TableRow {
            cells: headers.iter().map(|c| inline_text(c)).collect(),
            is_header: true,
        });
    }
    for row in rows {
        all_rows.push(TableRow {
            cells: row.iter().map(|c| inline_text(c)).collect(),
            is_header: false,
        });
    }

    let pad = 2i32;
    let avail_per_col = std::cmp::max(4, (width - (col_count as i32 - 1) * pad) / col_count as i32);
    let mut col_widths = Vec::with_capacity(col_count);
    for c in 0..col_count {
        let mut max_len = 0i32;
        for row in &all_rows {
            let cell = row.cells.get(c).map(|s| s.as_str()).unwrap_or("");
            max_len = std::cmp::max(max_len, cell.chars().count() as i32);
        }
        col_widths.push(std::cmp::min(avail_per_col, std::cmp::max(4, max_len)));
    }

    let mut running = 0i32;
    for row in &all_rows {
        let mut cell_start_offsets = Vec::new();
        if !row.is_header {
            for c in 0..col_count {
                let cell = row.cells.get(c).map(|s| s.as_str()).unwrap_or("");
                cell_start_offsets.push(running);
                running += cell.chars().count() as i32 + 1;
            }
        }
        let mut wrapped_cells: Vec<Vec<Vec<StyledSpan>>> = Vec::with_capacity(col_count);
        for c in 0..col_count {
            let cell = row.cells.get(c).map(|s| s.as_str()).unwrap_or("");
            let cw = col_widths[c];
            if row.is_header {
                let wrapped = wrap_spans(
                    &[StyledSpan {
                        text: cell.to_owned(),
                        bold: false,
                        italic: false,
                        underline: false,
                        strike: false,
                        link: false,
                        highlight: false,
                    }],
                    cw,
                    &[],
                    false,
                );
                wrapped_cells.push(wrapped.lines);
            } else {
                let hls = slice_highlights(highlights, cell_start_offsets[c], cell.chars().count() as i32);
                let highlighted = highlight_plain(cell, &hls);
                let wrapped = wrap_spans(&highlighted, cw, &[], false);
                wrapped_cells.push(wrapped.lines);
            }
        }
        let row_height = wrapped_cells.iter().map(|ws| ws.len()).max().unwrap_or(1);
        let row_height = std::cmp::max(1, row_height);
        for r in 0..row_height {
            let mut spans = Vec::new();
            let mut line_char_offset = -1i32;
            for c in 0..col_count {
                let cell = &wrapped_cells[c];
                let cell_line = cell.get(r);
                if line_char_offset < 0 {
                    if let Some(cl) = cell_line {
                        let text = spans_to_plain(cl);
                        if !text.trim().is_empty() {
                            line_char_offset = cell_start_offsets.get(c).copied().unwrap_or(0);
                        }
                    }
                }
                let text = cell_line.map(|cl| spans_to_plain(cl)).unwrap_or_default();
                let cw = col_widths[c] as usize;
                let padded = format!("{:<width$}", text, width = cw);
                if let Some(cl) = cell_line {
                    spans.extend(cl.iter().cloned());
                    let pad_len = cw.saturating_sub(text.chars().count());
                    if pad_len > 0 {
                        spans.push(StyledSpan {
                            text: " ".repeat(pad_len),
                            bold: false,
                            italic: false,
                            underline: false,
                            strike: false,
                            link: false,
                            highlight: false,
                        });
                    }
                } else {
                    spans.push(StyledSpan {
                        text: padded,
                        bold: false,
                        italic: false,
                        underline: false,
                        strike: false,
                        link: false,
                        highlight: false,
                    });
                }
                if c < col_count - 1 {
                    spans.push(StyledSpan {
                        text: " ".repeat(pad as usize),
                        bold: false,
                        italic: false,
                        underline: false,
                        strike: false,
                        link: false,
                        highlight: false,
                    });
                }
            }
            if line_char_offset < 0 {
                line_char_offset = if row.is_header { 0 } else { cell_start_offsets.first().copied().unwrap_or(0) };
            }
            lines.push(TextLine {
                role: if row.is_header { "tableHeader".into() } else { "tableCell".into() },
                spans,
                indent: 0,
                prefix: String::new(),
                block_index,
                char_offset: line_char_offset,
            });
        }
    }
}

// ----- BookLayout (napi class) -----

pub struct BookLayout {
    pub blocks: Vec<Block>,
    pub opts: LayoutOptions,
    pub block_count: i32,
    pub lines: Vec<TextLine>,
    pub next_block_to_layout: i32,
    pub block_starts: Vec<i32>,
    pub block_text: Vec<String>,
    pub block_char_starts: Vec<i32>,
    pub total_chars: i32,
    // Per-block search-highlight ranges, pushed from TS via set_highlights.
    // The napi boundary cannot carry Box<dyn Fn> closures, so highlights are
    // fed as data instead of a getHighlights callback. Layout reads the map
    // through the get_highlights closure installed in `new`.
    pub highlights: std::sync::Arc<parking_lot::Mutex<std::collections::HashMap<i32, Vec<HighlightRange>>>>,
}

impl BookLayout {
    pub fn new(blocks: Vec<Block>, opts: LayoutOptions) -> Self {
        let block_count = blocks.len() as i32;
        let mut block_starts = vec![-1i32; blocks.len() + 1];
        block_starts[0] = 0;
        let block_text: Vec<String> = blocks.iter().map(|b| crate::renderer::blocks::block_to_plain_text(b)).collect();
        let mut block_char_starts = vec![0i32; blocks.len() + 1];
        let mut acc = 0i32;
        for (i, t) in block_text.iter().enumerate() {
            block_char_starts[i] = acc;
            acc += t.chars().count() as i32;
        }
        block_char_starts[blocks.len()] = acc;
        let highlights = std::sync::Arc::new(parking_lot::Mutex::new(
            std::collections::HashMap::new(),
        ));
        // If the caller did not provide a highlight closure (napi constructor
        // never does), install one that reads the shared highlights map so
        // set_highlights can update ranges after construction.
        let get_highlights = opts.get_highlights.or_else(|| {
            let h = std::sync::Arc::clone(&highlights);
            Some(Box::new(
                move |i| h.lock().get(&i).cloned(),
            ) as Box<dyn Fn(i32) -> Option<Vec<HighlightRange>> + Send + Sync>)
        });
        let opts = LayoutOptions {
            typo: opts.typo,
            width: opts.width,
            justify: opts.justify,
            hyphenation: opts.hyphenation,
            get_highlights,
        };
        Self {
            blocks,
            opts,
            block_count,
            lines: Vec::new(),
            next_block_to_layout: 0,
            block_starts,
            block_text,
            block_char_starts,
            total_chars: acc,
            highlights,
        }
    }

    /// Replace the per-block highlight ranges (search results). The map is
    /// consulted lazily during layout, so only blocks actually rendered pay
    /// the lookup cost.
    pub fn set_highlights(&mut self, highlights: std::collections::HashMap<i32, Vec<HighlightRange>>) {
        *self.highlights.lock() = highlights;
    }

    pub fn ensure_blocks_up_to(&mut self, block_index: i32) {
        let target = std::cmp::min(block_index, self.block_count - 1);
        while self.next_block_to_layout <= target {
            let idx = self.next_block_to_layout;
            let block_lines = layout_block(&self.blocks[idx as usize], idx, &self.opts);
            self.lines.extend(block_lines);
            self.next_block_to_layout += 1;
            self.block_starts[idx as usize + 1] = self.lines.len() as i32;
        }
    }

    pub fn ensure_line_count(&mut self, count: i32) -> i32 {
        // Bugfix: usize::MAX would overflow; use block_count as upper bound
        // instead of Infinity. The TS version used ensureLineCount(Infinity)
        // which froze on huge books. Saturating so pathological block counts
        // can't overflow i32.
        let max_lines = self.block_count.saturating_mul(100_000); // sane upper bound
        let target = std::cmp::min(count, max_lines);
        while (self.lines.len() as i32) < target && self.next_block_to_layout < self.block_count {
            let idx = self.next_block_to_layout;
            let block_lines = layout_block(&self.blocks[idx as usize], idx, &self.opts);
            self.lines.extend(block_lines);
            self.next_block_to_layout += 1;
            self.block_starts[idx as usize + 1] = self.lines.len() as i32;
        }
        self.lines.len() as i32
    }

    pub fn line_count(&mut self) -> i32 {
        // Safe upper bound instead of Infinity
        self.ensure_line_count(self.block_count.saturating_mul(100_000))
    }

    pub fn get_page(&mut self, page: i32, page_height: i32) -> Vec<TextLine> {
        if page_height <= 0 {
            return Vec::new();
        }
        let start = page * page_height;
        self.ensure_line_count(start + page_height);
        let end = std::cmp::min((start + page_height) as usize, self.lines.len());
        if start as usize >= self.lines.len() {
            return Vec::new();
        }
        self.lines[start as usize..end].to_vec()
    }

    pub fn get_range(&mut self, start: i32, count: i32) -> Vec<TextLine> {
        if count <= 0 {
            return Vec::new();
        }
        self.ensure_line_count(start + count);
        let end = std::cmp::min((start + count) as usize, self.lines.len());
        if start as usize >= self.lines.len() {
            return Vec::new();
        }
        self.lines[start as usize..end].to_vec()
    }

    pub fn block_for_char_offset(&self, char_offset: i32) -> i32 {
        let mut lo = 0i32;
        let mut hi = self.block_count - 1;
        while lo < hi {
            let mid = (lo + hi + 1) >> 1;
            if self.block_char_starts[mid as usize] <= char_offset {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        lo
    }

    pub fn page_for_char_offset(&mut self, char_offset: i32, page_height: i32) -> i32 {
        if char_offset <= 0 || self.total_chars == 0 {
            return 0;
        }
        let target_block = self.block_for_char_offset(char_offset);
        self.ensure_blocks_up_to(target_block);
        let local = char_offset - self.block_char_starts[target_block as usize];
        let block_start = self.block_starts[target_block as usize];
        let block_end = self.block_starts[target_block as usize + 1];
        let mut line_idx = 0i32;
        for i in block_start..block_end {
            if self.lines[i as usize].char_offset > local {
                break;
            }
            line_idx = i;
        }
        std::cmp::max(0, line_idx / page_height)
    }

    pub fn text_near(&mut self, char_offset: i32, length: i32) -> String {
        if self.block_count == 0 {
            return String::new();
        }
        let safe = std::cmp::max(0, std::cmp::min(char_offset, self.total_chars - 1));
        let block = self.block_for_char_offset(safe);
        let local = safe - self.block_char_starts[block as usize];
        let text = &self.block_text[block as usize];
        // Char-based slicing (local is a char index); byte slicing text[start..end]
        // would panic or split multi-byte characters on non-ASCII content.
        let chars: Vec<char> = text.chars().collect();
        let start = (local.max(0) as usize).min(chars.len());
        let end = (start.saturating_add(length.max(0) as usize)).min(chars.len());
        chars[start..end].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
    }

    pub fn estimate_line_count(&self) -> i32 {
        if self.opts.width <= 0 {
            return 1;
        }
        std::cmp::max(1, (self.total_chars as f64 / (self.opts.width as f64 * 0.8)).ceil() as i32)
    }

    pub fn block_start_line(&mut self, block_index: i32) -> Option<i32> {
        self.ensure_blocks_up_to(block_index);
        self.block_starts.get(block_index as usize).copied()
    }

    pub fn line_for_block(&mut self, block_index: i32) -> i32 {
        // TOC entries can point past the end of content (stale/malformed TOC,
        // simplified-mode mapping edge cases). Clamp instead of panicking —
        // the TS implementation returned undefined and the reader's clampLine
        // then coerced it, so this must never abort the process.
        if self.block_count == 0 {
            return 0;
        }
        let idx = std::cmp::max(0, std::cmp::min(block_index, self.block_count - 1));
        self.ensure_blocks_up_to(idx);
        self.block_starts[idx as usize]
    }

    pub fn block_char_start(&self, block_index: i32) -> i32 {
        self.block_char_starts.get(block_index as usize).copied().unwrap_or(0)
    }

    pub fn line_for_char_offset(&mut self, char_offset: i32) -> i32 {
        if self.block_count == 0 {
            return 0;
        }
        let safe = std::cmp::max(0, std::cmp::min(char_offset, self.total_chars - 1));
        let block = self.block_for_char_offset(safe);
        self.ensure_blocks_up_to(block);
        let local = safe - self.block_char_starts[block as usize];
        let start = self.block_starts[block as usize];
        let end = self.block_starts[block as usize + 1];
        let mut result = start;
        for i in start..end {
            if self.lines[i as usize].char_offset > local {
                break;
            }
            result = i;
        }
        result
    }

    pub fn char_offset_for_line(&mut self, line: i32) -> i32 {
        if line <= 0 {
            return 0;
        }
        self.ensure_line_count(line + 1);
        if let Some(tl) = self.lines.get(line as usize) {
            return self.block_char_starts[tl.block_index as usize] + tl.char_offset;
        }
        self.total_chars
    }

    pub fn invalidate(&mut self) {
        self.lines.clear();
        self.next_block_to_layout = 0;
        self.block_starts.iter_mut().for_each(|v| *v = -1);
        self.block_starts[0] = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn para(text: &str) -> Block {
        Block::paragraph(vec![Inline::text_node(text)])
    }

    fn opts(width: i32) -> LayoutOptions {
        LayoutOptions {
            typo: TypographyConfig {
                measure: 80,
                line_spacing: 0,
                paragraph_indent: 0,
                paragraph_spacing: 1,
                hyphenation: false,
                justify: false,
            },
            width,
            justify: false,
            hyphenation: false,
            get_highlights: None,
        }
    }

    #[test]
    fn layout_short_paragraph() {
        let block = para("hello world");
        let lines = layout_block(&block, 0, &opts(80));
        // 1 content line + 1 empty line from paragraph_spacing=1
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].role, "paragraph");
        assert_eq!(lines[1].role, "empty");
    }

    #[test]
    fn layout_wraps_long_paragraph() {
        let long = "word ".repeat(50);
        let block = para(&long);
        let lines = layout_block(&block, 0, &opts(20));
        assert!(lines.len() > 1);
    }

    #[test]
    fn layout_heading_role() {
        let block = Block::heading(2, vec![Inline::text_node("Title")]);
        let lines = layout_block(&block, 0, &opts(80));
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].role, "heading2");
    }

    #[test]
    fn layout_empty_block() {
        let block = Block::empty();
        let lines = layout_block(&block, 0, &opts(80));
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].role, "empty");
    }

    #[test]
    fn layout_code_preserves_newlines() {
        let block = Block::code(vec![Inline::code("line1\nline2")]);
        let lines = layout_block(&block, 0, &opts(80));
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].role, "code");
    }

    #[test]
    fn layout_quote_indented() {
        let block = Block::quote(vec![Inline::text_node("quoted text")]);
        let lines = layout_block(&block, 0, &opts(80));
        assert_eq!(lines[0].role, "quote");
        assert_eq!(lines[0].indent, 4);
    }

    #[test]
    fn layout_image_reserves_rows() {
        let block = Block::image("x", "cover");
        let lines = layout_block(&block, 0, &opts(80));
        assert_eq!(lines[0].role, "image");
        // 1 image line + IMAGE_ROWS - 1 = 9 reserved blank lines (parity with
        // src/tui/imageLayer.ts, so the overlay never covers the text below).
        assert_eq!(lines.len() as i32, IMAGE_ROWS);
        assert!(lines[1..].iter().all(|l| l.role == "empty"));
    }

    #[test]
    fn book_layout_basic() {
        let blocks = vec![para("first"), para("second")];
        let mut layout = BookLayout::new(blocks, opts(80));
        assert_eq!(layout.block_count, 2);
        assert_eq!(layout.total_chars, 11); // "first" + "second"
        let count = layout.line_count();
        assert!(count >= 2);
    }

    #[test]
    fn book_layout_char_offset() {
        let blocks = vec![para("hello"), para("world")];
        let mut layout = BookLayout::new(blocks, opts(80));
        let line = layout.line_for_char_offset(7);
        // offset 7 is in "world" (starts at 5)
        assert!(line >= 0);
    }

    #[test]
    fn book_layout_invalidate() {
        let blocks = vec![para("test")];
        let mut layout = BookLayout::new(blocks, opts(80));
        layout.line_count();
        assert!(!layout.lines.is_empty());
        layout.invalidate();
        assert!(layout.lines.is_empty());
        assert_eq!(layout.next_block_to_layout, 0);
    }

    #[test]
    fn wrap_spans_basic() {
        let spans = vec![StyledSpan {
            text: "hello world".to_owned(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            link: false,
            highlight: false,
        }];
        let wrapped = wrap_spans(&spans, 80, &[], false);
        assert_eq!(wrapped.lines.len(), 1);
        assert_eq!(wrapped.original_lengths[0], 11);
    }

    #[test]
    fn wrap_spans_breaks_at_space() {
        let spans = vec![StyledSpan {
            text: "one two three four".to_owned(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            link: false,
            highlight: false,
        }];
        let wrapped = wrap_spans(&spans, 10, &[], false);
        assert!(wrapped.lines.len() > 1);
    }

    #[test]
    fn wrap_spans_no_vertical_after_space_fills_line() {
        // Regression: a space that exactly fills the line (width == maxWidth)
        // used to leave a stale width, so every following char wrapped onto
        // its own line — text rendered vertically ("пролила свет..." in the
        // Kaku Гиперпространство FB2).
        let spans = vec![StyledSpan {
            text: "aaaaa bb".to_owned(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            link: false,
            highlight: false,
        }];
        let wrapped = wrap_spans(&spans, 5, &[], false);
        let text: Vec<String> = wrapped.lines.iter().map(|l| spans_to_plain(l)).collect();
        // The space that triggered the flush lands at the start of the second
        // line (only trailing spaces are trimmed) — matching the TS original.
        assert_eq!(text, vec!["aaaaa", " bb"]);
    }

    #[test]
    fn wrap_spans_long_cyrillic_paragraph_no_vertical() {
        // The real sentence from the reported book: must wrap into a handful
        // of horizontal lines, never degrade to one char per line.
        let text = "Подобно тому, как в сумрачную затхлую комнату проникает сияние тёплого летнего солнца, лекция Римана пролила свет на ошеломляющие свойства многомерного пространства.";
        let spans = vec![StyledSpan {
            text: text.to_owned(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            link: false,
            highlight: false,
        }];
        let wrapped = wrap_spans(&spans, 95, &[], false);
        assert!(wrapped.lines.len() <= 4, "expected a few wrapped lines, got {}", wrapped.lines.len());
        // Content is lossless: every original char appears, in order.
        let joined: String = wrapped.lines.iter().flat_map(|l| l.iter().map(|s| s.text.clone())).collect();
        let without_spaces: String = joined.chars().filter(|c| *c != ' ').collect();
        let expected: String = text.chars().filter(|c| *c != ' ').collect();
        assert_eq!(without_spaces, expected);
    }

    #[test]
    fn inline_to_spans_preserves_bold() {
        let inlines = vec![
            Inline::text_node("hello "),
            Inline::style("bold", vec![Inline::text_node("world")]),
        ];
        let spans = inline_to_spans(&inlines);
        assert!(spans.len() >= 2);
        let bold_span = spans.iter().find(|s| s.bold);
        assert!(bold_span.is_some());
    }

    #[test]
    fn ensure_line_count_safe_upper_bound() {
        // Bugfix test: ensure_line_count with huge count must not freeze.
        // Uses safe upper bound instead of usize::MAX.
        let blocks = vec![para("short")];
        let mut layout = BookLayout::new(blocks, opts(80));
        let count = layout.ensure_line_count(i32::MAX);
        // Should complete without hanging and return a small number
        assert!(count > 0);
        assert!(count < 1000);
    }

    #[test]
    fn line_for_block_clamps_out_of_range() {
        // TOC entries can point past the end of content (stale/malformed
        // TOC); line_for_block must clamp instead of panicking (the TS
        // implementation returned undefined and the reader limped along).
        let blocks = vec![para("one"), para("two")];
        let mut layout = BookLayout::new(blocks, opts(80));
        let last = layout.line_for_block(1);
        assert_eq!(layout.line_for_block(999), last);
        assert_eq!(layout.line_for_block(-5), 0);
    }

    #[test]
    fn line_for_block_empty_book() {
        let mut layout = BookLayout::new(Vec::new(), opts(80));
        assert_eq!(layout.line_for_block(0), 0);
        assert_eq!(layout.line_for_block(5), 0);
    }

    #[test]
    fn set_highlights_marks_matching_spans() {
        // set_highlights feeds the shared map that the get_highlights closure
        // installed in `new` reads during layout — the napi data-push design.
        let blocks = vec![para("hello world")];
        let mut layout = BookLayout::new(blocks, opts(80));
        let mut map = std::collections::HashMap::new();
        map.insert(0, vec![HighlightRange { start: 0, end: 5 }]);
        layout.set_highlights(map);
        assert!(layout.line_count() > 0);
        let page = layout.get_page(0, 100);
        let highlighted: Vec<StyledSpan> = page
            .iter()
            .flat_map(|l| l.spans.iter().cloned())
            .filter(|s| s.highlight)
            .collect();
        assert!(!highlighted.is_empty());
        let text: String = highlighted.iter().map(|s| s.text.clone()).collect();
        assert_eq!(text, "hello");
    }

    #[test]
    fn clear_highlights_removes_marks() {
        let blocks = vec![para("hello world")];
        let mut layout = BookLayout::new(blocks, opts(80));
        let mut map = std::collections::HashMap::new();
        map.insert(0, vec![HighlightRange { start: 0, end: 5 }]);
        layout.set_highlights(map);
        layout.set_highlights(std::collections::HashMap::new());
        assert!(layout.line_count() > 0);
        let page = layout.get_page(0, 100);
        assert!(page.iter().all(|l| l.spans.iter().all(|s| !s.highlight)));
    }
}