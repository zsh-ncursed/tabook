const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

export function detectEncoding(data: Uint8Array): string {
  if (
    data.length >= 3 &&
    data[0] === UTF8_BOM[0] &&
    data[1] === UTF8_BOM[1] &&
    data[2] === UTF8_BOM[2]
  ) {
    return 'utf-8';
  }
  if (data.length >= 2 && data[0] === UTF16LE_BOM[0] && data[1] === UTF16LE_BOM[1]) {
    return 'utf-16le';
  }
  if (data.length >= 2 && data[0] === UTF16BE_BOM[0] && data[1] === UTF16BE_BOM[1]) {
    return 'utf-16be';
  }
  const head = Buffer.from(data.subarray(0, Math.min(data.length, 1024))).toString('latin1');
  const m = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/.exec(head);
  if (m) {
    return normalizeEncoding(m[1]!);
  }
  // Heuristic UTF-16 detection without BOM: if the first 2 bytes are a NUL
  // followed by an ASCII char, it's likely UTF-16BE; if reversed, UTF-16LE.
  // XML documents almost always start with '<' (0x3C) or a BOM.
  if (data.length >= 2) {
    if (data[0] === 0x3c && data[1] === 0x00) return 'utf-16le';
    if (data[0] === 0x00 && data[1] === 0x3c) return 'utf-16be';
  }
  return 'utf-8';
}

export function normalizeEncoding(enc: string): string {
  const e = enc.trim().toLowerCase().replace(/[_-]/g, '');
  switch (e) {
    case 'utf8':
    case 'utf':
      return 'utf-8';
    case 'utf16':
    case 'utf16le':
      return 'utf-16le';
    case 'utf16be':
      return 'utf-16be';
    case 'windows1251':
    case 'win1251':
    case 'cp1251':
      return 'windows-1251';
    case 'cp1252':
      return 'windows-1252';
    case 'koi8r':
      return 'koi8-r';
    case 'iso88591':
    case 'latin1':
    case 'latin':
      return 'iso-8859-1';
    default:
      return e;
  }
}

export function decodeXmlBuffer(data: Uint8Array): string {
  const encoding = detectEncoding(data);
  if (encoding === 'utf-8') {
    let bytes = data;
    if (
      bytes.length >= 3 &&
      bytes[0] === UTF8_BOM[0] &&
      bytes[1] === UTF8_BOM[1] &&
      bytes[2] === UTF8_BOM[2]
    ) {
      bytes = bytes.subarray(3);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(data);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(data);
  }
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isZipBuffer(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;
}
