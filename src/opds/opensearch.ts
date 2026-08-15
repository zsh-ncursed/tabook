import {
  parseXml,
  findChildren,
  firstChild,
  textOf,
  attributesOf,
  type XmlNode,
} from '../formats/xml.js';
import { ParseError } from '../utils/errors.js';
import { decodeEntities } from '../utils/text.js';

export interface OpenSearchDescription {
  shortName: string;
  description?: string;
  templates: OpenSearchUrl[];
}

export interface OpenSearchUrl {
  type: string;
  template: string;
  rel?: string;
}

export function parseOpenSearch(xml: string): OpenSearchDescription {
  let root: XmlNode[];
  try {
    root = parseXml(xml);
  } catch (err) {
    throw new ParseError(
      `Failed to parse OpenSearch description: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const osdNode = root.find((n) => {
    const tag = Object.keys(n)[0] ?? '';
    return tag === 'OpenSearchDescription';
  });
  if (!osdNode) throw new ParseError('No <OpenSearchDescription> root element');

  const shortName = textOf(firstChild(osdNode, 'ShortName')) || '';
  const description = textOf(firstChild(osdNode, 'Description')) || undefined;

  const urlNodes = findChildren(osdNode, 'Url');
  const templates = urlNodes.map((un) => {
    const attrs = attributesOf(un);
    return {
      type: attrs.type ?? '',
      template: attrs.template ?? '',
      rel: attrs.rel,
    };
  });

  return { shortName, description, templates };
}

export function buildSearchUrl(desc: OpenSearchDescription, query: string): string | undefined {
  const atomTemplate = desc.templates.find(
    (t) => t.type.includes('application/atom+xml') || t.type.includes('opds-catalog'),
  );
  const template = atomTemplate ?? desc.templates[0];
  if (!template) return undefined;
  return expandTemplate(template.template, { searchTerms: query });
}

export function expandTemplate(template: string, params: Record<string, string>): string {
  // The template comes from an XML attribute, where & in URLs is escaped as
  // &amp; (real catalogs — e.g. Flibusta — do this). Decode before expansion
  // so the built URL has proper query separators.
  const decoded = decodeEntities(template);
  return decoded.replace(/\{(\w+)\??\}/g, (match, name: string) => {
    const value = params[name];
    if (value !== undefined) return encodeURIComponent(value);
    const optional = match.endsWith('?}');
    return optional ? '' : match;
  });
}
