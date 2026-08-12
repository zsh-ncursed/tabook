//! Shared document model — Rust mirror of `src/formats/model.ts`.
//!
//! All structs are `#[napi(object)]`: napi-rs converts them to plain JS objects
//! when returned across the boundary. The TS side consumes them as `Block`,
//! `Inline`, etc., with identical field names (snake_case matches the existing
//! TS types, which already use snake_case for block fields like `blockIndex`,
//! `coverKey`).

use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Author {
    pub first_name: String,
    pub last_name: String,
    pub middle_name: Option<String>,
    pub nickname: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SeriesInfo {
    pub name: String,
    pub number: Option<f64>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct BookMetadata {
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
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TocEntry {
    pub id: String,
    pub label: String,
    pub level: i32,
    pub block_index: i32,
}

// ----- Inline model -----

// Inline is a tagged union. napi-rs `#[napi]` does not support Rust enums with
// data fields directly; we expose a flat `Inline` struct with a `kind`
// discriminator and optional fields, mirroring how the TS side already
// pattern-matches on `inline.kind`. Conversion to the strict TS union happens
// at the napi boundary via a custom Into<JsValue> in later phases; for now the
// flat shape is enough for internal use and `Block` carries it.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct Inline {
    pub kind: String,
    pub text: Option<String>,
    pub children: Option<Vec<Inline>>,
    pub href: Option<String>,
    pub src: Option<String>,
    pub alt: Option<String>,
}

impl Inline {
    pub fn text_node(text: impl Into<String>) -> Self {
        Self {
            kind: "text".into(),
            text: Some(text.into()),
            children: None,
            href: None,
            src: None,
            alt: None,
        }
    }

    pub fn style(kind: &str, children: Vec<Inline>) -> Self {
        Self {
            kind: kind.into(),
            text: None,
            children: Some(children),
            href: None,
            src: None,
            alt: None,
        }
    }

    pub fn code(text: impl Into<String>) -> Self {
        Self {
            kind: "code".into(),
            text: Some(text.into()),
            children: None,
            href: None,
            src: None,
            alt: None,
        }
    }

    pub fn link(href: impl Into<String>, children: Vec<Inline>) -> Self {
        Self {
            kind: "link".into(),
            text: None,
            children: Some(children),
            href: Some(href.into()),
            src: None,
            alt: None,
        }
    }

    pub fn image(src: impl Into<String>, alt: impl Into<String>) -> Self {
        Self {
            kind: "image".into(),
            text: None,
            children: None,
            href: None,
            src: Some(src.into()),
            alt: Some(alt.into()),
        }
    }

    pub fn line_break() -> Self {
        Self {
            kind: "lineBreak".into(),
            text: None,
            children: None,
            href: None,
            src: None,
            alt: None,
        }
    }
}

// ----- Block model -----

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ListItem {
    pub children: Vec<Inline>,
    pub nested: Vec<Block>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Stanza {
    pub lines: Vec<Vec<Inline>>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Block {
    pub r#type: String,
    pub children: Option<Vec<Inline>>,
    pub level: Option<i32>,
    pub ordered: Option<bool>,
    pub items: Option<Vec<ListItem>>,
    pub headers: Option<Vec<Vec<Inline>>>,
    pub rows: Option<Vec<Vec<Vec<Inline>>>>,
    pub stanzas: Option<Vec<Stanza>>,
    pub src: Option<String>,
    pub alt: Option<String>,
    pub title: Option<String>,
}

impl Block {
    pub fn empty() -> Self {
        Self {
            r#type: "empty".into(),
            children: None,
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn paragraph(children: Vec<Inline>) -> Self {
        Self {
            r#type: "paragraph".into(),
            children: Some(children),
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn heading(level: i32, children: Vec<Inline>) -> Self {
        Self {
            r#type: "heading".into(),
            children: Some(children),
            level: Some(level),
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn code(children: Vec<Inline>) -> Self {
        Self {
            r#type: "code".into(),
            children: Some(children),
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn quote(children: Vec<Inline>) -> Self {
        Self {
            r#type: "quote".into(),
            children: Some(children),
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn epigraph(children: Vec<Inline>) -> Self {
        Self {
            r#type: "epigraph".into(),
            children: Some(children),
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn annotation(children: Vec<Inline>) -> Self {
        Self {
            r#type: "annotation".into(),
            children: Some(children),
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn list(ordered: bool, items: Vec<ListItem>) -> Self {
        Self {
            r#type: "list".into(),
            children: None,
            level: None,
            ordered: Some(ordered),
            items: Some(items),
            headers: None,
            rows: None,
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn table(headers: Vec<Vec<Inline>>, rows: Vec<Vec<Vec<Inline>>>) -> Self {
        Self {
            r#type: "table".into(),
            children: None,
            level: None,
            ordered: None,
            items: None,
            headers: Some(headers),
            rows: Some(rows),
            stanzas: None,
            src: None,
            alt: None,
            title: None,
        }
    }

    pub fn image(src: impl Into<String>, alt: impl Into<String>) -> Self {
        Self {
            r#type: "image".into(),
            children: None,
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: None,
            src: Some(src.into()),
            alt: Some(alt.into()),
            title: None,
        }
    }

    pub fn poem(stanzas: Vec<Stanza>) -> Self {
        Self {
            r#type: "poem".into(),
            children: None,
            level: None,
            ordered: None,
            items: None,
            headers: None,
            rows: None,
            stanzas: Some(stanzas),
            src: None,
            alt: None,
            title: None,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct ParsedBook {
    pub format: String,
    pub path: String,
    pub filename: String,
    pub size: f64,
    pub metadata: BookMetadata,
    pub toc: Vec<TocEntry>,
    pub content: Vec<Block>,
    pub resources: Vec<ResourceEntry>,
}

#[napi(object)]
#[derive(Clone)]
pub struct ResourceEntry {
    pub key: String,
    pub data: Vec<u8>,
}