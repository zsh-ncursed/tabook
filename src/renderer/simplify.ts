import type { Block, Inline, ListItem } from '../formats/model.js';

export function simplifyBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    result.push(...simplifyBlock(block));
  }
  return result;
}

function simplifyBlock(block: Block): Block[] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'code':
      return [block];
    case 'list':
      return block.items.flatMap(simplifyItem);
    case 'quote':
    case 'epigraph':
    case 'annotation':
      return [{ type: 'paragraph', children: block.children }];
    case 'poem':
      return block.stanzas.map((stanza) => ({
        type: 'paragraph' as const,
        children: stanza.lines.flatMap((line, i) => {
          const separator: Inline[] = i > 0 ? [{ kind: 'text' as const, text: ' ' }] : [];
          return [...separator, ...line];
        }),
      }));
    case 'table':
      return block.rows.map((cells) => ({
        type: 'paragraph' as const,
        children: cells.flatMap((cell, i) => {
          const sep: Inline[] = i > 0 ? [{ kind: 'text' as const, text: ' | ' }] : [];
          return [...sep, ...cell];
        }),
      }));
    case 'image':
    case 'empty':
      return [];
  }
}

function simplifyItem(item: ListItem): Block[] {
  const result: Block[] = [
    {
      type: 'paragraph',
      children: item.children.length > 0 ? item.children : [{ kind: 'text', text: '' }],
    },
  ];
  for (const nested of item.nested) {
    result.push(...simplifyBlock(nested));
  }
  return result;
}
