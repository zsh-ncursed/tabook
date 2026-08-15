// Automatic light/dark theme selection from the terminal background color.
//
// Terminals answer an OSC 11 query (`ESC ] 11 ; ? ESC \`) with their
// background color, e.g. `rgb:1e1e/2e2e/2e2e`. We parse it, estimate its
// perceived luminance, and — when the terminal is light — switch to the light
// variant of the configured theme (falling back to a neutral light theme).
import { THEMES } from '../themes/themes.js';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

// Parse an OSC 11 color response. Standard format is `rgb:rrrr/gggg/bbbb`
// with 1-4 hex digits per channel (xterm pads to 4); some terminals reply
// with `#rrggbb`. Returns null for anything unrecognized.
export function parseOsc11Color(value: string): RgbColor | null {
  const trimmed = value.trim();
  const rgbMatch = trimmed.match(
    /^rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})$/,
  );
  if (rgbMatch) {
    const channel = (hex: string): number => {
      const max = Math.pow(16, hex.length) - 1;
      return Math.round((parseInt(hex, 16) / max) * 255);
    };
    return { r: channel(rgbMatch[1]!), g: channel(rgbMatch[2]!), b: channel(rgbMatch[3]!) };
  }
  const hexMatch = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const n = parseInt(hexMatch[1]!, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  return null;
}

/**
 * Query the terminal's background color over OSC 11. Resolves null when the
 * terminal does not answer (non-TTY, unsupported terminal, or timeout).
 * Only meaningful when stdout is a TTY; callers decide whether to invoke it.
 */
export function queryTerminalBackground(timeoutMs = 250): Promise<RgbColor | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RgbColor | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      // OSC 11 response: ESC ] 11 ; <color> ST|BEL
      const match = text.match(/\x1b\]11;([^\x07\x1b]+)(?:\x1b\\|\x07)/);
      if (match?.[1]) {
        const color = parseOsc11Color(match[1]);
        if (color) finish(color);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      // Restore the canonical mode ink expects when it starts rendering.
      try {
        process.stdin.setRawMode(false);
      } catch {
        // stdin already closed or not a TTY — nothing to restore.
      }
    };
    // The query must run in raw mode: in canonical mode a terminal's OSC 11
    // response (no trailing newline) sits in the line-discipline buffer and
    // never reaches the app — the auto-theme query would silently time out.
    try {
      process.stdin.setRawMode(true);
    } catch {
      // stdin is not a TTY — nothing will answer anyway.
      finish(null);
      return;
    }
    process.stdin.on('data', onData);
    process.stdin.resume();
    // Query with ST terminator (some terminals answer to BEL too — handled above).
    process.stdout.write('\x1b]11;?\x1b\\');
  });
}

// Perceived luminance of an sRGB color, 0 (black) .. 1 (white), using the
// standard NTSC/ITU-R BT.601 weights. The exact formula is not critical — we
// only need a robust light/dark decision.
export function colorLuminance(bg: RgbColor): number {
  return (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
}

/**
 * Pick a theme for a given terminal background:
 * - dark background → keep the configured theme (user's explicit choice);
 * - light background → the `${theme}-light` variant when one exists
 *   (github → github-light, gruvbox → gruvbox-light, …), else a neutral
 *   light default.
 */
export function pickThemeForBackground(configTheme: string, bg: RgbColor): string {
  if (colorLuminance(bg) < 0.5) return configTheme;
  const lightVariant = `${configTheme}-light`;
  return THEMES[lightVariant] ? lightVariant : 'github-light';
}

/**
 * Startup helper: returns the theme to use, or undefined when the configured
 * theme already fits the terminal background (no override needed).
 */
export function terminalThemeName(configTheme: string, bg: RgbColor | null): string | undefined {
  if (!bg) return undefined;
  const picked = pickThemeForBackground(configTheme, bg);
  return picked === configTheme ? undefined : picked;
}
