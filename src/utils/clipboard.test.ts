import { describe, it, expect } from 'vitest';
import { buildOsc52Clipboard } from './clipboard.js';

describe('buildOsc52Clipboard', () => {
  it('base64-encodes the payload into an OSC 52 clipboard write', () => {
    const esc = buildOsc52Clipboard('hello');
    expect(esc).toBe(`\x1b]52;c;${Buffer.from('hello', 'utf8').toString('base64')}\x1b\\`);
  });

  it('handles non-ASCII and multi-line text', () => {
    const text = 'привет\nмир';
    expect(buildOsc52Clipboard(text)).toContain(Buffer.from(text, 'utf8').toString('base64'));
  });
});
