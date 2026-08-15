import { describe, it, expect } from 'vitest';
import { expandTemplate, buildSearchUrl, parseOpenSearch } from './opensearch.js';

describe('expandTemplate', () => {
  it('substitutes searchTerms URL-encoded', () => {
    expect(expandTemplate('https://x/search?q={searchTerms}', { searchTerms: 'a b' })).toBe(
      'https://x/search?q=a%20b',
    );
  });

  it('removes optional parameters', () => {
    expect(expandTemplate('https://x/?a={x?}&b=1', {})).toBe('https://x/?a=&b=1');
  });

  it('decodes XML-escaped ampersands in the template (real catalogs do this)', () => {
    expect(expandTemplate('https://x/?a=1&amp;b={searchTerms}', { searchTerms: 'q' })).toBe(
      'https://x/?a=1&b=q',
    );
    expect(
      expandTemplate(
        'http://flibusta.is/opds/opensearch?searchTerm={searchTerms}&amp;searchType=books',
        {
          searchTerms: 'дюма',
        },
      ),
    ).toBe(
      'http://flibusta.is/opds/opensearch?searchTerm=%D0%B4%D1%8E%D0%BC%D0%B0&searchType=books',
    );
  });
});

describe('buildSearchUrl', () => {
  it('prefers an atom/opds template', () => {
    const desc = parseOpenSearch(
      `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Test</ShortName>
  <Url type="text/html" template="https://x/html?q={searchTerms}"/>
  <Url type="application/atom+xml" template="https://x/atom?q={searchTerms}"/>
</OpenSearchDescription>`,
    );
    expect(buildSearchUrl(desc, 'v')).toBe('https://x/atom?q=v');
  });

  it('returns undefined with no templates', () => {
    const desc = parseOpenSearch(
      `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Test</ShortName>
</OpenSearchDescription>`,
    );
    expect(buildSearchUrl(desc, 'v')).toBeUndefined();
  });
});
