import React from 'react';
import { Box, Text } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { OpdsEntry } from '../../opds/model.js';
import { pickAcquisitionLink } from '../../opds/model.js';
import { truncateW } from '../../utils/text.js';

export function EntryDetail(props: {
  entry: OpdsEntry;
  theme: Theme;
  width: number;
  height: number;
}): React.JSX.Element {
  const { entry, theme, width, height } = props;
  const textWidth = Math.max(30, width - 4);
  const lines: Array<{ label: string; value: string }> = [];
  lines.push({ label: 'Title', value: entry.title });
  if (entry.authors.length > 0) {
    lines.push({ label: 'Author', value: entry.authors.map((a) => a.name).join(', ') });
  }
  if (entry.language) lines.push({ label: 'Language', value: entry.language });
  if (entry.publisher) lines.push({ label: 'Publisher', value: entry.publisher });
  if (entry.issued) lines.push({ label: 'Year', value: entry.issued });
  if (entry.identifier) lines.push({ label: 'ISBN', value: entry.identifier });
  const acqLink = pickAcquisitionLink(entry.acquisitionLinks);
  if (acqLink?.type) {
    lines.push({ label: 'Format', value: acqLink.type });
  }
  if (entry.categories.length > 0) {
    lines.push({ label: 'Subjects', value: entry.categories.map((c) => c.term).join(', ') });
  }
  const summary = entry.summary ?? entry.content ?? '';
  const summaryLines = wrapText(summary, textWidth);
  const maxLines = Math.max(5, height - lines.length - 8);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {lines.map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text color={theme.colors.dim}>{line.label}: </Text>
          <Text color={theme.colors.text} wrap="truncate">
            {truncateW(line.value, textWidth - line.label.length - 2)}
          </Text>
        </Box>
      ))}
      {summary ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.colors.dim}>Summary:</Text>
          {summaryLines.slice(0, maxLines).map((line, i) => (
            <Text key={i} color={theme.colors.text}>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.colors.accent} bold>
          Press d or enter to download · esc to go back
        </Text>
      </Box>
    </Box>
  );
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
