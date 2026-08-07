import { childrenOf, findChildren, attrOf, tagOf } from '../xml.js';
import type { XmlChildren, XmlNode } from '../xml.js';
import { normalizeInlines, parseInlines } from '../inline.js';
import type { Block, Inline, ListItem } from '../model.js';

export interface XhtmlParseResult {
  blocks: Block[];
  idToBlock: Map<string, number>;
}

interface XhtmlState {
  blocks: Block[];
  idToBlock: Map<string, number>;
  blockIndex: number;
}

function emit(state: XhtmlState, block: Block | Block[]): void {
  const list = Array.isArray(block) ? block : [block];
  for (const b of list) {
    if (b.type === 'empty') {
      state.blocks.push(b);
      state.blockIndex += 1;
      continue;
    }
    state.blocks.push(b);
    state.blockIndex += 1;
  }
}

function parseListElement(node: XmlNode, ordered: boolean): Block {
  const items: ListItem[] = [];
  for (const li of findChildren(node, 'li')) {
    const kids = childrenOf(li);
    const itemInlines: Inline[] = [];
    const nested: Block[] = [];
    for (const kid of kids) {
      const tag = tagOf(kid);
      if (tag === 'ul' || tag === 'ol') {
        nested.push(parseListElement(kid, tag === 'ol'));
      } else if (tag === 'p' || tag === 'div' || tag === 'span') {
        itemInlines.push(...parseInlines(kid));
      } else {
        itemInlines.push(...parseInlines(kid));
      }
    }
    items.push({ children: normalizeInlines(itemInlines), nested });
  }
  return { type: 'list', ordered, items };
}

function parseTableElement(node: XmlNode): Block {
  const rows = findChildren(node, 'tr');
  const tableRows: Inline[][][] = [];
  let headers: Inline[][] = [];
  for (const tr of rows) {
    const cells = [...findChildren(tr, 'td'), ...findChildren(tr, 'th')];
    const cellInlines = cells.map((c) => normalizeInlines(parseInlines(c)));
    if (headers.length === 0 && findChildren(tr, 'th').length > 0) {
      headers = cellInlines;
    } else {
      tableRows.push(cellInlines);
    }
  }
  return { type: 'table', headers, rows: tableRows };
}

export function parseXhtmlBlocks(nodes: XmlChildren): XhtmlParseResult {
  const state: XhtmlState = { blocks: [], idToBlock: new Map(), blockIndex: 0 };
  parseNodes(state, nodes);
  return { blocks: state.blocks, idToBlock: state.idToBlock };
}

function parseNodes(state: XhtmlState, nodes: XmlChildren): void {
  for (const node of nodes) {
    parseNode(state, node);
  }
}

function parseNode(state: XhtmlState, node: XmlNode): void {
  const tag = tagOf(node);
  const id = attrOf(node, 'id');
  const children = childrenOf(node);
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1]);
      emit(state, { type: 'heading', level, children: normalizeInlines(parseInlines(node)) });
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    }
    case 'p':
    case 'pre': {
      const inlines = normalizeInlines(parseInlines(node));
      if (inlines.length === 0) {
        emit(state, { type: 'empty' });
      } else {
        emit(state, { type: 'paragraph', children: inlines });
      }
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    }
    case 'blockquote': {
      const inlines = normalizeInlines(parseInlines(node));
      emit(state, { type: 'quote', children: inlines });
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    }
    case 'ul':
      emit(state, parseListElement(node, false));
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    case 'ol':
      emit(state, parseListElement(node, true));
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    case 'table':
      emit(state, parseTableElement(node));
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    case 'img': {
      const src = attrOf(node, 'src') ?? '';
      emit(state, { type: 'image', src, alt: attrOf(node, 'alt') ?? '' });
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    }
    case 'hr':
      emit(state, { type: 'empty' });
      if (id) state.idToBlock.set(id, state.blockIndex - 1);
      break;
    case 'figure':
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'aside':
    case 'hgroup':
    case 'form': {
      // Remember the index of the first block emitted inside this container;
      // the container id should resolve to that block so TOC links land at the
      // start of the section, not at its trailing paragraph.
      const start = state.blockIndex;
      parseNodes(state, children);
      if (id && state.blocks.length > start) {
        const idx = findFirstContentBlock(state, start);
        if (idx !== undefined) state.idToBlock.set(id, idx);
      }
      break;
    }
    case 'header':
    case 'footer':
    case 'nav':
    case 'script':
    case 'style':
    case 'title':
    case 'head':
      break;
    default:
      if (children.length > 0) {
        parseNodes(state, children);
      }
      break;
  }
}

function findFirstContentBlock(state: XhtmlState, from: number): number | undefined {
  for (let i = from; i < state.blocks.length; i++) {
    const block = state.blocks[i]!;
    if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'image') {
      return i;
    }
  }
  return undefined;
}

export function extractBody(children: XmlChildren): XmlChildren {
  for (const node of children) {
    const tag = tagOf(node);
    if (tag === 'body') {
      return childrenOf(node);
    }
  }
  return children;
}
