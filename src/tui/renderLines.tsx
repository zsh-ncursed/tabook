import React from 'react';
import { Text } from 'ink';
import type { Theme } from '../themes/themes.js';
import type { LineRole, TextLine } from '../renderer/layout.js';

export function roleColor(theme: Theme, role: LineRole): string {
  switch (role) {
    case 'heading1':
    case 'heading2':
    case 'heading3':
    case 'heading4':
    case 'heading5':
    case 'heading6':
      return theme.colors.heading;
    case 'quote':
    case 'epigraph':
    case 'annotation':
    case 'image':
    case 'code':
      return theme.colors.dim;
    case 'tableHeader':
      return theme.colors.tableHeader;
    default:
      return theme.colors.text;
  }
}

export function roleBold(role: LineRole): boolean {
  return role.startsWith('heading') || role === 'tableHeader';
}

export function roleItalic(role: LineRole): boolean {
  return role === 'epigraph' || role === 'annotation' || role === 'quote';
}

// A character range (in RENDERED column coordinates — the leading indent and
// prefix spaces count) to draw with the selection highlight. Mouse drag in
// the reader maps terminal cells to these coordinates, so the highlight
// lines up exactly with what the pointer crossed.
export interface SelectionRange {
  from: number;
  to: number;
}

// Split a span's text into the parts outside/inside a character range
// [from, to), where `start` is the range offset of the span's first char in
// the rendered line. Returns chunks as { text, selected }.
function splitSelection(
  text: string,
  start: number,
  from: number,
  to: number,
): { text: string; selected: boolean }[] {
  const end = start + text.length;
  const s = Math.max(start, from);
  const e = Math.min(end, to);
  if (s >= e) return [{ text, selected: false }];
  const chunks: { text: string; selected: boolean }[] = [];
  if (s > start) chunks.push({ text: text.slice(0, s - start), selected: false });
  chunks.push({ text: text.slice(s - start, e - start), selected: true });
  if (e < end) chunks.push({ text: text.slice(e - start), selected: false });
  return chunks;
}

export function renderLine(line: TextLine, theme: Theme, sel?: SelectionRange): React.ReactNode {
  if (line.role === 'empty' || line.spans.length === 0) {
    return (
      <Text key={`${line.blockIndex}-${line.charOffset}`} color={theme.colors.text}>
        {'\u00a0'}
      </Text>
    );
  }
  const color = roleColor(theme, line.role);
  // Rendered columns: the indent and prefix are drawn before the spans, so
  // span text starts at indent + prefix length in rendered coordinates.
  const base = line.indent + line.prefix.length;
  let cursor = base;
  const spans: React.ReactNode[] = [];
  for (const span of line.spans) {
    const start = cursor;
    cursor += span.text.length;
    const chunks = sel ? splitSelection(span.text, start, sel.from, sel.to) : null;
    if (!chunks) {
      spans.push(
        <Text
          key={start}
          color={span.link ? theme.colors.link : color}
          backgroundColor={span.highlight ? theme.colors.searchHighlight : undefined}
          bold={span.bold}
          italic={span.italic}
          underline={span.underline || span.link}
          inverse={!!span.highlight}
        >
          {span.text}
        </Text>,
      );
      continue;
    }
    for (const chunk of chunks) {
      spans.push(
        <Text
          key={`${start}-${chunk.selected}`}
          color={span.link ? theme.colors.link : color}
          backgroundColor={
            chunk.selected
              ? theme.colors.searchHighlight
              : span.highlight
                ? theme.colors.searchHighlight
                : undefined
          }
          bold={span.bold}
          italic={span.italic}
          underline={span.underline || span.link}
          inverse={chunk.selected || !!span.highlight}
        >
          {chunk.text}
        </Text>,
      );
    }
  }
  return (
    <Text
      key={`${line.blockIndex}-${line.charOffset}-${line.role}`}
      color={color}
      bold={roleBold(line.role)}
      italic={roleItalic(line.role)}
    >
      {' '.repeat(line.indent)}
      {line.prefix}
      {spans}
    </Text>
  );
}
