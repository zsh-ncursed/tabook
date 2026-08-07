import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { ListModal } from './ListModal.js';
import type { Theme } from '../../themes/themes.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';

const theme: Theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;

const items = [
  { id: 1, label: 'First' },
  { id: 2, label: 'Second' },
  { id: 3, label: 'Third' },
];

// Wait for a condition to be true, polling every 10ms, up to 500ms.
async function waitFor(fn: () => void, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      fn();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  fn(); // final attempt — throws with the real assertion error
}

describe('ListModal escape behavior', () => {
  it('calls onClose when escape is pressed', async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <ListModal theme={theme} title="Test" items={items} onSelect={() => {}} onClose={onClose} />,
    );
    // Wait for useInput effect to subscribe before writing
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('\u001b');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not call onClose on q (escape-only)', async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <ListModal theme={theme} title="Test" items={items} onSelect={() => {}} onClose={onClose} />,
    );
    stdin.write('q');
    await new Promise((r) => setTimeout(r, 100));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on escape after being reopened (bug repro)', async () => {
    // Reproduce the reported bug: open modal, close with esc, reopen, esc
    // again. The second esc should close the modal, not be swallowed.
    const closeCount = { value: 0 };

    function ReopenHarness({ open }: { open: boolean }) {
      return open ? (
        <ListModal
          theme={theme}
          title="Test"
          items={items}
          onSelect={() => {}}
          onClose={() => {
            closeCount.value += 1;
          }}
        />
      ) : (
        <Text>closed</Text>
      );
    }

    // First mount: open=true. Wait for useInput effect to subscribe.
    const { stdin, rerender } = render(<ReopenHarness open={true} />);
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('\u001b');
    await waitFor(() => expect(closeCount.value).toBe(1));

    // Unmount (simulate setMode('reading'))
    rerender(<ReopenHarness open={false} />);
    await new Promise((r) => setTimeout(r, 50));

    // Reopen (simulate setMode('toc')). Wait for new useInput effect.
    rerender(<ReopenHarness open={true} />);
    await new Promise((r) => setTimeout(r, 50));

    // Second escape — should close again
    stdin.write('\u001b');
    await waitFor(() => expect(closeCount.value).toBe(2));
  });
});
