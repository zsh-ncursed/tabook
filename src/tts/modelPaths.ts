import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Общие помощники поиска движка и файлов голосов на диске.
 *
 * Их вызывают все файловые бэкенды (piper, sherpa, silero), потому что
 * порядок поиска одинаков: явный путь из конфига → переменная окружения →
 * PATH → типичные места установки (venv/pipx/распакованный архив).
 * Раньше эта логика жила внутри piper.ts и не была доступна другим движкам.
 */

/** Развернуть `~` и переменные окружения в пользовательском пути. */
export function expandPath(p: string): string {
  if (!p) return '';
  const home = process.env.HOME ?? '';
  let out = p.startsWith('~/') && home ? join(home, p.slice(2)) : p;
  out = out.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, a, b) => {
    const name = (a ?? b) as string;
    return process.env[name] ?? m;
  });
  return out;
}

/**
 * Разрешить бинарник движка: явный путь → env → `names` из PATH →
 * `extraCandidates` (типичные venv/каталоги). Если ничего не найдено,
 * возвращаем первый `fallback`, чтобы spawn дал понятный ENOENT.
 */
export function resolveEngineBin(opts: {
  explicit: string;
  envVar?: string;
  names: readonly string[];
  extraCandidates?: () => string[];
  fallback: string;
}): string {
  const explicit = expandPath(opts.explicit);
  if (explicit) return explicit;
  if (opts.envVar) {
    const fromEnv = expandPath(process.env[opts.envVar] ?? '');
    if (fromEnv) return fromEnv;
  }
  for (const n of opts.names) {
    if (commandAvailable(n)) return n;
  }
  for (const c of opts.extraCandidates?.() ?? []) {
    if (c && existsSync(c)) return c;
  }
  return opts.fallback;
}

/** Проверить, доступна ли команда в PATH (без запуска — только поиск файла). */
export function commandAvailable(cmd: string): boolean {
  if (cmd.includes('/')) return existsSync(cmd);
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      if (existsSync(join(dir, cmd + ext))) return true;
    }
  }
  return false;
}

/**
 * Каталоги-кандидаты для голосов: явный `modelsDir` из конфига, переменная
 * окружения, стандартные места конкретного движка и каталоги рядом с
 * самим tabook (dev-окружения `.tts-models/`). Несуществующие отбрасываются.
 */
export function modelSearchDirs(opts: {
  modelsDir: string;
  envVars?: readonly string[];
  standardDirs: readonly string[];
}): string[] {
  const dirs: string[] = [];
  const push = (d: string | undefined): void => {
    if (!d) return;
    const r = resolve(expandPath(d));
    if (existsSync(r) && !dirs.includes(r)) dirs.push(r);
  };
  push(opts.modelsDir);
  for (const v of opts.envVars ?? []) push(process.env[v]);
  for (const d of opts.standardDirs) push(d);
  // Каталоги рядом с местом запуска tabook: поднимаемся вверх, чтобы работали
  // .tts-models/ и tts-models/ в checkout-репозитории и в venv разработчика.
  const start = process.argv[1] ? resolve(process.argv[1]) : resolve(process.cwd());
  let dir: string | null = dirname(start);
  for (let i = 0; i < 6 && dir; i++) {
    push(join(dir, '.tts-models'));
    push(join(dir, 'tts-models'));
    const parent = dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return dirs;
}

/**
 * Найти файл по имени (с или без расширения) в каталогах моделей, рекурсивно
 * до `depth`. Возвращает абсолютный путь или null.
 */
export function findModelFile(
  name: string,
  dirs: readonly string[],
  { depth = 4 }: { depth?: number } = {},
): string | null {
  const target = name;
  const withExt = /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.onnx`;
  const search = (d: string, level: number): string | null => {
    const direct = join(d, target);
    if (existsSync(direct) && statSync(direct).isFile()) return direct;
    const directExt = join(d, withExt);
    if (existsSync(directExt) && statSync(directExt).isFile()) return directExt;
    if (level <= 0) return null;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const sub of entries) {
      if (!sub.isDirectory()) continue;
      const hit = search(join(d, sub.name), level - 1);
      if (hit) return hit;
    }
    return null;
  };
  for (const d of dirs) {
    const hit = search(d, depth);
    if (hit) return hit;
  }
  return null;
}

/**
 * Собрать список файлов голосов в каталогах — для `listVoices()`.
 * `filter` отсеивает лишнее (например, только `.onnx` для piper).
 */
export function listModelFiles(
  dirs: readonly string[],
  { depth = 3, filter }: { depth?: number; filter?: (file: string) => boolean } = {},
): string[] {
  const out: string[] = [];
  const walk = (d: string, level: number): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (level > 0) walk(full, level - 1);
        continue;
      }
      if (!e.isFile()) continue;
      if (filter && !filter(full)) continue;
      if (!out.includes(full)) out.push(full);
    }
  };
  for (const d of dirs) walk(d, depth);
  return out.sort();
}
