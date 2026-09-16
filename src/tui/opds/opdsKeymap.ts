import type { Config, KeyAction } from '../../config/defaults.js';

// OPDS feed verbs used to be hardcoded keys ('d', 'x', 'n', 'p', 'c', 'u') in
// OpdsView — the only inputs in the app that ignored the configurable
// keymap. They now go through the same resolver as everything else.
//
// These bindings are layered ON TOP of the user's global keybindings for the
// OPDS view only: in this context the feed verbs own these keys. That
// resolves the conflict with the global defaults ('d' → delete_from_library
// in the library, 'n' → search_next in the reader), which must NOT bleed into
// the OPDS view.
//
// To reassign a verb, bind another key to its action in config.toml, e.g.
//   [keybindings]
//   D = "opds_download"
// The new key then queues a download; the default 'd' keeps its OPDS meaning
// too (harmless duplication), never its library meaning, in this view.

const OPDS_VIEW_BINDINGS: Record<string, KeyAction> = {
  d: 'opds_download',
  x: 'opds_downloads',
  n: 'opds_next_page',
  p: 'opds_prev_page',
  c: 'opds_catalogs',
  // 'u' is an alias of 'back' ("up" the feed stack); reuse the existing
  // action instead of inventing an OPDS-specific one.
  u: 'back',
};

export const OPDS_ACTIONS: readonly KeyAction[] = [
  'opds_download',
  'opds_downloads',
  'opds_next_page',
  'opds_prev_page',
  'opds_catalogs',
];

/**
 * Keymap for the OPDS view: user bindings, with the feed verbs layered on top
 * at their default letters. Any key the user bound to an OPDS action is kept
 * as-is, so rebinds work.
 */
export function opdsKeybindings(config: Config): Record<string, KeyAction> {
  return { ...config.keybindings, ...OPDS_VIEW_BINDINGS };
}

/** First key bound to an OPDS action in the layered keymap, for hints/help. */
export function opdsKeyFor(config: Config, action: KeyAction): string | undefined {
  if (!OPDS_ACTIONS.includes(action)) return undefined;
  for (const [k, a] of Object.entries(opdsKeybindings(config))) {
    if (a === action) return k;
  }
  return undefined;
}
