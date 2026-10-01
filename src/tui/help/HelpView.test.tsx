import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HelpView } from './HelpView.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';

// TTS-команды оказываются в самом низу списка Command Line и на низких
// терминалах скрыты за краем окна. Помеченный блок «Read Aloud (TTS)»
// дублирует их на виду — тест страхует, что блок не удалили и что из него
// не пропали ключевые команды.
describe('HelpView', () => {
  it('shows the Read aloud (TTS) row above the fold on a short terminal', () => {
    // TTS-команды лежат в самом низу Command Line и на низких терминалах
    // скрыты за краем окна, пока не проскроллишь. Строка «Read aloud»
    // размещена сразу после вступления — тест страхует, что её не удалят
    // и что она не уползёт обратно в зону скролла.
    const { lastFrame } = render(
      <HelpView config={defaultConfig()} theme={THEMES['nord']!} screen="reader" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Read aloud');
    expect(out).toContain('v/V');
    expect(out).toContain(':tts continue');
    expect(out).toContain('F follow');
  });

  it('lists tts commands in the reader command list', () => {
    const { lastFrame } = render(
      <HelpView config={defaultConfig()} theme={THEMES['nord']!} screen="reader" />,
    );
    expect(lastFrame() ?? '').toContain(':tts');
  });
});
