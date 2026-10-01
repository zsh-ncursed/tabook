import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TtsIndicator } from './TtsIndicator.js';
import { THEMES } from '../../themes/themes.js';

const theme = THEMES['osaka-jade'] ?? Object.values(THEMES)[0]!;

// Реальный вывод piper при ошибке — многострочный traceback с ANSI-кодами.
const REAL_PIPER_ERROR = [
  '\u001b[0;93m2026-10-01 telemetry warning\u001b[m',
  'Traceback (most recent call last):',
  '  File "/home/osha/.local/bin/piper", line 10, in <module>',
  '    sys.exit(main())',
  '  File ".../piper/__main__.py", line 143, in main',
  '    raise ValueError(',
  '        f"Unable to find voice: {model_path}")',
  'ValueError: Unable to find voice: /nonexistent.onnx',
].join('\n');

describe('TtsIndicator error rendering', () => {
  it('does not leak raw ANSI/newlines into the terminal', () => {
    const { lastFrame } = render(
      <TtsIndicator status={{ state: 'error', message: REAL_PIPER_ERROR }} theme={theme} />,
    );
    const frame = lastFrame() ?? '';
    // ANSI escape sequences не должны попадать в экран
    expect(frame).not.toContain('\u001b[0;93m');
    // Многострочный traceback не должен разрывать индикатор на много строк
    const lines = frame.split('\n').filter((l) => l.length > 0);
    console.log('FRAME LINES:', lines.length);
    for (const l of lines) console.log(JSON.stringify(l.slice(0, 80)));
    expect(lines.length).toBeLessThanOrEqual(2);
  });
});
