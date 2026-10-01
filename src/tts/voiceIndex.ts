/**
 * Получение списка доступных Piper-голосов с HuggingFace.
 *
 * Используем HF Mirror (hf-mirror.com) чтобы избежать rate limit.
 * HF API не требует токена для read-only операций (download counts и metadata).
 *
 * Voice index кешируется в:
 *   ~/.config/tabook/tts-voice-index.json
 * Обновляется раз в 24 часа (mtime check) — при вызове checkAndRefresh().
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { HF_MIRROR, HF_MODEL, HF_RESOLVE } from './hf.js';

/** Метаданные одного Piper-голоса с HuggingFace. */
export interface PiperVoice {
  /** Уникальный id, напр. "ru_RU-irina-medium" */
  id: string;
  /** Имя .onnx файла, напр. "ru_RU-irina-medium.onnx" */
  file: string;
  /** Человекочитаемое имя: "Irina (medium quality)" */
  name: string;
  /** BCP-47 код языка, напр. "ru", "en" */
  language: string;
  /** Язык человекочитаемо, напр. "Russian", "English" */
  languageName: string;
  /** Качество: medium / high / x-low */
  quality: string;
  /** Размер .onnx файла в байтах (если известен). */
  size?: number;
  /** Прямая ссылка на .onnx для скачивания. */
  downloadUrl: string;
  /** Число скачиваний с HF (для сортировки по популярности). */
  downloads: number;
  /** true если голос уже скачан локально. */
  installed: boolean;
}

interface HuggingFaceVoice {
  id: string;
  name?: string;
  samplerate?: number;
  download_count?: number;
  tags?: string[];
  /** Файлы голоса: ищем .onnx и对应的 .onnx.json */
  files?: string[];
  /** Для older API format */
  pipelite_onnx?: string;
}

const HF_TREE = `${HF_MIRROR}/api/models/${HF_MODEL}/tree/main`;
const HF_META = `${HF_MIRROR}/api/models/${HF_MODEL}`;

/** 24 часа — как часто обновлять индекс (в мс). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Куда кешируем индекс. */
function cachePath(): string {
  const dir = join(homedir(), '.config', 'tabook');
  return join(dir, 'tts-voice-index.json');
}

/** Куда piper-голоса скачиваются по умолчанию. */
export function piperVoiceDir(): string {
  const xdg = process.env.PIPER_MODELS_DIR ?? join(homedir(), '.local', 'share', 'piper', 'voices');
  return xdg;
}

/**
 * Множество id установленных голосов. Голос лежит по пути
 * `<voiceDir>/<id>/<basename>.onnx` рядом с конфигом `<basename>.onnx.json`
 * (piper требует оба файла), поэтому обходим дерево и выводим id из пути
 * к .onnx-файлу, проверяя наличие конфига.
 */
function installedVoices(): Set<string> {
  const root = piperVoiceDir();
  if (!existsSync(root)) return new Set();
  const out = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        walk(join(dir, e.name), depth + 1);
      } else if (e.name.endsWith('.onnx') && !e.name.endsWith('.onnx.json')) {
        // id = относительный путь директории файла от корня голосов
        const rel = relative(root, dir);
        // Без .onnx.json-конфига piper не запустится — не считаем установенным.
        if (rel && existsSync(join(dir, `${e.name}.json`))) out.add(rel);
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Проверить актуальность кеша; если устарел — обновить. */
export async function checkAndRefresh(onProgress?: (msg: string) => void): Promise<void> {
  const path = cachePath();
  const now = Date.now();
  try {
    if (existsSync(path)) {
      const stat = statSync(path);
      if (now - stat.mtimeMs < CACHE_TTL_MS) return; // кеш свежий
    }
  } catch {
    // файла нет — скачаем
  }
  await refreshIndex(onProgress);
}

/** Принудительно обновить индекс голосов с HuggingFace. */
export async function refreshIndex(onProgress?: (msg: string) => void): Promise<void> {
  onProgress?.('Fetching voice list from HuggingFace…');
  const voices = await fetchVoiceList();
  saveVoiceIndex(voices);
  onProgress?.(`Voice list updated: ${voices.length} voices`);
}

interface TreeEntry {
  path: string;
  size: number;
  type: string;
}

/**
 * Скачать всё дерево репозитория, перебирая страницы по cursor (HF отдаёт
 * максимум 1000 записей на страницу — одного запроса на весь репозиторий
 с голосами не хватает).
 */
async function fetchFullTree(): Promise<TreeEntry[]> {
  const all: TreeEntry[] = [];
  let url: string | null = `${HF_TREE}?recursive=true&limit=1000`;
  while (url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`HF API error: ${res.status} ${res.statusText}`);
    }
    const batch = (await res.json()) as TreeEntry[];
    all.push(...batch);
    // Следующая страница лежит в Link header (rel="next"), если её нет — конец.
    const next = nextLink(res.headers.get('link'));
    if (!next || batch.length === 0) break;
    url = next;
  }
  return all;
}

/** Распарсить `Link: <url>; rel="next"` — достать URL следующей страницы. */
function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const [urlRaw, ...rest] = part.split(';');
    const url = (urlRaw ?? '').trim().replace(/^<|>$/g, '');
    const isNext = rest.some((r) => r.trim().startsWith('rel="next"'));
    if (isNext) return url;
  }
  return null;
}

/** Fetch voice list from HF API. */
async function fetchVoiceList(): Promise<PiperVoice[]> {
  // Полное дерево репозитория с пагинацией
  const tree = await fetchFullTree();

  // Голос лежит по пути <lang>/<lang_REGION>/<speaker>/<quality>/<file>.onnx.
  // voiceId = первые 4 компоненты (без имени файла) — например ru/ru_RU/irina/medium.
  const voiceFiles = new Map<string, string[]>();
  for (const entry of tree) {
    if (entry.type !== 'file') continue;
    if (!entry.path.endsWith('.onnx') && !entry.path.endsWith('.onnx.json')) continue;
    const parts = entry.path.split('/');
    // samples/ и _script/ — не голоса
    if (parts.length < 5) continue;
    if (parts.includes('samples') || parts[0] === '_script') continue;
    const voiceId = parts.slice(0, 4).join('/');
    if (!voiceFiles.has(voiceId)) voiceFiles.set(voiceId, []);
    voiceFiles.get(voiceId)!.push(entry.path);
  }

  // Metadata: теги языков и число скачиваний для сортировки по популярности.
  // /api/models/<id> отдаёт один объект репозитория, а не список.
  const metaRes = await fetch(`${HF_META}`, {
    headers: { Accept: 'application/json' },
  });
  let allTags: string[] = [];
  if (metaRes.ok) {
    const meta = (await metaRes.json()) as HuggingFaceVoice;
    allTags = meta.tags ?? [];
  }

  const installed = installedVoices();
  const result: PiperVoice[] = [];

  for (const [voiceId, files] of voiceFiles) {
    // Find the .onnx (not .onnx.json)
    const onnxFile = files.find((f) => f.endsWith('.onnx') && !f.endsWith('.onnx.json'));
    if (!onnxFile) continue;
    const onnxEntry = tree.find((e) => e.path === onnxFile);

    const parts = voiceId.split('/');
    const lang = parts[0] ?? '';
    const quality = parts[3] ?? 'medium';
    const speaker = parts[2] ?? '';

    // Теги репозитория содержат коды языков (['onnx','ar','ca',...,'ru',...]);
    // ранг скачиваний неизвестен — сортируем по языку, «своё» впереди.
    const langTag = allTags.find((t) => t === lang) ?? lang;

    result.push({
      id: voiceId,
      // Реальное имя файла на HF: "ru_RU-irina-medium.onnx" — именно так
      // piper называет модель, и так VoiceManager кладёт её на диск.
      file: basename(onnxFile),
      name: speaker ? `${speaker.replace(/-/g, ' ')} (${quality})` : voiceId,
      language: lang,
      languageName: langCodeToName(lang) ?? langTag,
      quality,
      downloadUrl: `${HF_RESOLVE}/${onnxFile}`,
      size: onnxEntry?.size,
      downloads: 0,
      installed: installed.has(voiceId),
    });
  }

  // Голоса сортируются: установленные → по языку → по имени.
  result.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    if (a.language !== b.language) return a.language < b.language ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });
  return result;
}

function langCodeToName(code: string): string | undefined {
  // HF-пути используют 'ru_RU', 'en_US' — берём часть до '_'.
  const key = code.split('_')[0]!.toLowerCase();
  const map: Record<string, string> = {
    ru: 'Russian',
    en: 'English',
    de: 'German',
    es: 'Spanish',
    fr: 'French',
    it: 'Italian',
    pl: 'Polish',
    pt: 'Portuguese',
    uk: 'Ukrainian',
    sv: 'Swedish',
    cs: 'Czech',
    nl: 'Dutch',
    ar: 'Arabic',
    hu: 'Hungarian',
    tr: 'Turkish',
    el: 'Greek',
    he: 'Hebrew',
    hi: 'Hindi',
    ja: 'Japanese',
    zh: 'Chinese',
    ko: 'Korean',
    vi: 'Vietnamese',
    th: 'Thai',
    fa: 'Persian',
    bn: 'Bengali',
    ca: 'Catalan',
    hr: 'Croatian',
    sk: 'Slovak',
    sl: 'Slovenian',
    ro: 'Romanian',
    fi: 'Finnish',
    da: 'Danish',
    no: 'Norwegian',
    bg: 'Bulgarian',
    sr: 'Serbian',
    lt: 'Lithuanian',
    lv: 'Latvian',
    et: 'Estonian',
    mk: 'Macedonian',
  };
  return map[key];
}

function saveVoiceIndex(voices: PiperVoice[]): void {
  const dir = join(homedir(), '.config', 'tabook');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'tts-voice-index.json'),
      JSON.stringify({ voices, updatedAt: Date.now() }),
      'utf8',
    );
  } catch (e) {
    console.warn('[tts] Failed to save voice index cache:', e);
  }
}

export function loadCachedVoices(): PiperVoice[] {
  try {
    const path = cachePath();
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf8');
    const { voices } = JSON.parse(raw);
    return voices as PiperVoice[];
  } catch {
    return [];
  }
}
