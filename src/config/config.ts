import fs from 'node:fs';
import { parse as parseTomlLib, stringify as stringifyTomlLib } from 'smol-toml';
import type {
  Config,
  DisplayConfig,
  KeyAction,
  StatusBarConfig,
  StatusBarSection,
  TypographyConfig,
} from './defaults.js';
import { defaultConfig, KEY_ACTIONS, STATUSBAR_SECTIONS } from './defaults.js';
import { defaultConfigPath } from '../utils/paths.js';
import { ConfigError } from '../utils/errors.js';
import { themeNames } from '../themes/themes.js';

export class KeybindingConflictError extends ConfigError {
  readonly key: string;
  readonly first: KeyAction;
  readonly second: KeyAction;

  constructor(key: string, first: KeyAction, second: KeyAction) {
    super(`Keybinding conflict for key "${key}": mapped to both "${first}" and "${second}"`);
    this.name = 'KeybindingConflictError';
    this.key = key;
    this.first = first;
    this.second = second;
  }
}

export interface LoadConfigResult {
  config: Config;
  path: string;
  warnings: string[];
}

export function parseKey(key: string): string {
  const trimmed = key.trim().replace(/\s+/g, '');
  if (trimmed.includes('+')) {
    const [mod, ...rest] = trimmed.split('+');
    return `${mod!.toLowerCase()}+${rest.join('+').toLowerCase()}`;
  }
  return trimmed;
}

export function normalizeKeybindings(
  raw: Record<string, unknown>,
  base: Config,
  warnings: string[],
): Record<string, KeyAction> {
  const result: Record<string, KeyAction> = { ...base.keybindings };
  const userKeys = new Set<string>();
  for (const [rawKey, rawAction] of Object.entries(raw)) {
    const key = parseKey(rawKey);
    if (key === '') {
      warnings.push(`Ignoring empty keybinding key "${rawKey}"`);
      continue;
    }
    const action = typeof rawAction === 'string' ? (rawAction as KeyAction) : undefined;
    if (!action || !KEY_ACTIONS.includes(action)) {
      warnings.push(`Ignoring keybinding "${rawKey}": unknown action "${String(rawAction)}"`);
      continue;
    }
    const prev = result[key];
    if (userKeys.has(key) && prev !== action) {
      throw new KeybindingConflictError(key, prev!, action);
    }
    result[key] = action;
    userKeys.add(key);
  }
  return result;
}

export function parseTomlConfig(text: string, base: Config, warnings: string[]): Config {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseTomlLib(text) as unknown as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(`Invalid TOML: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }

  const config = { ...base, keybindings: { ...base.keybindings } };

  // Warn on unknown top-level keys so a typo like [typograhy] is surfaced
  // instead of silently ignored. Catches the common "I set it but nothing
  // changed" confusion at config-load time.
  const knownTop = new Set([
    'theme',
    'db_path',
    'auto_theme',
    'mouse',
    'keybindings',
    'typography',
    'display',
    'statusbar',
  ]);
  for (const key of Object.keys(parsed)) {
    if (!knownTop.has(key)) {
      warnings.push(`Unknown config key "${key}" — ignored`);
    }
  }

  if (typeof parsed.theme === 'string') {
    config.theme = parsed.theme;
    if (!themeNames().includes(parsed.theme) && !parsed.theme.match(/^custom:/)) {
      warnings.push(
        `Theme "${parsed.theme}" is not a built-in theme; custom themes can be defined via "custom-themes"`,
      );
    }
  }

  if (typeof parsed.db_path === 'string' && parsed.db_path.trim() !== '') {
    config.dbPath = parsed.db_path;
  }

  if (typeof parsed.auto_theme === 'boolean') config.autoTheme = parsed.auto_theme;
  if (typeof parsed.mouse === 'boolean') config.mouse = parsed.mouse;

  if (parsed.keybindings && typeof parsed.keybindings === 'object') {
    config.keybindings = normalizeKeybindings(
      parsed.keybindings as Record<string, unknown>,
      config,
      warnings,
    );
  }

  if (parsed.typography && typeof parsed.typography === 'object') {
    const t = parsed.typography as Record<string, unknown>;
    const typo = { ...config.typography } as TypographyConfig;
    if (typeof t.measure === 'number')
      typo.measure = clampInt(t.measure, 20, 500, warnings, 'measure');
    if (typeof t.line_spacing === 'number')
      typo.lineSpacing = clampInt(t.line_spacing, 0, 5, warnings, 'line_spacing');
    if (typeof t.paragraph_indent === 'number')
      typo.paragraphIndent = clampInt(t.paragraph_indent, 0, 20, warnings, 'paragraph_indent');
    if (typeof t.paragraph_spacing === 'number')
      typo.paragraphSpacing = clampInt(t.paragraph_spacing, 0, 5, warnings, 'paragraph_spacing');
    if (typeof t.hyphenation === 'boolean') typo.hyphenation = t.hyphenation;
    if (typeof t.justify === 'boolean') typo.justify = t.justify;
    config.typography = typo;
  }

  if (parsed.display && typeof parsed.display === 'object') {
    const d = parsed.display as Record<string, unknown>;
    const display = { ...config.display } as DisplayConfig;
    if (typeof d.simplified_mode === 'boolean') display.simplifiedMode = d.simplified_mode;
    if (typeof d.respect_publisher_css === 'boolean')
      display.respectPublisherCss = d.respect_publisher_css;
    if (typeof d.show_progress_bar === 'boolean') {
      // Legacy alias: show_progress_bar moved from [display] to [statusbar].
      config.statusbar.showProgressBar = d.show_progress_bar;
    }
    config.display = display;
  }

  if (parsed.statusbar && typeof parsed.statusbar === 'object') {
    const s = parsed.statusbar as Record<string, unknown>;
    const sb: StatusBarConfig = { ...config.statusbar };
    if (Array.isArray(s.left)) sb.left = parseStatusbarSections(s.left, 'left', warnings);
    if (Array.isArray(s.right)) sb.right = parseStatusbarSections(s.right, 'right', warnings);
    if (typeof s.show_progress_bar === 'boolean') sb.showProgressBar = s.show_progress_bar;
    config.statusbar = sb;
  }

  return config;
}

function parseStatusbarSections(
  value: unknown[],
  field: string,
  warnings: string[],
): StatusBarSection[] {
  const out: StatusBarSection[] = [];
  for (const item of value) {
    if (typeof item === 'string' && (STATUSBAR_SECTIONS as readonly string[]).includes(item)) {
      out.push(item as StatusBarSection);
    } else {
      warnings.push(`Ignoring statusbar.${field} section "${String(item)}": unknown`);
    }
  }
  return out;
}

function clampInt(
  value: number,
  min: number,
  max: number,
  warnings: string[],
  field: string,
): number {
  if (!Number.isInteger(value)) {
    warnings.push(`Ignoring typography.${field}: value must be an integer`);
    return defaultConfig().typography[field as keyof TypographyConfig] as number;
  }
  if (value < min || value > max) {
    warnings.push(`Clamping typography.${field} from ${value} to [${min}, ${max}]`);
  }
  return Math.min(max, Math.max(min, value));
}

export function loadConfig(configPath?: string): LoadConfigResult {
  const warnings: string[] = [];
  const path = configPath && configPath.trim() !== '' ? configPath : defaultConfigPath();
  let config = defaultConfig();

  if (fs.existsSync(path)) {
    const text = fs.readFileSync(path, 'utf8');
    config = parseTomlConfig(text, config, warnings);
  } else if (!configPath) {
    warnings.push(`Config file not found at ${path}; using defaults`);
  } else {
    throw new ConfigError(`Config file not found: ${path}`);
  }

  return { config, path, warnings };
}

export function serializeConfig(config: Config): string {
  const keybindings: Record<string, string> = {};
  for (const [key, action] of Object.entries(config.keybindings)) {
    keybindings[key] = action;
  }
  const out: {
    [key: string]:
      | boolean
      | number
      | string
      | Array<string>
      | { [key: string]: boolean | number | string | Array<string> };
  } = {
    theme: config.theme,
    db_path: config.dbPath,
    auto_theme: config.autoTheme,
    mouse: config.mouse,
    keybindings,
    typography: {
      measure: config.typography.measure,
      line_spacing: config.typography.lineSpacing,
      paragraph_indent: config.typography.paragraphIndent,
      paragraph_spacing: config.typography.paragraphSpacing,
      hyphenation: config.typography.hyphenation,
      justify: config.typography.justify,
    },
    display: {
      simplified_mode: config.display.simplifiedMode,
      respect_publisher_css: config.display.respectPublisherCss,
    },
    statusbar: {
      left: config.statusbar.left,
      right: config.statusbar.right,
      show_progress_bar: config.statusbar.showProgressBar,
    },
  };
  return stringifyTomlLib(out);
}
