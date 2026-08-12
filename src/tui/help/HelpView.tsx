import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import { KEY_ACTIONS } from '../../config/defaults.js';
import { actionLabel } from '../keymap.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { Modal } from '../components/Modal.js';
import { resolveKeyName } from '../keymap.js';
import { forceRedraw } from '../screenRefresh.js';

export interface HelpViewProps {
  config: Config;
  theme: Theme;
  screen?: 'library' | 'reader' | 'opds';
  onClose?: () => void;
}

interface CommandDef {
  cmd: string;
  desc: string;
  screens: Array<'library' | 'reader' | 'opds'>;
}

const COMMANDS: CommandDef[] = [
  { cmd: ':open [path]', desc: 'Open a book file (falls back to picker)', screens: ['library', 'reader'] },
  { cmd: ':theme <name>', desc: 'Switch theme (persisted to config)', screens: ['library', 'reader', 'opds'] },
  { cmd: ':themes', desc: 'List available themes', screens: ['library', 'reader', 'opds'] },
  { cmd: ':sort <field>', desc: 'Sort by title, author, added or progress', screens: ['library'] },
  { cmd: ':group', desc: 'Toggle group-by-series', screens: ['library'] },
  { cmd: ':goto <page>', desc: 'Jump to a page (:goto 10% also works)', screens: ['reader'] },
  { cmd: ':simplified', desc: 'Toggle simplified reading mode', screens: ['reader'] },
  { cmd: ':search <query>', desc: 'Search the current book', screens: ['reader'] },
  { cmd: ':config init', desc: 'Write a default config file', screens: ['library', 'reader', 'opds'] },
  { cmd: ':config edit', desc: 'Open config in $EDITOR, reload live', screens: ['library', 'reader', 'opds'] },
  { cmd: ':opds', desc: 'Open the OPDS catalog browser', screens: ['library', 'reader'] },
  { cmd: ':opds add <name> <url> [user] [pass]', desc: 'Add an OPDS catalog', screens: ['library', 'reader', 'opds'] },
  { cmd: ':opds remove <name>', desc: 'Remove an OPDS catalog', screens: ['library', 'reader', 'opds'] },
  { cmd: ':opds list', desc: 'List configured OPDS catalogs', screens: ['library', 'reader', 'opds'] },
  { cmd: ':library add <path>', desc: 'Attach a folder as a library', screens: ['library', 'reader'] },
  { cmd: ':library list', desc: 'List attached folders', screens: ['library', 'reader'] },
  { cmd: ':library scan', desc: 'Rescan all attached folders', screens: ['library', 'reader'] },
  { cmd: ':library remove <path>', desc: 'Detach a folder and remove its books', screens: ['library', 'reader'] },
  { cmd: ':q / :quit', desc: 'Quit', screens: ['library', 'reader', 'opds'] },
];

// Presentational-only. Esc to close is handled by the parent (App.tsx) to
// avoid Ink's setRawMode reference-count race (see ReaderView for rationale).
// j/k scrolling is handled here via useInput.
export function HelpView(props: HelpViewProps): React.JSX.Element {
  const { config, theme, screen, onClose } = props;
  const [width, height] = useTerminalSize();
  const [scroll, setScroll] = useState(0);
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  const keysForAction = (action: KeyAction): string[] => {
    const keys: string[] = [];
    for (const [key, a] of Object.entries(config.keybindings)) {
      if (a === action) keys.push(key);
    }
    return keys.sort((x, y) => x.localeCompare(y));
  };

  const rows = KEY_ACTIONS.map((action) => ({
    action,
    label: actionLabel(action),
    keys: keysForAction(action),
  }));

  const colW = Math.max(30, Math.floor((width - 6) / 2));

  const visibleCmds = screen
    ? COMMANDS.filter((c) => c.screens.includes(screen))
    : COMMANDS;
  const cmdColW = Math.max(34, Math.floor((width - 6) / 2));

  // Build the full content as an array of line-elements so we can slice it
  // for scrolling. Each entry is a renderable React node (a single visual row).
  const keybindingRows: React.ReactNode[] = [];
  const half = Math.ceil(rows.length / 2);
  const leftRows = rows.slice(0, half);
  const rightRows = rows.slice(half);
  const keyRowPairs = Math.max(leftRows.length, rightRows.length);
  for (let i = 0; i < keyRowPairs; i++) {
    const l = leftRows[i];
    const r = rightRows[i];
    keybindingRows.push(
      <Box key={`kb-${i}`} flexDirection="row">
        <Box flexDirection="column" width={colW}>
          {l ? <HelpRow theme={theme} label={l.label} keys={l.keys} /> : null}
        </Box>
        <Box flexDirection="column" width={colW}>
          {r ? <HelpRow theme={theme} label={r.label} keys={r.keys} /> : null}
        </Box>
      </Box>,
    );
  }

  const cmdRows: React.ReactNode[] = [];
  const cmdHalf = Math.ceil(visibleCmds.length / 2);
  const leftCmds = visibleCmds.slice(0, cmdHalf);
  const rightCmds = visibleCmds.slice(cmdHalf);
  const cmdPairs = Math.max(leftCmds.length, rightCmds.length);
  for (let i = 0; i < cmdPairs; i++) {
    const lc = leftCmds[i];
    const rc = rightCmds[i];
    cmdRows.push(
      <Box key={`cmd-${i}`} flexDirection="row">
        <Box flexDirection="column" width={cmdColW}>
          {lc ? <CmdRow theme={theme} cmd={lc.cmd} desc={lc.desc} /> : null}
        </Box>
        <Box flexDirection="column" width={cmdColW}>
          {rc ? <CmdRow theme={theme} cmd={rc.cmd} desc={rc.desc} /> : null}
        </Box>
      </Box>,
    );
  }

  // Total content lines: header + keybindings + command header + commands + opds header + opds text.
  // Each keybinding/cmd row is 1 line; headers and text are 1 line each.
  const contentLines: React.ReactNode[] = [
    <Text key="intro" color={theme.colors.dim} dimColor>
      All keys can be remapped in config.toml via [keybindings]. Vim-like by default.
    </Text>,
    ...keybindingRows,
    <Box key="cmd-header" marginTop={1}>
      <Text color={theme.colors.heading} bold>
        Command Line{screen ? ` (${screen})` : ''}
      </Text>
    </Box>,
    ...cmdRows,
    <Box key="opds-header" marginTop={1}>
      <Text color={theme.colors.heading} bold>
        OPDS Catalogs (in :opds view)
      </Text>
    </Box>,
    <Text key="opds-text" color={theme.colors.dim} dimColor>
      j/k — navigate · enter/l — open entry/download · d — download · / — search · u/h — up · n —
      next page · c — switch catalog · esc — back · q — quit
    </Text>,
  ];

  // Modal chrome: border(2) + paddingY(2) + title(1) + marginY(2) + footer(1) = 8
  const MODAL_CHROME = 8;
  const viewport = Math.max(3, height - MODAL_CHROME - 2);
  const maxScroll = Math.max(0, contentLines.length - viewport);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visibleContent = contentLines.slice(clampedScroll, clampedScroll + viewport);
  const canScrollDown = clampedScroll < maxScroll;
  const canScrollUp = clampedScroll > 0;

  useInput((input, key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === 'escape') {
      onClose?.();
      forceRedraw();
      return;
    }
    if (keyName === 'j' || keyName === 'down') {
      setScroll((s) => Math.min(maxScroll, s + 1));
    } else if (keyName === 'k' || keyName === 'up') {
      setScroll((s) => Math.max(0, s - 1));
    } else if (keyName === 'g') {
      setScroll(0);
    } else if (keyName === 'G') {
      setScroll(maxScroll);
    } else if (keyName === 'pagedown' || keyName === 'space') {
      setScroll((s) => Math.min(maxScroll, s + Math.max(1, viewport - 2)));
    } else if (keyName === 'pageup') {
      setScroll((s) => Math.max(0, s - Math.max(1, viewport - 2)));
    }
  });

  // Reset scroll when the screen context changes.
  useEffect(() => {
    setScroll(0);
  }, [screen]);

  const footer = `j/k scroll${canScrollDown ? '' : ' · at bottom'}${canScrollUp ? '' : ' · at top'} · esc close`;

  return (
    <Modal
      theme={theme}
      title="Help — Keybindings & Commands"
      width={Math.min(width - 2, 100)}
      footer={footer}
    >
      <Box flexDirection="column" height={viewport}>
        {visibleContent}
      </Box>
    </Modal>
  );
}

function CmdRow(props: { theme: Theme; cmd: string; desc: string }): React.JSX.Element {
  const { theme, cmd, desc } = props;
  return (
    <Box>
      <Box width={28}>
        <Text color={theme.colors.accent}>{cmd}</Text>
      </Box>
      <Text color={theme.colors.dim} dimColor>
        {desc}
      </Text>
    </Box>
  );
}

function HelpRow(props: { theme: Theme; label: string; keys: string[] }): React.JSX.Element {
  const { theme, label, keys } = props;
  const keyText = keys.length > 0 ? keys.join(', ') : '(unbound)';
  return (
    <Box>
      <Box width={30}>
        <Text color={theme.colors.text}>{label}</Text>
      </Box>
      <Text color={theme.colors.accent}>{keyText}</Text>
    </Box>
  );
}
