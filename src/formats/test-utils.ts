import AdmZip from 'adm-zip';
import { openZip } from '../utils/zip.js';

export const FB2_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
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
</FictionBook>`;

const CP1251_RANGES: Array<[number, number, number]> = [
  [0x0410, 0x044f, 0xc0],
  [0x0401, 0x0401, 0xa8],
  [0x0451, 0x0451, 0xb8],
];

function toCp1251(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let mapped = false;
    for (const [start, end, base] of CP1251_RANGES) {
      if (code >= start && code <= end) {
        bytes.push(base + (code - start));
        mapped = true;
        break;
      }
    }
    if (!mapped) bytes.push(code > 255 ? 0x3f : code);
  }
  return bytes;
}

export const FB2_CP1251_SAMPLE: Uint8Array = (() => {
  const text = `<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <author><first-name>Иван</first-name><last-name>Петров</last-name></author>
      <book-title>Тестовая книга</book-title>
      <lang>ru</lang>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>Глава первая</p></title>
      <p>Привет, мир!</p>
    </section>
  </body>
</FictionBook>`;
  return Buffer.from(toCp1251(text));
})();

export const FB2_IMAGE_REF = '<image l:href="#diagram.png" alt="A diagram"/>';

export function makeFb2Zip(xmlText: string, innerName = 'book.fb2'): Buffer {
  const zip = new AdmZip();
  zip.addFile(innerName, Buffer.from(xmlText, 'utf8'));
  return zip.toBuffer();
}

export function zipFileNames(data: Uint8Array): string[] {
  return openZip(data).entries.map((e) => e.name);
}

export function buildEpub(
  overrides: Partial<{ chapters: { name: string; body: string }[] }> = {},
): Buffer {
  const chapters = overrides.chapters ?? [
    {
      name: 'chap1.xhtml',
      body: `
        <h1 id="start">Chapter One</h1>
        <p>First paragraph of chapter one.</p>
        <p>Second paragraph with <strong>bold</strong> and <em>italic</em>.</p>
        <ul><li>Bullet one</li><li>Bullet two</li></ul>
        <blockquote>A quoted passage.</blockquote>
        <table><tr><th>H1</th><th>H2</th></tr><tr><td>A</td><td>B</td></tr></table>
        <img src="images/cover.jpg" alt="cover"/>
      `,
    },
    {
      name: 'chap2.xhtml',
      body: `
        <h1 id="chap2">Chapter Two</h1>
        <p id="sec2">Text in chapter two.</p>
      `,
    },
  ];

  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      'utf8',
    ),
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Epub Book</dc:title>
    <dc:creator>Jane Roe</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>A compelling description.</dc:description>
    <dc:subject>Fiction</dc:subject>
    <dc:identifier id="uid">urn:isbn:9781234567890</dc:identifier>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
    ${chapters
      .map((c, i) => `<item id="chap${i}" href="${c.name}" media-type="application/xhtml+xml"/>`)
      .join('\n    ')}
  </manifest>
  <spine>
    ${chapters.map((_, i) => `<itemref idref="chap${i}"/>`).join('\n    ')}
  </spine>
</package>`,
      'utf8',
    ),
  );
  zip.addFile(
    'OEBPS/nav.xhtml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <ol>
        <li><a href="chap1.xhtml#start">Chapter One</a></li>
        <li><a href="chap2.xhtml">Chapter Two</a>
          <ol><li><a href="chap2.xhtml#sec2">A Section</a></li></ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`,
      'utf8',
    ),
  );
  for (const chapter of chapters) {
    zip.addFile(
      `OEBPS/${chapter.name}`,
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${chapter.name}</title></head>
  <body>${chapter.body}</body>
</html>`,
        'utf8',
      ),
    );
  }
  zip.addFile('OEBPS/images/cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  return zip.toBuffer();
}

export function buildNcxEpub(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
      'utf8',
    ),
  );
  zip.addFile(
    'content.opf',
    Buffer.from(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Ncx Book</dc:title>
    <dc:creator>Old Author</dc:creator>
    <dc:language>fr</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chap1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chap1"/>
  </spine>
</package>`,
      'utf8',
    ),
  );
  zip.addFile(
    'toc.ncx',
    Buffer.from(
      `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>First Chapter</text></navLabel>
      <content src="c1.xhtml#top"/>
    </navPoint>
  </navMap>
</ncx>`,
      'utf8',
    ),
  );
  zip.addFile(
    'c1.xhtml',
    Buffer.from(
      `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h1 id="top">First Chapter</h1>
  <p>Hello from an NCX-based EPUB.</p>
</body></html>`,
      'utf8',
    ),
  );
  return zip.toBuffer();
}

export function makeBrokenZip(): Buffer {
  return Buffer.from('PK\x03\x04 this is not a real zip');
}
