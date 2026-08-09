import { describe, it, expect } from 'vitest';
import { parseXhtmlBlocks } from './xhtml.js';
import { parseXml } from '../xml.js';

function parse(fragment: string) {
  return parseXhtmlBlocks(parseXml(`<root>${fragment}</root>`));
}

describe('parseXhtmlBlocks', () => {
  it('parses headings of any level', () => {
    const { blocks } = parse('<h5>Five</h5><h6>Six</h6>');
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 5 });
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 6 });
  });

  it('turns preformatted text into paragraphs', () => {
    const { blocks } = parse('<pre>code block</pre>');
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
  });

  it('emits an empty block for empty paragraphs', () => {
    const { blocks } = parse('<p>   </p>');
    expect(blocks[0]).toEqual({ type: 'empty' });
  });

  it('emits an empty block for hr', () => {
    const { blocks } = parse('<hr/>');
    expect(blocks[0]).toEqual({ type: 'empty' });
  });

  it('parses images with empty src and alt', () => {
    const { blocks } = parse('<img/>');
    expect(blocks[0]).toMatchObject({ type: 'image', src: '', alt: '' });
  });

  it('maps container ids to the first containing block', () => {
    const { blocks, idToBlock } = parse('<div id="d1"><h2 id="h2">Title</h2><p>Body</p></div>');
    expect(blocks).toHaveLength(2);
    expect(idToBlock.get('h2')).toBe(0);
    // TOC link to a container should land on its FIRST content block, not the
    // last — a reader clicking "Chapter 1" expects to see the chapter heading.
    expect(idToBlock.get('d1')).toBe(0);
  });

  it('maps nested containers and figures', () => {
    const { idToBlock } = parse('<figure id="fig"><section id="sec"><p>Cap</p></section></figure>');
    expect(idToBlock.get('sec')).toBe(0);
    expect(idToBlock.get('fig')).toBe(0);
  });

  it('does not map a container id when no block is inside', () => {
    const { idToBlock } = parse('<div id="d2"><hr/></div>');
    expect(idToBlock.has('d2')).toBe(false);
  });

  it('ignores structural tags such as nav and script', () => {
    const { blocks } = parse('<nav><a href="#">x</a></nav><script>var y;</script>');
    expect(blocks).toHaveLength(0);
  });

  it('recurses into unknown tags with children', () => {
    const { blocks } = parse('<custom-tag><p>inner</p></custom-tag>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
  });
});
