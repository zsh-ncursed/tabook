import { describe, it, expect } from 'vitest';
import { buildChunks, isSpeakable, type ChunkSource } from './chunking.js';

// Простой источник чанков из массива текстов — имитирует ReaderSession.blocks.
function sourceOf(texts: string[]): ChunkSource {
  let pos = 0;
  const starts: number[] = [];
  for (const t of texts) {
    starts.push(pos);
    pos += t.length;
  }
  return {
    blockCount: texts.length,
    blockText: (i) => texts[i] ?? '',
    blockCharStart: (i) => starts[i] ?? 0,
    blockRole: (i) => (texts[i] === '' ? 'empty' : 'paragraph'),
  };
}

describe('buildChunks', () => {
  it('builds one chunk per non-empty block', () => {
    const src = sourceOf(['Hello world.', 'Second paragraph.', '', 'Third.']);
    const { chunks } = buildChunks(src, { startChar: 0 });
    expect(chunks).toHaveLength(3); // пустой блок пропускается
    expect(chunks[0]!.text).toBe('Hello world.');
    expect(chunks[0]!.startChar).toBe(0);
    expect(chunks[1]!.text).toBe('Second paragraph.');
    expect(chunks[1]!.startChar).toBe('Hello world.'.length);
    expect(chunks[2]!.text).toBe('Third.');
  });

  it('starts mid-block when startChar is inside a block', () => {
    const src = sourceOf(['One two three four.']);
    const { chunks } = buildChunks(src, { startChar: 8 }); // внутри первого блока
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startChar).toBe(8);
    expect(chunks[0]!.text).toBe('three four.');
  });

  it('honors endChar', () => {
    const src = sourceOf(['AAAAAAAAAA', 'BBBBBBBBBB']);
    const { chunks } = buildChunks(src, { startChar: 0, endChar: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe('AAAAAAAAAA');
  });

  it('splits long blocks at sentence boundaries', () => {
    const sentence = 'This is a sentence. ';
    const long = sentence.repeat(150); // ~3000 chars > maxChunkChars 2000
    const src = sourceOf([long]);
    const { chunks } = buildChunks(src, { startChar: 0, maxChunkChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    // Ни один чанк не длиннее максимума (с точностью до предложения)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(200 + 40);
    }
    // Склеивание чанков (с пробелом на стыке — пауза между чанками) восстанавливает текст
    expect(chunks.map((c) => c.text).join(' ')).toBe(long.trim());
  });

  it('returns nothing for an empty book', () => {
    const src = sourceOf(['', '']);
    const { chunks } = buildChunks(src, { startChar: 0 });
    expect(chunks).toHaveLength(0);
  });
});

describe('isSpeakable', () => {
  it('accepts normal text', () => {
    expect(isSpeakable('Привет, мир!')).toBe(true);
    expect(isSpeakable('Chapter 12')).toBe(true);
    expect(isSpeakable('混合 text 42')).toBe(true);
  });
  it('rejects punctuation-only snippets (no phonemes → engine crash)', () => {
    expect(isSpeakable('.')).toBe(false);
    expect(isSpeakable('!?')).toBe(false);
    expect(isSpeakable('...')).toBe(false);
    expect(isSpeakable('   ')).toBe(false);
    expect(isSpeakable('')).toBe(false);
  });
});
