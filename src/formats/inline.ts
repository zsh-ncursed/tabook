import type { Inline } from './model.js';
import { decodeEntities } from '../utils/text.js';
import { asXmlChildren, attrOf, childrenOf } from './xml.js';
import type { XmlChildren, XmlNode } from './xml.js';

const STYLE_TAGS: Record<string, (children: Inline[]) => Inline> = {
  strong: (c) => ({ kind: 'bold', children: c }),
  b: (c) => ({ kind: 'bold', children: c }),
  emphasis: (c) => ({ kind: 'italic', children: c }),
  em: (c) => ({ kind: 'italic', children: c }),
  i: (c) => ({ kind: 'italic', children: c }),
  strikethrough: (c) => ({ kind: 'strike', children: c }),
  strike: (c) => ({ kind: 'strike', children: c }),
  s: (c) => ({ kind: 'strike', children: c }),
  del: (c) => ({ kind: 'strike', children: c }),
  u: (c) => ({ kind: 'underline', children: c }),
  ins: (c) => ({ kind: 'underline', children: c }),
  code: (c) => ({ kind: 'code', text: plainOf(c) }),
};

export function parseInlines(nodeOrChildren: XmlNode | XmlChildren | undefined): Inline[] {
  const children = Array.isArray(nodeOrChildren) ? nodeOrChildren : asXmlChildren(nodeOrChildren);
  return parseChildren(children);
}

function parseChildren(children: XmlChildren): Inline[] {
  const result: Inline[] = [];
  for (const kid of children) {
    const key = Object.keys(kid)[0] ?? '';
    if (key === '#text') {
      const value = kid[key];
      if (typeof value === 'string') {
        result.push({ kind: 'text', text: value });
      }
      continue;
    }
    if (key.startsWith('@_')) continue;
    result.push(...parseElement(kid, key));
  }
  return result;
}

function parseElement(node: XmlNode, tagRaw: string): Inline[] {
  const tag = tagRaw.includes(':') ? tagRaw.slice(tagRaw.indexOf(':') + 1) : tagRaw;
  const children = childrenOf(node);
  switch (tag) {
    case 'br':
      return [{ kind: 'lineBreak' }];
    case 'image':
      return [
        {
          kind: 'image',
          src: attrOf(node, 'href') ?? '',
          alt: attrOf(node, 'alt') ?? '',
        },
      ];
    case 'a': {
      const href = attrOf(node, 'href') ?? '';
      return [{ kind: 'link', href, children: parseChildren(children) }];
    }
    case 'span':
      return parseChildren(children);
    default: {
      const maker = STYLE_TAGS[tag];
      if (maker) {
        return [maker(parseChildren(children))];
      }
      return parseChildren(children);
    }
  }
}

export function plainOf(inlines: Inline[] | undefined): string {
  if (!inlines) return '';
  let out = '';
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text':
        out += inline.text;
        break;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
      case 'link':
        out += plainOf(inline.children);
        break;
      case 'code':
        out += inline.text;
        break;
      case 'image':
        out += inline.alt;
        break;
      case 'lineBreak':
        out += '\n';
        break;
    }
  }
  return out;
}

export function normalizeInlines(inlines: Inline[]): Inline[] {
  const result: Inline[] = [];
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text': {
        const collapsed = inline.text.replace(/\s+/g, ' ');
        if (collapsed !== '') {
          result.push({ kind: 'text', text: collapsed });
        }
        break;
      }
      case 'lineBreak':
        result.push(inline);
        break;
      case 'code':
        result.push(inline);
        break;
      case 'image':
        result.push(inline);
        break;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
      case 'link': {
        const normalized = normalizeInlines(inline.children);
        if (normalized.length === 0) break;
        result.push({ ...inline, children: normalized });
        break;
      }
    }
  }
  return trimInlines(result);
}

function trimInlines(inlines: Inline[]): Inline[] {
  const trimmed = inlines;
  while (trimmed.length > 0) {
    const first = trimmed[0]!;
    if (first.kind === 'text') {
      const t = first.text.replace(/^\s+/, '');
      if (t === '') {
        trimmed.shift();
        continue;
      }
      trimmed[0] = { kind: 'text', text: t };
    }
    break;
  }
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1]!;
    if (last.kind === 'text') {
      const t = last.text.replace(/\s+$/, '');
      if (t === '') {
        trimmed.pop();
        continue;
      }
      trimmed[trimmed.length - 1] = { kind: 'text', text: t };
    }
    break;
  }
  return trimmed;
}

export function decodeTextRaw(raw: unknown): string {
  if (typeof raw === 'string') return decodeEntities(raw);
  return '';
}
