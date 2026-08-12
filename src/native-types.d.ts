/* tslint:disable */
/* eslint-disable */

/* Hand-written type declarations for @tabook/native (phase 0-4). */

export declare function hello(): string

// text.rs
export declare function displayWidth(input: string): number
export declare function decodeEntities(input: string): string
export declare function normalizeWhitespace(input: string): string
export declare function stripHtml(html: string): string
export declare function truncate(input: string, maxLength: number, suffix?: string): string
export declare function truncateW(text: string, max: number): string
export declare function splitChars(input: string): string[]

// encoding.rs
export declare function detectEncoding(data: Buffer | Uint8Array): string
export declare function normalizeEncoding(enc: string): string
export declare function decodeXmlBuffer(data: Buffer | Uint8Array): string
export declare function fileExtension(name: string): string
export declare function isZipBuffer(data: Buffer | Uint8Array): boolean

// zip.rs
export interface ZipEntryInfo {
  name: string
  size: number
}
export declare class ZipArchiveHandle {
  readonly entries: ZipEntryInfo[]
  read(name: string): Buffer
}
export declare function openZip(data: Buffer | Uint8Array): ZipArchiveHandle

// xml.rs
export declare function parseXml(text: string): void

// formats_index.rs
export declare function detectFormat(data: Buffer | Uint8Array, name: string): string
export declare function parseBookFile(filePath: string): ParsedBook
export declare function invalidateBookCache(): void

// fb2/parser.rs
export declare function parseFb2Buffer(data: Buffer | Uint8Array, filePath: string): ParsedBook
export declare function parseFb2Metadata(data: Buffer | Uint8Array, filePath: string): BookMetadata

// epub/parser.rs
export declare function parseEpubBuffer(data: Buffer | Uint8Array, filePath: string): ParsedBook
export declare function parseEpubMetadata(data: Buffer | Uint8Array, filePath: string): BookMetadata

// opds_parser.rs
export declare function parseOpdsAtom(text: string): void

// model.rs
export interface Author {
  firstName: string
  lastName: string
  middleName?: string
  nickname?: string
}
export interface SeriesInfo {
  name: string
  number?: number
}
export interface BookMetadata {
  title: string
  authors: Author[]
  series?: SeriesInfo
  genres: string[]
  annotation: string
  lang?: string
  coverKey?: string
  publisher?: string
  isbn?: string
  year?: number
}
export interface TocEntry {
  id: string
  label: string
  level: number
  blockIndex: number
}
export interface Inline {
  kind: string
  text?: string
  children?: Inline[]
  href?: string
  src?: string
  alt?: string
}
export interface ListItem {
  children: Inline[]
  nested: Block[]
}
export interface Stanza {
  lines: Inline[][]
}
export interface Block {
  type: string
  children?: Inline[]
  level?: number
  ordered?: boolean
  items?: ListItem[]
  headers?: Inline[][]
  rows?: Inline[][][]
  stanzas?: Stanza[]
  src?: string
  alt?: string
  title?: string
}
export interface ResourceEntry {
  key: string
  data: Uint8Array
}
export interface ParsedBook {
  format: string
  path: string
  filename: string
  size: number
  metadata: BookMetadata
  toc: TocEntry[]
  content: Block[]
  resources: ResourceEntry[]
}