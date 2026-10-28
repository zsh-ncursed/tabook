import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Каталог TTS-моделей Vosk с alphacephei.com.
 *
 * `model-list.json` содержит модели всех типов (ASR и TTS), причём `obsolete`
 * приходит строкой `"true"/"false"`, а `size` — числом байт. Нам нужны только
 * актуальные TTS-модели; парсер толерантный: незнакомые/битые записи
 * пропускаются, чтобы изменение схемы каталога не оставляло пользователя без
 * списка.
 *
 * Кеш: `~/.config/tabook/tts-vosk-index.json`, TTL 24 часа по `updatedAt`.
 * Если сеть недоступна, отдаём даже просроченный кеш — офлайн-установка уже
 * скачанных моделей важнее свежести списка.
 */

export const VOSK_MODEL_LIST_URL = 'https://alphacephei.com/vosk/models/model-list.json';
export const VOSK_INDEX_TTL_MS = 24 * 60 * 60 * 1000;

/** Запись каталога после нормализации. */
export interface VoskCatalogModel {
  id: string;
  label: string;
  language: string;
  size?: number;
  md5?: string;
  url: string;
  speakers: number;
  version?: string;
}

export interface VoskCatalogResult {
  models: VoskCatalogModel[];
  /** true — сеть не ответила и отдан просроченный кеш. */
  stale: boolean;
  warning?: string;
}

export interface LoadVoskCatalogOptions {
  /** Переопределить путь кеша (тесты). */
  cachePath?: string;
  ttlMs?: number;
  signal?: AbortSignal;
  /** Подмена fetch (тесты). */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Путь кеша каталога. */
export function voskIndexCachePath(): string {
  return join(homedir(), '.config', 'tabook', 'tts-vosk-index.json');
}

/**
 * Модель совместима с установленным движком. 0.1-модели несовместимы:
 * их словарь без длительностей фонем (см. фильтр в parseVoskModelList).
 */
export function isSupportedVoskModel(id: string): boolean {
  return !/^vosk-model-tts-[a-z]+-0\.1-/.test(id);
}

/** Разобрать `model-list.json`. Возвращает только актуальные TTS-модели,
 * отсортированные: multi-модели (больше голосов) впереди, затем по версии.
 */
export function parseVoskModelList(raw: unknown): VoskCatalogModel[] {
  if (!Array.isArray(raw)) return [];
  const out: VoskCatalogModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    if (m['type'] !== 'tts') continue;
    // obsolete приходит строкой; true/1/'true' — всё «устарело».
    const obsolete = m['obsolete'];
    if (obsolete === true || obsolete === 1 || String(obsolete).toLowerCase() === 'true') {
      continue;
    }
    const id = str(m['name']);
    const url = str(m['url']);
    if (!id || !url || seen.has(id)) continue;
    // Словарь 0.1-* хранит фонемы без длительностей (две колонки), а
    // vosk-tts 0.3.61 ждёт три и падает на `!SIL 1 SIL`. Модель скачалась бы,
    // но не заговорила, поэтому не предлагаем её вовсе.
    if (!isSupportedVoskModel(id)) continue;
    seen.add(id);
    const language = str(m['lang']) || 'ru';
    const version = str(m['version']) || id.replace(/^vosk-model-tts-[a-z]+-/, '') || undefined;
    const size = positiveInt(m['size']);
    const md5 = /^[0-9a-f]{32}$/i.test(str(m['md5'])) ? str(m['md5']).toLowerCase() : undefined;
    out.push({
      id,
      label: `Vosk TTS ${language.toUpperCase()}${version ? ` ${version}` : ''}`,
      language,
      size,
      md5,
      url,
      speakers: estimateSpeakers(id),
      version,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Эвристика: multi-модели Vosk содержат `-multi` и 5 голосов. */
export function estimateSpeakers(id: string): number {
  return id.includes('-multi') ? 5 : 1;
}

/**
 * Загрузить каталог: свежий кеш → сеть → просроченный кеш. Ошибка только
 * когда сеть недоступна и кеша нет вовсе.
 */
export async function loadVoskCatalog(
  opts: LoadVoskCatalogOptions = {},
): Promise<VoskCatalogResult> {
  const path = opts.cachePath ?? voskIndexCachePath();
  const ttl = opts.ttlMs ?? VOSK_INDEX_TTL_MS;
  const now = opts.now?.() ?? Date.now();
  const cached = readVoskCache(path);
  if (cached && now - cached.updatedAt < ttl && cached.models.length > 0) {
    return { models: cached.models, stale: false };
  }
  try {
    const res = await (opts.fetchImpl ?? fetch)(VOSK_MODEL_LIST_URL, {
      signal: opts.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const models = parseVoskModelList(await res.json());
    if (models.length === 0) throw new Error('model list has no current TTS models');
    writeVoskCache(path, { updatedAt: now, models });
    return { models, stale: false };
  } catch (err) {
    if (isAbort(err)) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    if (cached && cached.models.length > 0) {
      return {
        models: cached.models,
        stale: true,
        warning: `Vosk catalog unavailable (${reason}); using cached list`,
      };
    }
    throw new Error(`Vosk model catalog unavailable: ${reason}`);
  }
}

interface VoskCacheFile {
  updatedAt: number;
  models: VoskCatalogModel[];
}

/** Прочитать кеш; битый/несовместимый файл считается отсутствующим. */
function readVoskCache(path: string): VoskCacheFile | null {
  try {
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    const updatedAt = positiveInt(obj['updatedAt']);
    if (!updatedAt || !Array.isArray(obj['models'])) return null;
    const models = obj['models'].map(normalizeCachedModel).filter(isModel);
    return { updatedAt, models };
  } catch {
    return null;
  }
}

function normalizeCachedModel(raw: unknown): VoskCatalogModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m['id']);
  const url = str(m['url']);
  if (!id || !url || !isSupportedVoskModel(id)) return null;
  return {
    id,
    label: str(m['label']) || id,
    language: str(m['language']) || 'ru',
    size: positiveInt(m['size']),
    md5: /^[0-9a-f]{32}$/i.test(str(m['md5'])) ? str(m['md5']).toLowerCase() : undefined,
    url,
    speakers: positiveInt(m['speakers']) ?? estimateSpeakers(id),
    version: str(m['version']) || undefined,
  };
}

function isModel(m: VoskCatalogModel | null): m is VoskCatalogModel {
  return m !== null;
}

/** Атомарная запись кеша: temp-файл в том же каталоге + rename. */
function writeVoskCache(path: string, data: VoskCacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, path);
  } catch {
    // Кеш — оптимизация; без него каталог просто грузится из сети.
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function positiveInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
