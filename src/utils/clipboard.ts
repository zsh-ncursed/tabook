// OSC 52 (terminal clipboard): `ESC ] 52 ; c ; <base64> ESC \` puts the text
// into the terminal's clipboard selection. Supported by kitty, alacritty,
// WezTerm, Ghostty and most modern terminals (often configurable); terminals
// without support silently ignore the sequence. No external tools needed,
// unlike xclip/xsel (which the path prompt uses for reads). The builder is a
// pure function so it is unit-testable.

const OSC = '\x1b]';
const ST = '\x1b\\';

export function buildOsc52Clipboard(text: string): string {
  return `${OSC}52;c;${Buffer.from(text, 'utf8').toString('base64')}${ST}`;
}

/** Write text to the terminal clipboard (OSC 52). Returns the escape
 * sequence that was written. */
export function copyToClipboard(text: string): string {
  const esc = buildOsc52Clipboard(text);
  try {
    process.stdout.write(esc);
  } catch {
    // stdout closed — nothing sensible to do
  }
  return esc;
}
