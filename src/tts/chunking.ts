import type { LineRole } from '../renderer/layout.js';
import type { TtsChunk } from './types.js';

/**
 * Источник данных для сборки чанков. Отделён от ReaderSession/BookLayout,
 * чтобы функция была чистой и юнит-тестируемой: интеграционный слой
 * предоставляет блоки книги и их тексты/позиции.
 */
export interface ChunkSource {
  readonly blockCount: number;
  /** Чистый текст блока (без стилей/маркеров), например blockToPlainText. */
  blockText(i: number): string;
  /** Глобальная позиция начала блока (charOffset). */
  blockCharStart(i: number): number;
  /** Смысловая роль блока (для пауз) или undefined. */
  blockRole(i: number): LineRole | undefined;
}

export interface ChunkBuildOptions {
  /** Откуда начать озвучку (charOffset). */
  startChar: number;
  /** До какой позиции читать (конец книги по умолчанию). */
  endChar?: number;
  /** Максимум символов в одном чанке; длинные режутся по предложениям. */
  maxChunkChars?: number;
}

export interface ChunkBuildResult {
  chunks: TtsChunk[];
  /** Индекс чанка, с которого начинается озвучка (первого, что содержит startChar). */
  startIndex: number;
}

const DEFAULT_MAX_CHUNK = 2000;
// Границы предложений для разбивки длинных абзацев (без ломки слова).
const SENTENCE_END = /[.!?…。！？]+(\s|$)/g;

/**
 * Годится ли чанк для синтеза? Текст без букв/цифр (только знаки препинания,
 * пробелы, разметка) не имеет фонем — движок вроде piper падает на нём с
 * Python traceback. Такие «огрызки» после разрезания параграфа отбрасываем.
 */
export function isSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Собрать чанки озвучки от `startChar` до конца книги (или `endChar`).
 * Гранулярность — по блокам (абзацам, заголовкам и т.д.); блок длиннее
 * `maxChunkChars` режется по границам предложений.
 */
export function buildChunks(source: ChunkSource, opts: ChunkBuildOptions): ChunkBuildResult {
  const max = opts.maxChunkChars ?? DEFAULT_MAX_CHUNK;
  const end = opts.endChar ?? Number.POSITIVE_INFINITY;
  const result: TtsChunk[] = [];

  // Найти первый блок, содержащий startChar, и локальную позицию внутри него.
  let firstBlock = source.blockCount;
  for (let i = 0; i < source.blockCount; i++) {
    if (source.blockCharStart(i) <= opts.startChar) firstBlock = i;
    else break;
  }
  if (firstBlock >= source.blockCount) return { chunks: [], startIndex: 0 };

  for (let i = firstBlock; i < source.blockCount; i++) {
    const text = source.blockText(i);
    if (!text.trim()) continue;
    const blockStart = source.blockCharStart(i);
    if (blockStart >= end) break;

    const isFirst = i === firstBlock;
    let local = isFirst ? Math.min(text.length, opts.startChar - blockStart) : 0;
    if (local < 0) local = 0;

    if (blockStart + local >= end) break;
    let remaining = text.slice(local);

    // Максимум текста до endChar
    const textEnd = Math.min(remaining.length, end - blockStart - local);
    remaining = remaining.slice(0, textEnd);
    if (!remaining.trim()) continue;

    if (remaining.length > max) {
      pushSplitBySentence(result, remaining, blockStart + local, source.blockRole(i), max);
    } else {
      result.push({ text: remaining, startChar: blockStart + local, role: source.blockRole(i) });
    }
  }
  return { chunks: result, startIndex: 0 };
}

/** Разбить длинный текст на под-чанки по границам предложений, не ломая слова. */
function pushSplitBySentence(
  out: TtsChunk[],
  text: string,
  base: number,
  role: LineRole | undefined,
  max: number,
): void {
  let cursor = 0;
  while (cursor < text.length) {
    const end = cursor + max;
    if (end >= text.length) {
      out.push({ text: text.slice(cursor).trim(), startChar: base + cursor, role });
      return;
    }
    // Найти границу предложения до end (возможно, за end — но не дальше max*1.2)
    SENTENCE_END.lastIndex = cursor;
    let best = -1;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END.exec(text)) !== null) {
      if (m.index + m[0].length > end + Math.floor(max / 5)) break;
      if (m.index + m[0].length <= cursor) continue;
      best = m.index + m[0].length;
    }
    // Если границы нет — режем вручную на пробеле перед end.
    const cut = best > cursor ? best : lastSpaceBefore(text, cursor, end);
    const chunk = text.slice(cursor, cut).trim();
    if (chunk) out.push({ text: chunk, startChar: base + cursor, role });
    cursor = cut > cursor ? cut : end;
  }
}

function lastSpaceBefore(text: string, from: number, to: number): number {
  for (let i = to; i > from; i--) {
    if (text[i - 1] === ' ') return i;
  }
  return to;
}
