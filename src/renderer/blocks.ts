import type { Block, Inline } from '../formats/model.js';

function inlineText(inlines: Inline[]): string {
  let out = '';
  const walk = (nodes: Inline[]): void => {
    for (const inline of nodes) {
      switch (inline.kind) {
        case 'text':
          out += inline.text;
          break;
        case 'bold':
        case 'italic':
        case 'underline':
        case 'strike':
        case 'link':
          walk(inline.children);
          break;
        case 'code':
          out += inline.text;
          break;
        case 'image':
          out += inline.alt;
          break;
        case 'lineBreak':
          out += ' ';
          break;
      }
    }
  };
  walk(inlines);
  return out;
}

export function blockToPlainText(block: Block): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'annotation':
    case 'epigraph':
      return inlineText(block.children);
    case 'list': {
      const parts: string[] = [];
      for (const item of block.items) {
        const text = inlineText(item.children);
        if (text) parts.push(text);
        for (const nested of item.nested) {
          const nestedText = blockToPlainText(nested);
          if (nestedText) parts.push(nestedText);
        }
      }
      return parts.join('\n');
    }
    case 'table':
      return block.rows
        .flat()
        .map((cell) => inlineText(cell))
        .join(' ');
    case 'poem':
      return block.stanzas
        .flatMap((stanza) => stanza.lines.map((line) => inlineText(line)))
        .join('\n');
    case 'image':
      return block.alt;
    case 'empty':
      return '';
  }
}
