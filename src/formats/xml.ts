import { XMLParser } from 'fast-xml-parser';
import { decodeEntities } from '../utils/text.js';

export type XmlNode = Record<string, unknown>;
export type XmlChildren = XmlNode[];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  preserveOrder: true,
});

export function parseXml(text: string): XmlChildren {
  const result = parser.parse(text) as XmlNode | XmlChildren;
  if (Array.isArray(result)) return result;
  return [result];
}

export function asXmlChildren(value: unknown): XmlChildren {
  if (Array.isArray(value)) return value as XmlChildren;
  if (value && typeof value === 'object') return [value as XmlNode];
  return [];
}

export function tagOf(node: XmlNode): string {
  const keys = Object.keys(node);
  return keys[0] ?? '';
}

export function childrenOf(node: XmlNode): XmlChildren {
  const keys = Object.keys(node);
  for (const key of keys) {
    const value = node[key];
    if (Array.isArray(value)) return value as XmlChildren;
  }
  return [];
}

export function findChildren(node: XmlNode, tag: string): XmlChildren {
  const kids = childrenOf(node);
  return kids.filter((kid) => {
    const key = Object.keys(kid)[0] ?? '';
    return normalizeTag(key) === tag;
  });
}

export function firstChild(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  if (!node) return undefined;
  return findChildren(node, tag)[0];
}

export function hasChild(node: XmlNode, tag: string): boolean {
  return findChildren(node, tag).length > 0;
}

export function textOf(node: XmlNode | undefined): string {
  if (!node) return '';
  const kids = childrenOf(node);
  let out = '';
  for (const kid of kids) {
    const key = Object.keys(kid)[0] ?? '';
    if (key === '#text') {
      const value = kid[key];
      if (typeof value === 'string') out += value;
      else if (Array.isArray(value)) out += value.filter((v) => typeof v === 'string').join('');
    }
  }
  return decodeEntities(out);
}

export function attributesOf(node: XmlNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrNode = node[':@'];
  if (attrNode && typeof attrNode === 'object') {
    for (const [key, value] of Object.entries(attrNode)) {
      if (key.startsWith('@_')) {
        const name = normalizeAttrName(key.slice(2));
        attrs[name] = String(value);
      }
    }
  }
  const kids = childrenOf(node);
  for (const kid of kids) {
    for (const [key, value] of Object.entries(kid)) {
      if (key.startsWith('@_')) {
        const name = normalizeAttrName(key.slice(2));
        attrs[name] = String(value);
      }
    }
  }
  return attrs;
}

export function attrOf(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  return attributesOf(node)[normalizeAttrName(name)];
}

function normalizeAttrName(name: string): string {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

function normalizeTag(tag: string): string {
  const idx = tag.indexOf(':');
  return idx === -1 ? tag : tag.slice(idx + 1);
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function directText(node: XmlNode | undefined): string {
  return decodeEntities(textOf(node));
}

export function fullTextOf(node: XmlNode | undefined): string {
  if (!node) return '';
  let out = '';
  for (const kid of childrenOf(node)) {
    const key = Object.keys(kid)[0] ?? '';
    if (key === '#text') {
      const value = kid[key];
      if (typeof value === 'string') out += value;
      else if (Array.isArray(value)) out += value.filter((v) => typeof v === 'string').join('');
    } else {
      out += fullTextOf(kid);
    }
  }
  return decodeEntities(out);
}
