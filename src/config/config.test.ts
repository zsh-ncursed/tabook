import { describe, it, expect } from 'vitest';
import { defaultConfig, KEY_ACTIONS } from './defaults.js';
import {
  parseKey,
  normalizeKeybindings,
  parseTomlConfig,
  serializeConfig,
  KeybindingConflictError,
} from './config.js';
import { ConfigError } from '../utils/errors.js';

describe('parseKey', () => {
  it('trims whitespace', () => {
    expect(parseKey('  j  ')).toBe('j');
  });
  it('lowercases modifier combos', () => {
    expect(parseKey('Ctrl+P')).toBe('ctrl+p');
    expect(parseKey('ALT + n')).toBe('alt+n');
  });
});

describe('normalizeKeybindings', () => {
  it('starts from base bindings and overrides', () => {
    const base = defaultConfig();
    const warnings: string[] = [];
    const result = normalizeKeybindings({ x: 'open_file' }, base, warnings);
    expect(result['j']).toBe('move_cursor_down');
    expect(result['x']).toBe('open_file');
  });

  it('rejects unknown actions with a warning', () => {
    const base = defaultConfig();
    const warnings: string[] = [];
    normalizeKeybindings({ z: 'explode' as never }, base, warnings);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('explode');
  });

  it('allows overriding a default keybinding', () => {
    const base = defaultConfig();
    const warnings: string[] = [];
    const result = normalizeKeybindings({ j: 'scroll_up' }, base, warnings);
    expect(result['j']).toBe('scroll_up');
    expect(warnings).toEqual([]);
  });

  it('throws on conflicting user keybindings (same normalized key, different actions)', () => {
    const base = defaultConfig();
    const warnings: string[] = [];
    expect(() =>
      normalizeKeybindings({ 'Ctrl+J': 'scroll_up', 'ctrl+j': 'page_down' }, base, warnings),
    ).toThrow(KeybindingConflictError);
  });

  it('allows re-mapping the same key to the same action (no-op)', () => {
    const base = defaultConfig();
    const result = normalizeKeybindings({ j: 'move_cursor_down' }, base, []);
    expect(result['j']).toBe('move_cursor_down');
  });

  it('preserves other defaults when overriding one key', () => {
    const base = defaultConfig();
    const result = normalizeKeybindings({ j: 'scroll_up' }, base, []);
    expect(result['k']).toBe('move_cursor_up');
    expect(result['q']).toBe('quit');
    expect(result['j']).toBe('scroll_up');
  });
});

describe('parseTomlConfig', () => {
  it('parses a full config', () => {
    const warnings: string[] = [];
    const config = parseTomlConfig(
      `
theme = "monokai"
db_path = "/tmp/custom.db"

[keybindings]
x = "move_cursor_up"
z = "toggle_simplified"

[typography]
measure = 70
line_spacing = 1

[display]
simplified_mode = true
`,
      defaultConfig(),
      warnings,
    );
    expect(config.theme).toBe('monokai');
    expect(config.dbPath).toBe('/tmp/custom.db');
    expect(config.keybindings['x']).toBe('move_cursor_up');
    expect(config.keybindings['z']).toBe('toggle_simplified');
    expect(config.typography.measure).toBe(70);
    expect(config.display.simplifiedMode).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('clamps out-of-range typography values', () => {
    const warnings: string[] = [];
    const config = parseTomlConfig('[typography]\nmeasure = 99999', defaultConfig(), warnings);
    // clampInt now actually clamps to the [min,max] range rather than falling
    // back to the default — a value of 99999 is clamped to 500.
    expect(config.typography.measure).toBe(500);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('Clamping');
  });

  it('warns on unknown top-level config keys', () => {
    const warnings: string[] = [];
    parseTomlConfig('[typograhy]\nmeasure = 80', defaultConfig(), warnings);
    // "typograhy" is a typo of "typography" — must be surfaced, not silently
    // dropped, so the user notices their config isn't taking effect.
    expect(warnings.some((w) => w.includes('typograhy'))).toBe(true);
  });

  it('parses the justify option from [typography]', () => {
    const warnings: string[] = [];
    const config = parseTomlConfig('[typography]\njustify = true', defaultConfig(), warnings);
    expect(config.typography.justify).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('round-trips justify through serializeConfig', () => {
    const config = defaultConfig();
    config.typography.justify = true;
    const text = serializeConfig(config);
    expect(text).toContain('justify = true');
    const reparsed = parseTomlConfig(text, defaultConfig(), []);
    expect(reparsed.typography.justify).toBe(true);
  });

  it('throws on invalid TOML', () => {
    expect(() => parseTomlConfig('this is not toml ===', defaultConfig(), [])).toThrow(ConfigError);
  });

  it('warns on unknown themes', () => {
    const warnings: string[] = [];
    parseTomlConfig('theme = "neon-rainbow"', defaultConfig(), warnings);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('neon-rainbow');
  });
});

describe('serializeConfig', () => {
  it('round-trips keybindings through TOML', () => {
    const config = defaultConfig();
    config.keybindings['z'] = 'toggle_simplified';
    const text = serializeConfig(config);
    expect(text).toContain('toggle_simplified');
    const warnings: string[] = [];
    const reparsed = parseTomlConfig(text, defaultConfig(), warnings);
    expect(reparsed.keybindings['z']).toBe('toggle_simplified');
  });
});

describe('KEY_ACTIONS', () => {
  it('contains all default bindings', () => {
    const actions = Object.values(defaultConfig().keybindings);
    for (const action of actions) expect(KEY_ACTIONS).toContain(action);
  });
});
