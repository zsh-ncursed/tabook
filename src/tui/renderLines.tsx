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

export function renderLine(line: TextLine, theme: Theme): React.ReactNode {
  if (line.role === 'empty' || line.spans.length === 0) {
    return (
      <Text key={`${line.blockIndex}-${line.charOffset}`} color={theme.colors.text}>
        {'\u00a0'}
      </Text>
    );
  }
  const color = roleColor(theme, line.role);
  return (
    <Text
      key={`${line.blockIndex}-${line.charOffset}-${line.role}`}
      color={color}
      bold={roleBold(line.role)}
      italic={roleItalic(line.role)}
    >
      {' '.repeat(line.indent)}
      {line.prefix}
      {line.spans.map((span, i) => (
        <Text
          key={i}
          color={span.link ? theme.colors.link : color}
          backgroundColor={span.highlight ? theme.colors.searchHighlight : undefined}
          bold={span.bold}
          italic={span.italic}
          underline={span.underline || span.link}
          inverse={!!span.highlight}
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}
