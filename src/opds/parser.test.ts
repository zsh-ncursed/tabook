import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOpdsAtom } from './parser.js';
import { parseOpenSearch, buildSearchUrl, expandTemplate } from './opensearch.js';
import { pickAcquisitionLink, mimeToExtension, ACQUISITION_RELS } from './model.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('parseOpdsAtom', () => {
  describe('Gutenberg root (navigation feed)', () => {
    const feed = parseOpdsAtom(fixture('gutenberg_root.xml'));

    it('parses feed-level metadata', () => {
      expect(feed.title).toBe('Project Gutenberg');
      expect(feed.subtitle).toBe('Free eBooks since 1971.');
      expect(feed.id).toBe('http://www.gutenberg.org/ebooks.opds/');
      expect(feed.updated).toBeTruthy();
      expect(feed.kind).toBe('navigation');
    });

    it('extracts feed-level links', () => {
      expect(feed.searchHref).toBe('https://www.gutenberg.org/catalog/osd-books.xml');
      expect(feed.selfHref).toBe('/ebooks.opds/');
      expect(feed.startHref).toBe('/ebooks.opds/');
    });

    it('parses navigation entries with subsection links', () => {
      expect(feed.entries.length).toBe(3);
      const popular = feed.entries[0]!;
      expect(popular.title).toBe('Popular');
      expect(popular.isNavigation).toBe(true);
      expect(popular.isAcquisition).toBe(false);
      expect(popular.subsectionHref).toBe('/ebooks/search.opds/?sort_order=downloads');
    });

    it('has no facets in navigation feed', () => {
      expect(feed.facets).toHaveLength(0);
    });

    it('has no pagination links on root', () => {
      expect(feed.nextHref).toBeUndefined();
      expect(feed.prevHref).toBeUndefined();
    });
  });

  describe('Gutenberg search results (acquisition-ish navigation)', () => {
    const feed = parseOpdsAtom(fixture('gutenberg_acq.xml'));

    it('parses feed title and id', () => {
      expect(feed.title).toBe('Books: dostoyevsky');
      expect(feed.id).toContain('dostoyevsky');
    });

    it('has next pagination link', () => {
      expect(feed.nextHref).toContain('start_index=26');
    });

    it('has search link', () => {
      expect(feed.searchHref).toContain('osd-books.xml');
    });

    it('contains book entries with subsection links to individual books', () => {
      const crime = feed.entries.find((e) => e.title === 'Crime and Punishment');
      expect(crime).toBeDefined();
      expect(crime!.isNavigation).toBe(true);
      expect(crime!.subsectionHref).toBe('/ebooks/2554.opds');
    });
  });

  describe('Gutenberg book page (acquisition feed)', () => {
    const feed = parseOpdsAtom(fixture('gutenberg_book.xml'));

    it('parses feed title', () => {
      expect(feed.title).toContain('Crime and Punishment');
    });

    it('contains acquisition entry with epub link', () => {
      const entry = feed.entries[0]!;
      expect(entry.title).toBe('Crime and Punishment');
      expect(entry.isAcquisition).toBe(true);
      const epub = entry.acquisitionLinks.find((l) => l.type === 'application/epub+zip');
      expect(epub).toBeDefined();
      expect(epub!.href).toContain('2554.epub');
      expect(epub!.length).toBe(651214);
    });

    it('extracts author', () => {
      const entry = feed.entries[0]!;
      expect(entry.authors).toHaveLength(1);
      expect(entry.authors[0]!.name).toBe('Dostoyevsky, Fyodor');
    });

    it('extracts categories', () => {
      const entry = feed.entries[0]!;
      expect(entry.categories.length).toBeGreaterThan(0);
      const detective = entry.categories.find((c) => c.term === 'Detective and mystery stories');
      expect(detective).toBeDefined();
    });

    it('extracts dcterms:language', () => {
      const entry = feed.entries[0]!;
      expect(entry.language).toBe('en');
    });

    it('has thumbnail and image links', () => {
      const entry = feed.entries[0]!;
      expect(entry.thumbnailHref).toContain('cover.small.jpg');
      expect(entry.imageHref).toContain('cover.medium.jpg');
    });

    it('has rights', () => {
      const entry = feed.entries[0]!;
      expect(entry.rights).toContain('Public domain');
    });

    it('has published date', () => {
      const entry = feed.entries[0]!;
      expect(entry.published).toContain('2006-03-28');
    });
  });

  describe('Anarchist Library root (navigation, sort links)', () => {
    const feed = parseOpdsAtom(fixture('anarchist_root.xml'));

    it('parses title and id', () => {
      expect(feed.title).toBe('The Anarchist Library');
      expect(feed.id).toBe('https://theanarchistlibrary.org/opds');
    });

    it('extracts search link', () => {
      expect(feed.searchHref).toBe('https://theanarchistlibrary.org/opensearch.xml');
    });

    it('has navigation entries with sort/new and subsection rels', () => {
      const newEntry = feed.entries.find((e) => e.title === 'New');
      expect(newEntry).toBeDefined();
      const link = newEntry!.links.find((l) => l.rel === 'http://opds-spec.org/sort/new');
      expect(link).toBeDefined();
      expect(link!.type).toContain('kind=acquisition');
    });

    it('has xhtml content on entries', () => {
      const titles = feed.entries.find((e) => e.title === 'Titles');
      expect(titles).toBeDefined();
      expect(titles!.content).toContain('Full list of texts');
    });
  });

  describe('Anarchist Library acquisition feed', () => {
    const feed = parseOpdsAtom(fixture('anarchist_acq.xml'));

    it('detects acquisition kind from self link type', () => {
      expect(feed.kind).toBe('acquisition');
    });

    it('has up link', () => {
      expect(feed.upHref).toBe('https://theanarchistlibrary.org/opds');
    });

    it('has next and first/last pagination', () => {
      expect(feed.nextHref).toBe('https://theanarchistlibrary.org/opds/new/2');
      expect(feed.links.find((l) => l.rel === 'first')).toBeDefined();
      expect(feed.links.find((l) => l.rel === 'last')).toBeDefined();
    });

    it('entries have acquisition links for epub', () => {
      const entry = feed.entries[0]!;
      expect(entry.isAcquisition).toBe(true);
      const acq = entry.acquisitionLinks.find((l) => l.type === 'application/epub+zip');
      expect(acq).toBeDefined();
      expect(acq!.href).toContain('.epub');
    });

    it('entries have author and language', () => {
      const entry = feed.entries[0]!;
      expect(entry.authors[0]!.name).toBe('Kevin Carson');
      expect(entry.language).toBe('en');
    });

    it('entries have summary', () => {
      const entry = feed.entries[0]!;
      expect(entry.summary).toContain('Countervailing');
    });
  });

  describe('textos.info (mixed navigation + sort links in feed)', () => {
    const feed = parseOpdsAtom(fixture('textos_root.xml'));

    it('parses title', () => {
      expect(feed.title).toBe('textos.info');
    });

    it('has sort/popular and sort/new links at feed level', () => {
      const popular = feed.links.find((l) => l.rel === 'http://opds-spec.org/sort/popular');
      expect(popular).toBeDefined();
      expect(popular!.type).toContain('kind=acquisition');
    });

    it('has search link', () => {
      expect(feed.searchHref).toBe('https://www.textos.info/opensearch.xml');
    });

    it('entries are navigation with subsection rels', () => {
      const autores = feed.entries.find((e) => e.title === 'Autores');
      expect(autores).toBeDefined();
      expect(autores!.isNavigation).toBe(true);
    });
  });

  describe('synthetic fixture (facets, multiple formats, edge cases)', () => {
    const feed = parseOpdsAtom(fixture('synthetic_facets.xml'));

    it('detects acquisition kind from entries', () => {
      expect(feed.kind).toBe('acquisition');
    });

    it('parses facets grouped by facetGroup', () => {
      expect(feed.facets.length).toBe(5);
      const formatFacets = feed.facets.filter((f) => f.group === 'Format');
      expect(formatFacets).toHaveLength(3);
      const activeFormat = formatFacets.find((f) => f.active);
      expect(activeFormat?.title).toBe('All');
    });

    it('parses facet with thr:count', () => {
      const epub = feed.facets.find((f) => f.title === 'EPUB');
      expect(epub?.count).toBe(120);
    });

    it('detects fb2 acquisition link', () => {
      const book1 = feed.entries.find((e) => e.title === 'FB2 Test Book');
      expect(book1).toBeDefined();
      const fb2 = book1!.acquisitionLinks.find((l) => l.type === 'text/fb2+xml');
      expect(fb2).toBeDefined();
      expect(fb2!.rel).toBe('http://opds-spec.org/acquisition/open-access');
    });

    it('detects fb2.zip acquisition link', () => {
      const book3 = feed.entries.find((e) => e.title === 'FB2.ZIP Test Book');
      expect(book3).toBeDefined();
      const fb2zip = book3!.acquisitionLinks.find((l) => l.type === 'application/fb2+zip');
      expect(fb2zip).toBeDefined();
    });

    it('separates sample from full acquisition', () => {
      const book2 = feed.entries.find((e) => e.title === 'EPUB Test Book');
      expect(book2).toBeDefined();
      const full = book2!.acquisitionLinks.filter(
        (l) => l.rel === 'http://opds-spec.org/acquisition',
      );
      expect(full).toHaveLength(2);
      const sample = book2!.acquisitionLinks.find(
        (l) => l.rel === 'http://opds-spec.org/acquisition/sample',
      );
      expect(sample).toBeDefined();
    });

    it('extracts dcterms:publisher and identifier', () => {
      const book1 = feed.entries.find((e) => e.title === 'FB2 Test Book');
      expect(book1!.publisher).toBe('Test Publisher');
      expect(book1!.identifier).toBe('urn:isbn:978-3-16-148410-0');
    });

    it('extracts dcterms:issued', () => {
      const book1 = feed.entries.find((e) => e.title === 'FB2 Test Book');
      expect(book1!.issued).toBe('2020');
    });

    it('navigation entry has no acquisition links', () => {
      const nav = feed.entries.find((e) => e.title === 'Navigation Subfeed');
      expect(nav!.isNavigation).toBe(true);
      expect(nav!.isAcquisition).toBe(false);
      expect(nav!.acquisitionLinks).toHaveLength(0);
      expect(nav!.subsectionHref).toBe('https://example.com/subfeed');
    });

    it('has next pagination link', () => {
      expect(feed.nextHref).toBe('https://example.com/feed?page=2');
    });
  });

  describe('Flibusta root (navigation without rel="subsection")', () => {
    const feed = parseOpdsAtom(fixture('flibusta_root.xml'));

    it('parses feed title and id', () => {
      expect(feed.title).toBe('Flibusta catalog');
      expect(feed.id).toBe('tag:root');
    });

    it('has search links', () => {
      expect(feed.searchHref).toBe('/opds-opensearch.xml');
    });

    it('has 5 navigation entries', () => {
      expect(feed.entries).toHaveLength(5);
    });

    it('entries are navigation (isNavigation=true) despite no rel="subsection"', () => {
      for (const entry of feed.entries) {
        expect(entry.isNavigation).toBe(true);
        expect(entry.isAcquisition).toBe(false);
        expect(entry.subsectionHref).toBeDefined();
      }
    });

    it('Новинки points to /opds/new', () => {
      const newEntry = feed.entries.find((e) => e.title === 'Новинки')!;
      expect(newEntry.subsectionHref).toBe('/opds/new');
    });

    it('По авторам points to /opds/authorsindex', () => {
      const authors = feed.entries.find((e) => e.title === 'По авторам')!;
      expect(authors.subsectionHref).toBe('/opds/authorsindex');
    });

    it('Моя полка points to /opds/polka', () => {
      const shelf = feed.entries.find((e) => e.title === 'Моя полка')!;
      expect(shelf.subsectionHref).toBe('/opds/polka');
    });
  });

  describe('Flibusta search results (HTML content, fb2+zip, issued)', () => {
    const feed = parseOpdsAtom(fixture('flibusta_search_books.xml'));

    it('parses feed title and id', () => {
      expect(feed.title).toBe('Результат поиска');
      expect(feed.id).toBe('tag:search:books:пелевин:');
    });

    it('has up and next pagination links', () => {
      expect(feed.upHref).toContain('searchTerm=');
      expect(feed.nextHref).toContain('pageNumber=1');
    });

    it('has two entries', () => {
      expect(feed.entries).toHaveLength(2);
    });

    it('strips HTML from content (text/html type)', () => {
      const entry = feed.entries.find((e) =>
        e.title.includes('46 интервью'),
      )!;
      expect(entry.content).toBeDefined();
      expect(entry.content).not.toContain('<');
      expect(entry.content).not.toContain('&');
      expect(entry.content).toContain('Год издания: 2019');
      expect(entry.content).toContain('Серия: Эксклюзивное мнение #2');
      expect(entry.content).toContain('\n');
    });

    it('extracts issued year (dc:issued)', () => {
      const entry = feed.entries.find((e) => e.title.includes('46 интервью'))!;
      expect(entry.issued).toBe('2019');
    });

    it('entry without issued is undefined', () => {
      const entry = feed.entries.find((e) => e.title.includes('Нео-пелевин'))!;
      expect(entry.issued).toBeUndefined();
    });

    it('detects fb2+zip and epub acquisition links', () => {
      const entry = feed.entries.find((e) =>
        e.title.includes('46 интервью'),
      )!;
      expect(entry.isAcquisition).toBe(true);
      const fb2 = entry.acquisitionLinks.find((l) => l.type === 'application/fb2+zip');
      expect(fb2).toBeDefined();
      expect(fb2!.href).toBe('/b/703433/fb2');
      const epub = entry.acquisitionLinks.find((l) => l.type === 'application/epub+zip');
      expect(epub).toBeDefined();
      expect(epub!.href).toBe('/b/703433/epub');
    });

    it('extracts author and language', () => {
      const entry = feed.entries[0]!;
      expect(entry.authors[0]!.name).toBe('Пелевин Виктор Олегович');
      expect(entry.language).toBe('ru');
    });

    it('extracts categories (genres)', () => {
      const entry = feed.entries.find((e) =>
        e.title.includes('46 интервью'),
      )!;
      expect(entry.categories.length).toBeGreaterThan(0);
      expect(entry.categories.some((c) => c.term === 'Анекдоты')).toBe(true);
    });

    it('has image link', () => {
      const entry = feed.entries.find((e) =>
        e.title.includes('46 интервью'),
      )!;
      expect(entry.imageHref).toContain('_0.jpg');
    });
  });

  describe('error handling', () => {
    it('throws on non-XML input', () => {
      expect(() => parseOpdsAtom('not xml')).toThrow();
    });

    it('throws on missing feed element', () => {
      expect(() => parseOpdsAtom('<?xml version="1.0"?><html></html>')).toThrow('feed');
    });

    it('throws on XXE with SYSTEM entity', () => {
      const xxe =
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><feed/>';
      expect(() => parseOpdsAtom(xxe)).toThrow();
    });
  });
});

describe('parseOpenSearch', () => {
  it('parses anarchist library OpenSearch', () => {
    const desc = parseOpenSearch(fixture('opensearch.xml'));
    expect(desc.shortName).toBe('theanarchistlibrary.org');
    expect(desc.description).toBe('The Anarchist Library');
    expect(desc.templates.length).toBeGreaterThanOrEqual(2);
  });

  it('selects atom template for search', () => {
    const desc = parseOpenSearch(fixture('opensearch.xml'));
    const url = buildSearchUrl(desc, 'bakunin');
    expect(url).toBe('https://theanarchistlibrary.org/opds/search?query=bakunin');
  });

  it('parses Gutenberg OpenSearch with multiple Url types', () => {
    const desc = parseOpenSearch(fixture('gutenberg_opensearch.xml'));
    expect(desc.shortName).toBe('Gutenberg');
    expect(desc.templates.length).toBeGreaterThanOrEqual(2);
    const atom = desc.templates.find((t) => t.type.includes('atom'));
    expect(atom).toBeDefined();
    expect(atom!.template).toContain('{searchTerms}');
  });

  it('builds Gutenberg search URL', () => {
    const desc = parseOpenSearch(fixture('gutenberg_opensearch.xml'));
    const url = buildSearchUrl(desc, 'dostoyevsky');
    expect(url).toContain('query=dostoyevsky');
  });
});

describe('expandTemplate', () => {
  it('substitutes searchTerms', () => {
    expect(expandTemplate('http://x/?q={searchTerms}', { searchTerms: 'hello' })).toBe(
      'http://x/?q=hello',
    );
  });

  it('encodes special characters', () => {
    expect(expandTemplate('http://x/?q={searchTerms}', { searchTerms: 'a&b c' })).toBe(
      'http://x/?q=a%26b%20c',
    );
  });

  it('omits optional params when not provided', () => {
    expect(expandTemplate('http://x/?q={searchTerms}&p={startPage?}', { searchTerms: 'x' })).toBe(
      'http://x/?q=x&p=',
    );
  });

  it('leaves required params as-is when not provided', () => {
    expect(expandTemplate('http://x/?q={searchTerms}', {})).toBe('http://x/?q={searchTerms}');
  });
});

describe('pickAcquisitionLink', () => {
  it('prefers epub over fb2', () => {
    const links = [
      { rel: 'http://opds-spec.org/acquisition', href: 'http://x/b.fb2', type: 'text/fb2+xml' },
      {
        rel: 'http://opds-spec.org/acquisition',
        href: 'http://x/b.epub',
        type: 'application/epub+zip',
      },
    ];
    const picked = pickAcquisitionLink(links);
    expect(picked?.href).toBe('http://x/b.epub');
  });

  it('returns fb2 when no epub', () => {
    const links = [
      { rel: 'http://opds-spec.org/acquisition', href: 'http://x/b.fb2', type: 'text/fb2+xml' },
    ];
    const picked = pickAcquisitionLink(links);
    expect(picked?.href).toBe('http://x/b.fb2');
  });

  it('ignores unsupported mime types', () => {
    const links = [
      {
        rel: 'http://opds-spec.org/acquisition',
        href: 'http://x/b.mobi',
        type: 'application/x-mobipocket-ebook',
      },
    ];
    expect(pickAcquisitionLink(links)).toBeUndefined();
  });

  it('ignores sample rel', () => {
    const links = [
      {
        rel: 'http://opds-spec.org/acquisition/sample',
        href: 'http://x/preview.epub',
        type: 'application/epub+zip',
      },
      {
        rel: 'http://opds-spec.org/acquisition',
        href: 'http://x/full.epub',
        type: 'application/epub+zip',
      },
    ];
    const picked = pickAcquisitionLink(links);
    expect(picked?.href).toBe('http://x/full.epub');
  });

  it('returns undefined for empty links', () => {
    expect(pickAcquisitionLink([])).toBeUndefined();
  });
});

describe('mimeToExtension', () => {
  it('maps epub', () => {
    expect(mimeToExtension('application/epub+zip')).toBe('.epub');
  });

  it('maps fb2', () => {
    expect(mimeToExtension('text/fb2+xml')).toBe('.fb2');
    expect(mimeToExtension('application/x-fictionbook+xml')).toBe('.fb2');
    expect(mimeToExtension('application/fb2')).toBe('.fb2');
  });

  it('maps fb2.zip', () => {
    expect(mimeToExtension('application/fb2+zip')).toBe('.fb2.zip');
  });

  it('returns empty for unknown', () => {
    expect(mimeToExtension('application/pdf')).toBe('');
  });
});

describe('ACQUISITION_RELS', () => {
  it('contains all acquisition rel variants', () => {
    expect(ACQUISITION_RELS.has('http://opds-spec.org/acquisition')).toBe(true);
    expect(ACQUISITION_RELS.has('http://opds-spec.org/acquisition/open-access')).toBe(true);
    expect(ACQUISITION_RELS.has('http://opds-spec.org/acquisition/buy')).toBe(true);
    expect(ACQUISITION_RELS.has('http://opds-spec.org/acquisition/borrow')).toBe(true);
    expect(ACQUISITION_RELS.has('http://opds-spec.org/acquisition/sample')).toBe(true);
    expect(ACQUISITION_RELS.has('http://opds-spec.org/acquisition/subscribe')).toBe(true);
  });
});
