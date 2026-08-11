export type Inline =
  | InlineText
  | InlineBold
  | InlineItalic
  | InlineUnderline
  | InlineStrike
  | InlineCode
  | InlineLink
  | InlineImage
  | InlineLineBreak;

export interface InlineText {
  kind: 'text';
  text: string;
}

export interface InlineBold {
  kind: 'bold';
  children: Inline[];
}

export interface InlineItalic {
  kind: 'italic';
  children: Inline[];
}

export interface InlineUnderline {
  kind: 'underline';
  children: Inline[];
}

export interface InlineStrike {
  kind: 'strike';
  children: Inline[];
}

export interface InlineCode {
  kind: 'code';
  text: string;
}

export interface InlineLink {
  kind: 'link';
  href: string;
  children: Inline[];
}

export interface InlineImage {
  kind: 'image';
  src: string;
  alt: string;
}

export interface InlineLineBreak {
  kind: 'lineBreak';
}

export type Block =
  | ParagraphBlock
  | CodeBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | TableBlock
  | ImageBlock
  | PoemBlock
  | AnnotationBlock
  | EpigraphBlock
  | EmptyBlock;

export interface ParagraphBlock {
  type: 'paragraph';
  children: Inline[];
}

export interface CodeBlock {
  type: 'code';
  children: Inline[];
}

export interface HeadingBlock {
  type: 'heading';
  level: number;
  children: Inline[];
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
}

export interface ListItem {
  children: Inline[];
  nested: Block[];
}

export interface QuoteBlock {
  type: 'quote';
  children: Inline[];
}

export interface TableBlock {
  type: 'table';
  headers: Inline[][];
  rows: Inline[][][];
}

export interface ImageBlock {
  type: 'image';
  src: string;
  alt: string;
  title?: string;
}

export interface PoemBlock {
  type: 'poem';
  stanzas: Stanza[];
}

export interface Stanza {
  lines: Inline[][];
}

export interface AnnotationBlock {
  type: 'annotation';
  children: Inline[];
}

export interface EpigraphBlock {
  type: 'epigraph';
  children: Inline[];
}

export interface EmptyBlock {
  type: 'empty';
}

export interface Author {
  firstName: string;
  lastName: string;
  middleName?: string;
  nickname?: string;
}

export interface SeriesInfo {
  name: string;
  number?: number;
}

export interface BookMetadata {
  title: string;
  authors: Author[];
  series?: SeriesInfo;
  genres: string[];
  annotation: string;
  lang?: string;
  coverKey?: string;
  publisher?: string;
  isbn?: string;
  year?: number;
}

export interface TocEntry {
  id: string;
  label: string;
  level: number;
  blockIndex: number;
}

export interface ParsedBook {
  format: 'fb2' | 'epub';
  path: string;
  filename: string;
  size: number;
  metadata: BookMetadata;
  toc: TocEntry[];
  content: Block[];
  resources: Map<string, Uint8Array>;
}

export function authorDisplayName(author: Author): string {
  // Prefer nickname when present — it preserves the publisher's original
  // formatting (e.g. EPUB stores "Jane Roe" as a single string, not split
  // into lastName/firstName the way FB2 does).
  if (author.nickname) return author.nickname;
  const parts: string[] = [];
  if (author.lastName) parts.push(author.lastName);
  if (author.firstName) parts.push(author.firstName);
  if (author.middleName) parts.push(author.middleName);
  return parts.join(' ');
}

export function joinAuthors(authors: Author[]): string {
  return authors.map(authorDisplayName).filter(Boolean).join(', ');
}

export function formatSeries(series?: SeriesInfo): string | undefined {
  if (!series || !series.name) return undefined;
  if (series.number !== undefined) {
    return `${series.name} #${series.number}`;
  }
  return series.name;
}
