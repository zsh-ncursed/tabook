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

  it('throws on keybinding conflicts', () => {
    const base = defaultConfig();
    const warnings: string[] = [];
    expect(() => normalizeKeybindings({ j: 'scroll_up' }, base, warnings)).toThrow(
      KeybindingConflictError,
    );
  });

  it('allows re-mapping the same key to the same action', () => {
    const base = defaultConfig();
    const result = normalizeKeybindings({ j: 'move_cursor_down' }, base, []);
    expect(result['j']).toBe('move_cursor_down');
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
    expect(config.typography.measure).toBe(defaultConfig().typography.measure);
    expect(warnings.length).toBe(1);
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
