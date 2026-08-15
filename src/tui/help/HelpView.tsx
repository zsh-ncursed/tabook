import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, KeyAction } from '../../config/defaults.js';
import { KEY_ACTIONS } from '../../config/defaults.js';
import { actionLabel, createActionResolver, resolveKeyName } from '../keymap.js';
import { useTerminalSize } from '../useTerminalSize.js';
import { Modal } from '../components/Modal.js';
import { forceRedraw } from '../screenRefresh.js';
import { COMMANDS } from '../commands.js';

export interface HelpViewProps {
  config: Config;
  theme: Theme;
  screen?: 'library' | 'reader' | 'opds';
  onClose?: () => void;
}

// Presentational-only. Esc to close is handled by the parent (App.tsx) to
// avoid Ink's setRawMode reference-count race (see ReaderView for rationale).
// j/k scrolling is handled here via useInput.
export function HelpView(props: HelpViewProps): React.JSX.Element {
  const { config, theme, screen, onClose } = props;
  const [width, height] = useTerminalSize();
  const [scroll, setScroll] = useState(0);
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  // Scroll keys go through the configurable keymap (move_cursor_up/down,
  // go_to_start/end, page_up/down) like every other list; users who rebind
  // j/k get their keys here too.
  const resolver = useMemo(() => createActionResolver(config), [config]);

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

  const visibleCmds = screen ? COMMANDS.filter((c) => c.screens.includes(screen)) : COMMANDS;
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
          {lc ? <CmdRow theme={theme} cmd={lc.usage} desc={lc.desc} /> : null}
        </Box>
        <Box flexDirection="column" width={cmdColW}>
          {rc ? <CmdRow theme={theme} cmd={rc.usage} desc={rc.desc} /> : null}
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
      j/k — navigate · enter/l — open entry/download · d — queue download (sequential, background) ·
      x — downloads queue · / — search · u/h — up · n/p — next/prev page · c — switch catalog · esc
      — back · q — quit
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
    if (keyName === null) return;
    const action = resolver.feed(keyName);
    switch (action) {
      case 'back':
        onClose?.();
        forceRedraw();
        return;
      case 'move_cursor_down':
        setScroll((s) => Math.min(maxScroll, s + 1));
        return;
      case 'move_cursor_up':
        setScroll((s) => Math.max(0, s - 1));
        return;
      case 'go_to_start':
        setScroll(0);
        return;
      case 'go_to_end':
        setScroll(maxScroll);
        return;
      case 'page_down':
        setScroll((s) => Math.min(maxScroll, s + Math.max(1, viewport - 2)));
        return;
      case 'page_up':
        setScroll((s) => Math.max(0, s - Math.max(1, viewport - 2)));
        return;
      default:
        return;
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
