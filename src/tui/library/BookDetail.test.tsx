import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { BookDetail } from './BookDetail.js';
import { defaultConfig } from '../../config/defaults.js';
import { THEMES } from '../../themes/themes.js';
import { ImageLayer, imageLayer, ImageLayerContext } from '../imageLayer.js';
import { FB2_SAMPLE } from '../../formats/test-utils.js';
import type { BookRecord } from '../../db/db.js';

const theme = THEMES[defaultConfig().theme] ?? THEMES['dracula']!;
const config = defaultConfig();

let dir: string;
let book: BookRecord;

beforeEach(() => {
  // FB2_SAMPLE has a cover binary (id="cover.jpg") — parseBookFile reads the
  // file and populates resources + metadata.coverKey.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabook-detail-test-'));
  const filePath = path.join(dir, 'cover.fb2');
  fs.writeFileSync(filePath, FB2_SAMPLE, 'utf8');
  book = {
    id: 1,
    path: filePath,
    filename: 'cover.fb2',
    format: 'fb2',
    size: fs.statSync(filePath).size,
    title: 'Test Book',
    authorsText: 'John Doe',
    seriesText: '',
    genres: [],
    coverKey: 'cover.jpg',
    annotation: '',
    addedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    progressPercent: null,
    lastOpenedAt: null,
    progressPosition: null,
    authors: [],
  } as BookRecord;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeProps(overrides: Partial<Parameters<typeof BookDetail>[0]> = {}) {
  return {
    book,
    config,
    theme,
    onRead: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('BookDetail cover vs App-level overlays', () => {
  it('draws the cover when no overlay is open', async () => {
    // Force the facade's start() to succeed so update() is reachable (in the
    // test env no terminal backend exists, so it returns false by default).
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    render(<BookDetail {...makeProps()} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(updateSpy).toHaveBeenCalledWith(
      [{ identifier: 'cover', x: 2, y: 5, width: 16, height: 14, src: 'cover.jpg' }],
      expect.any(Map),
    );
  });

  it('drops the cover while an App-level overlay (inputDisabled) is open', async () => {
    vi.spyOn(imageLayer, 'start').mockReturnValue(true);
    const updateSpy = vi.spyOn(imageLayer, 'update');
    const clearSpy = vi.spyOn(imageLayer, 'clear');
    render(<BookDetail {...makeProps({ inputDisabled: true })} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('BookDetail image layer injection', () => {
  it('draws the cover on a provided instance, not the module singleton', async () => {
    const custom = new ImageLayer();
    vi.spyOn(custom, 'start').mockReturnValue(true);
    const customUpdate = vi.spyOn(custom, 'update');
    const singletonUpdate = vi.spyOn(imageLayer, 'update');
    render(
      <ImageLayerContext.Provider value={custom}>
        <BookDetail {...makeProps()} />
      </ImageLayerContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(customUpdate).toHaveBeenCalledWith(
      [{ identifier: 'cover', x: 2, y: 5, width: 16, height: 14, src: 'cover.jpg' }],
      expect.any(Map),
    );
    expect(singletonUpdate).not.toHaveBeenCalled();
  });
});
