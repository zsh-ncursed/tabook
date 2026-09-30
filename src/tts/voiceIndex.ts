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
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Метаданные одного Piper-голоса с HuggingFace. */
export interface PiperVoice {
  /** Уникальный id, напр. "ru_RU-irina-medium" */
  id: string;
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

const HF_MIRROR = 'https://hf-mirror.com';
const HF_MODEL = 'rhasspy/piper-voices';
const HF_API = `${HF_MIRROR}/api/${HF_MODEL}`;
const HF_RESOLVE = `${HF_MIRROR}/${HF_MODEL}/resolve/main`;

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

function installedVoices(): Set<string> {
  const dir = piperVoiceDir();
  if (!existsSync(dir)) return new Set();
  try {
    return new Set(
      readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    );
  } catch {
    return new Set();
  }
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

/** Fetch voice list from HF API. */
async function fetchVoiceList(): Promise<PiperVoice[]> {
  // Fetch full tree to find .onnx files
  const res = await fetch(`${HF_API}?recursive=true`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HF API error: ${res.status} ${res.statusText}`);
  }
  // The recursive API returns a flat list of {path, size, type} objects
  const tree = (await res.json()) as Array<{ path: string; size: number; type: string }>;

  // Build a map: voice_id → files
  const voiceFiles = new Map<string, string[]>();
  for (const entry of tree) {
    if (!entry.path.endsWith('.onnx') && !entry.path.endsWith('.onnx.json')) continue;
    const parts = entry.path.split('/');
    if (parts.length < 3) continue;
    const voiceId = parts.slice(0, 3).join('/'); // e.g. ru_RU/ivona/ivona-russian-medium
    if (!voiceFiles.has(voiceId)) voiceFiles.set(voiceId, []);
    voiceFiles.get(voiceId)!.push(entry.path);
  }

  // Also get metadata (download count, language) from the main API
  const metaRes = await fetch(`${HF_API}`, {
    headers: { Accept: 'application/json' },
  });
  const metaMap = new Map<string, { downloads: number; tags?: string[] }>();
  if (metaRes.ok) {
    const metaList = (await metaRes.json()) as HuggingFaceVoice[];
    for (const v of metaList) {
      metaMap.set(v.id, { downloads: v.download_count ?? 0, tags: v.tags });
    }
  }

  const installed = installedVoices();
  const result: PiperVoice[] = [];

  for (const [voiceId, files] of voiceFiles) {
    // Find the .onnx (not .onnx.json)
    const onnxFile = files.find((f) => f.endsWith('.onnx') && !f.endsWith('.onnx.json'));
    if (!onnxFile) continue;

    const parts = voiceId.split('/');
    const lang = parts[0] ?? '';
    const [quality = 'medium'] =
      parts[2]?.split('-').filter((s: string) => ['x-low', 'low', 'medium', 'high'].includes(s)) ??
      [];

    // Extract language name from tag list or use code
    const meta = metaMap.get(voiceId);
    const tags: string[] = meta?.tags ?? [];
    const langName = tags.find((t) => t.length > 2 && t === t.toLowerCase()) ?? lang;

    result.push({
      id: voiceId,
      name: parts[1] ? `${parts[1].replace(/-/g, ' ')} (${quality})` : voiceId,
      language: lang,
      languageName: langCodeToName(lang) ?? langName,
      quality,
      downloadUrl: `${HF_RESOLVE}/${onnxFile}`,
      downloads: meta?.downloads ?? 0,
      installed: installed.has(voiceId),
    });
  }

  // Sort by downloads (most popular first)
  result.sort((a, b) => b.downloads - a.downloads);
  return result;
}

function langCodeToName(code: string): string | undefined {
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
  return map[code.toLowerCase()];
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
