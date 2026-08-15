//! FB2 parser tests — port of `src/formats/fb2/parser.test.ts`.

use super::parser::*;

const FB2_SAMPLE: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <genre>sf</genre>
      <genre>adventure</genre>
      <author>
        <first-name>John</first-name>
        <last-name>Doe</last-name>
      </author>
      <author>
        <nickname>Nick</nickname>
      </author>
      <book-title>Test Book</book-title>
      <annotation><p>An <emphasis>important</emphasis> annotation.</p></annotation>
      <lang>en</lang>
      <sequence name="The Series" number="2"/>
      <coverpage><image l:href="#cover.jpg"/></coverpage>
    </title-info>
    <publish-info>
      <publisher>Example Press</publisher>
      <year>2020</year>
      <isbn>978-3-16-148410-0</isbn>
    </publish-info>
  </description>
  <body>
    <title><p>Book Title</p></title>
    <section id="ch1">
      <title><p>Chapter One</p></title>
      <p>First paragraph with <strong>bold</strong> and <emphasis>italic</emphasis> text.</p>
      <p>A <a l:href="#note1">footnote link</a> and an inline image <image l:href="#img1" alt="diagram"/>.</p>
      <list><li>Item one</li><li>Item two</li></list>
      <cite><p>To be or not to be.</p></cite>
      <poem>
        <stanza>
          <v>Line one of verse</v>
          <v>Line two of verse</v>
        </stanza>
      </poem>
      <empty-line/>
      <p>Second paragraph.</p>
      <subtitle>A Subtitle</subtitle>
      <table>
        <tr><th>Col A</th><th>Col B</th></tr>
        <tr><td>1</td><td>2</td></tr>
      </table>
      <section id="ch1.1">
        <title><p>Nested Section</p></title>
        <p>Nested content.</p>
      </section>
    </section>
  </body>
  <binary id="cover.jpg" content-type="image/jpeg">aGVsbG8gd29ybGQ=</binary>
  <binary id="img1" content-type="image/png">aW1nZGF0YQ==</binary>
</FictionBook>"##;

#[test]
fn parses_metadata() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    assert_eq!(result.metadata.title, "Test Book");
    assert_eq!(result.metadata.authors.len(), 2);
    assert_eq!(result.metadata.authors[0].first_name, "John");
    assert_eq!(result.metadata.authors[0].last_name, "Doe");
    assert_eq!(result.metadata.authors[1].nickname.as_deref(), Some("Nick"));
    assert_eq!(result.metadata.genres, vec!["sf", "adventure"]);
    assert_eq!(result.metadata.lang.as_deref(), Some("en"));
    assert_eq!(result.metadata.series.as_ref().unwrap().name, "The Series");
    assert_eq!(result.metadata.series.as_ref().unwrap().number, Some(2.0));
    assert_eq!(result.metadata.cover_key.as_deref(), Some("cover.jpg"));
    assert_eq!(result.metadata.publisher.as_deref(), Some("Example Press"));
    assert_eq!(result.metadata.isbn.as_deref(), Some("978-3-16-148410-0"));
    assert_eq!(result.metadata.year, Some(2020.0));
}

#[test]
fn parses_body_blocks() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    // The first block should be the Book Title heading
    assert!(result.blocks.len() > 5);
    let first = &result.blocks[0];
    assert_eq!(first.r#type, "heading");
    // Chapter One heading
    let ch1 = result.blocks.iter().find(|b| {
        b.r#type == "heading"
            && b.children
                .as_deref()
                .map(|c| c.iter().any(|i| i.text.as_deref() == Some("Chapter One")))
                .unwrap_or(false)
    });
    assert!(ch1.is_some());
}

#[test]
fn parses_toc() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    assert!(!result.toc.is_empty());
    let ch1 = result.toc.iter().find(|t| t.label == "Chapter One");
    assert!(ch1.is_some());
    assert_eq!(ch1.unwrap().level, 2);
}

#[test]
fn parses_resources() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    assert_eq!(result.resources.len(), 2);
    let cover = result.resources.iter().find(|r| r.key == "cover.jpg");
    assert!(cover.is_some());
    // "aGVsbG8gd29ybGQ=" decodes to "hello world"
    assert_eq!(&cover.unwrap().data[..], b"hello world");
}

#[test]
fn parses_list_block() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    let list = result.blocks.iter().find(|b| b.r#type == "list");
    assert!(list.is_some());
    let items = list.unwrap().items.as_ref().unwrap();
    assert_eq!(items.len(), 2);
}

#[test]
fn parses_poem_block() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    let poem = result.blocks.iter().find(|b| b.r#type == "poem");
    assert!(poem.is_some());
    let stanzas = poem.unwrap().stanzas.as_ref().unwrap();
    assert_eq!(stanzas.len(), 1);
    assert_eq!(stanzas[0].lines.len(), 2);
}

#[test]
fn parses_table_block() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    let table = result.blocks.iter().find(|b| b.r#type == "table");
    assert!(table.is_some());
    let t = table.unwrap();
    assert_eq!(t.headers.as_ref().unwrap().len(), 2);
    assert_eq!(t.rows.as_ref().unwrap().len(), 1);
}

#[test]
fn parses_quote_block() {
    let result = parse_fb2_text(FB2_SAMPLE, "/test.fb2", "test.fb2").unwrap();
    let quote = result.blocks.iter().find(|b| b.r#type == "quote");
    assert!(quote.is_some());
}

#[test]
fn metadata_only_is_faster_path() {
    let data = FB2_SAMPLE.as_bytes();
    let metadata = parse_fb2_metadata_inner(data, "/test.fb2").unwrap();
    assert_eq!(metadata.title, "Test Book");
    assert_eq!(metadata.authors.len(), 2);
}

#[test]
fn parse_fb2_buffer_from_bytes() {
    let data = FB2_SAMPLE.as_bytes();
    let book = parse_fb2_buffer_inner(data, "/test.fb2").unwrap();
    assert_eq!(book.format, "fb2");
    assert_eq!(book.metadata.title, "Test Book");
    assert!(!book.content.is_empty());
    assert_eq!(book.resources.len(), 2);
}

#[test]
fn parse_fb2_zip() {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("book.fb2", opts).unwrap();
        zip.write_all(FB2_SAMPLE.as_bytes()).unwrap();
        zip.finish().unwrap();
    }
    let book = parse_fb2_buffer_inner(&buf, "/test.fb2.zip").unwrap();
    assert_eq!(book.format, "fb2");
    assert_eq!(book.metadata.title, "Test Book");
}

#[test]
fn rejects_non_fb2() {
    let result = parse_fb2_buffer_inner(b"<html>not fb2</html>", "/test.xml");
    assert!(result.is_err());
}

#[test]
fn zip_metadata_fallback_uses_basename() {
    // Regression: the metadata-only zip path used to strip the extension off
    // the FULL archive path, so a zip with the fb2 in a subdirectory got
    // "subdir/book" as the fallback title for books without <book-title>.
    // The full-parse path already used the entry basename (parity:
    // src/parity/fb2.parity.test.ts).
    use std::io::Write;
    let minimal = r##"<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info>
    <author><first-name>Ann</first-name><last-name>Lee</last-name></author>
  </title-info></description>
  <body><section><title><p>Chapter</p></title><p>Body text.</p></section></body>
</FictionBook>"##;
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("subdir/book.fb2", opts).unwrap();
        zip.write_all(minimal.as_bytes()).unwrap();
        zip.finish().unwrap();
    }
    let metadata = parse_fb2_metadata_inner(&buf, "/test.fb2.zip").unwrap();
    assert_eq!(metadata.title, "book");
    let book = parse_fb2_buffer_inner(&buf, "/test.fb2.zip").unwrap();
    assert_eq!(book.metadata.title, "book");
}
