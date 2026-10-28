import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, TtsConfig } from '../../config/defaults.js';
import { ListModal } from './ListModal.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { formatBytes } from '../../tts/download.js';
import type { TtsManager } from '../../tts/manager.js';
import type { TtsVoiceEntry, TtsVoiceInstallProgress } from '../../tts/backend.js';

export interface TtsConfigModalProps {
  theme: Theme;
  config: Config;
  /** Текущие настройки TTS (черновик редактируется локально). */
  tts: TtsConfig;
  isActive: boolean;
  /**
   * Менеджер TTS — источник истины для списка движков. Модалка не знает
   * про piper/espeak/sherpa/vosk поимённо: она показывает ровно то, что
   * зарегистрировано, и работает через контракт `TtsBackend`.
   */
  ttsManager?: TtsManager;
  /** Применить настройки (persist + обновить live config). */
  onApply: (tts: TtsConfig) => void;
  /** Закрыть модалку. */
  onClose: () => void;
}

type RowKind = 'engine' | 'voice' | 'rate' | 'pitch' | 'follow' | 'download' | 'apply' | 'cancel';

interface Row {
  kind: RowKind;
  label: string;
  value: string;
}

/** Голос установлен, если бэкенд не сказал обратного (listVoices = локальные). */
function isInstalled(v: TtsVoiceEntry): boolean {
  return v.installed !== false;
}

/** Значение `tts.voice` для записи без пикера спикера. */
function entryConfigVoice(v: TtsVoiceEntry): string {
  return v.configVoice ?? v.id;
}

/** Совпадает ли запись каталога с текущим голосом в конфиге. */
function voiceMatches(v: TtsVoiceEntry, voice: string): boolean {
  return voice === entryConfigVoice(v) || voice === v.id || voice.startsWith(`${v.id}#`);
}

/** Строка-описание для списка голосов: язык · размер/установлен · спикеры. */
function voiceDetail(v: TtsVoiceEntry): string {
  const parts: string[] = [];
  if (v.language) parts.push(v.language);
  if (isInstalled(v)) {
    parts.push('installed');
  } else if (v.size) {
    parts.push(formatBytes(v.size));
  }
  if (v.speakers && v.speakers > 1) parts.push(`${v.speakers} voices`);
  return parts.join(' · ');
}

const PHASE_LABEL: Record<TtsVoiceInstallProgress['phase'], string> = {
  download: 'downloading',
  verify: 'verifying',
  extract: 'extracting',
  validate: 'validating',
};

/** Текст футера во время установки. */
function progressText(id: string, p: TtsVoiceInstallProgress | null): string {
  if (!p) return `⬇ ${id}`;
  if (p.phase === 'download' && p.done !== undefined) {
    const pct = p.total ? Math.round((p.done / p.total) * 100) : null;
    return `⬇ ${id} — ${pct !== null ? `${pct}%` : formatBytes(p.done)}`;
  }
  return `⬇ ${id} — ${PHASE_LABEL[p.phase]}…`;
}

// TTS settings modal: engine, voice, rate, pitch, follow toggle, plus an
// engine-agnostic voice catalogue. Settings edit a local draft; Apply persists.
export function TtsConfigModal(props: TtsConfigModalProps): React.JSX.Element {
  const { theme, config, tts, isActive, ttsManager, onApply, onClose } = props;
  const resolver = useMemo(() => createActionResolver(config), [config]);

  const [draft, setDraft] = useState<TtsConfig>(tts);
  const [cursor, setCursor] = useState(0);
  // Режимы: список настроек, выбор движка, список голосов, выбор спикера.
  const [pickingEngine, setPickingEngine] = useState(false);
  const [engineCursor, setEngineCursor] = useState(0);
  const [engineAvail, setEngineAvail] = useState<Record<string, string | null>>({});
  const engineAvailRef = useRef<Record<string, string | null>>({});
  const [pickingVoice, setPickingVoice] = useState(false);
  const [voiceCursor, setVoiceCursor] = useState(0);
  const [voices, setVoices] = useState<TtsVoiceEntry[] | null>(null);
  const [voiceFilter, setVoiceFilter] = useState('');
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<TtsVoiceInstallProgress | null>(null);
  const [pickingSpeaker, setPickingSpeaker] = useState(false);
  const [speakerEntry, setSpeakerEntry] = useState<TtsVoiceEntry | null>(null);
  const [speakerCursor, setSpeakerCursor] = useState(0);
  const installAbortRef = useRef<AbortController | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Список движков — из реестра менеджера (источник истины), а не хардкод.
  const engines = useMemo(
    () => ttsManager?.engines ?? [{ id: draft.engine, label: draft.engine }],
    [ttsManager, draft.engine],
  );

  // Доступность движков проверяем лениво: только когда список открыт, иначе
  // проверка каждого движка (поиск бинарей по ФС) шла бы при каждом рендере.
  useEffect(() => {
    if (!pickingEngine || !ttsManager) return;
    let cancelled = false;
    // Читаем уже опрошенные движки через ref, а не state: зависимость
    // engineAvail в deps заставила бы эффект перезапускаться.
    const done = engineAvailRef.current;
    const pending = engines.filter((e) => !(e.id in done));
    if (pending.length === 0) return;
    void Promise.all(
      pending.map(async (e) => {
        try {
          return [e.id, await ttsManager.check(e.id)] as const;
        } catch (err: unknown) {
          return [e.id, err instanceof Error ? err.message : String(err)] as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setEngineAvail((prev) => {
        const next = { ...prev, ...Object.fromEntries(results) };
        engineAvailRef.current = next;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pickingEngine, ttsManager, engines]);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const cbRef = useRef({ onApply, onClose });
  cbRef.current = { onApply, onClose };

  // Список голосов при входе в режим выбора: онлайн-каталог, если бэкенд его
  // умеет, иначе локальные модели через listVoices().
  const activeEngine = draft.engine;
  useEffect(() => {
    if (!pickingVoice) return;
    let cancelled = false;
    const ctl = new AbortController();
    setLoadingVoices(true);
    setVoiceError(null);
    setVoiceWarning(null);
    setVoices(null);
    const backend = ttsManager?.resolveBackend(activeEngine);
    if (!backend) {
      setLoadingVoices(false);
      return;
    }
    const load = backend.voiceCatalog
      ? backend.voiceCatalog(ctl.signal)
      : backend.listVoices
        ? backend.listVoices()
        : Promise.resolve<TtsVoiceEntry[]>([]);
    load
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        // Каталог мог ответить кешем (нет сети) — предупреждение в футер.
        setVoiceWarning(backend.catalogWarning ?? null);
        // Курсор — на текущем голосе, если он есть в списке.
        const cur = draftRef.current.voice;
        const idx = list.findIndex((v) => voiceMatches(v, cur));
        setVoiceCursor(idx >= 0 ? idx : 0);
      })
      .catch(async (e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Каталог недоступен (нет сети/кеша): показываем локальные модели и
        // ошибку в футере — пустой список без объяснения хуже.
        let local: TtsVoiceEntry[] = [];
        try {
          local = backend.listVoices ? await backend.listVoices() : [];
        } catch {
          // Локальный список тоже не дался — останется пусто + ошибка.
        }
        if (cancelled) return;
        setVoices(local);
        const cur = draftRef.current.voice;
        const idx = local.findIndex((v) => voiceMatches(v, cur));
        setVoiceCursor(idx >= 0 ? idx : 0);
        setVoiceError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoadingVoices(false);
      });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [pickingVoice, ttsManager, activeEngine]);

  // Незавершённая установка не должна пережить размонтирование модалки.
  useEffect(() => () => installAbortRef.current?.abort(), []);

  // Rate/pitch подписи зависят от возможностей движка, а не от его id.
  const engine = ttsManager?.resolveBackend(draft.engine);
  const pitchNote = engine?.capabilities.pitchControl
    ? ''
    : ` (${engine ? 'unsupported' : 'engine-dependent'})`;
  const rateNote = engine?.capabilities.rateControl ? '' : ' (resampled)';
  const hasVoiceList = Boolean(engine?.voiceCatalog || engine?.listVoices);
  const canDownload = Boolean(engine?.voiceCatalog);

  const rows: Row[] = useMemo(
    () => [
      { kind: 'engine', label: 'Engine', value: draft.engine },
      {
        kind: 'voice',
        label: 'Voice',
        // У espeak голос — это код языка, а не выбираемое из списка.
        value: hasVoiceList ? draft.voice : `${draft.voice} (language code)`,
      },
      {
        kind: 'rate',
        label: 'Rate',
        value: `${draft.rate.toFixed(2)}x${rateNote}`,
      },
      { kind: 'pitch', label: 'Pitch', value: `${draft.pitch.toFixed(2)}${pitchNote}` },
      { kind: 'follow', label: 'Follow', value: draft.follow ? 'on' : 'off' },
      {
        kind: 'download',
        label: 'Download voice',
        value: canDownload ? `${engine?.label ?? draft.engine} voices ▸` : 'n/a (local models)',
      },
      { kind: 'apply', label: 'Apply', value: '' },
      { kind: 'cancel', label: 'Cancel', value: '' },
    ],
    [draft, engine, hasVoiceList, canDownload, pitchNote, rateNote],
  );

  const filteredVoices = useMemo(() => {
    if (!voices) return [];
    const q = voiceFilter.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter(
      (v) => v.id.toLowerCase().includes(q) || v.label.toLowerCase().includes(q),
    );
  }, [voices, voiceFilter]);

  // splitChunks: быстрый ввод (или вставка) приходит одним чанком, а Ink
  // парсит только первый символ — j/k и h/l сериями терялись бы.
  const dispatchRef = useInputDispatch(isActive, { splitChunks: true });
  dispatchRef.current = (input: string, key: Key) => {
    const keyName = resolveKeyName(input, key);
    if (keyName === null) return;

    // --- режим выбора движка ---
    if (pickingEngine) {
      const action = resolver.feed(keyName);
      switch (action) {
        case 'back':
          setPickingEngine(false);
          return;
        case 'move_cursor_down':
          setEngineCursor((c) => Math.min(engines.length - 1, c + 1));
          return;
        case 'move_cursor_up':
          setEngineCursor((c) => Math.max(0, c - 1));
          return;
        case 'select': {
          const e = engines[engineCursor];
          if (!e) return;
          setDraft((d) => {
            // Голос принадлежит движку: при смене движка старый голос
            // невалиден, поэтому даём бэкенду применить свой дефолт.
            if (d.engine === e.id) return d;
            const backend = ttsManager?.resolveBackend(e.id);
            const fallback = d.engines?.[e.id]?.model;
            return {
              ...d,
              engine: e.id,
              voice: backend?.defaultVoice?.() || fallback || '',
            };
          });
          setPickingEngine(false);
          return;
        }
        default:
          return;
      }
    }

    // --- режим выбора спикера (поверх списка моделей) ---
    if (pickingSpeaker) {
      const action = resolver.feed(keyName);
      const entry = speakerEntry;
      const count = Math.max(1, Math.min(20, entry?.speakers ?? 1));
      switch (action) {
        case 'back':
          setPickingSpeaker(false);
          return;
        case 'move_cursor_down':
          setSpeakerCursor((c) => Math.min(count - 1, c + 1));
          return;
        case 'move_cursor_up':
          setSpeakerCursor((c) => Math.max(0, c - 1));
          return;
        case 'select': {
          if (!entry) return;
          setDraft((d) => ({ ...d, voice: `${entry.id}#${speakerCursor}` }));
          closeVoicePicker();
          return;
        }
        default:
          return;
      }
    }

    // --- режим выбора голоса ---
    if (pickingVoice) {
      const action = resolver.feed(keyName);
      switch (action) {
        case 'back':
          // Во время установки Esc отменяет скачивание, а не закрывает пикер.
          if (installAbortRef.current) {
            installAbortRef.current.abort();
            return;
          }
          closeVoicePicker();
          return;
        case 'move_cursor_down':
          setVoiceCursor((c) => Math.max(0, Math.min(filteredVoices.length - 1, c + 1)));
          return;
        case 'move_cursor_up':
          setVoiceCursor((c) => Math.max(0, c - 1));
          return;
        case 'select': {
          const v = filteredVoices[voiceCursor];
          if (!v || installAbortRef.current) return;
          if (isInstalled(v)) {
            chooseVoice(v);
          } else {
            void installVoice(v);
          }
          return;
        }
        default:
          return;
      }
    }

    // --- главный список настроек ---
    const action = resolver.feed(keyName);
    const row = rows[cursorRef.current];
    if (!row) return;
    switch (action) {
      case 'back':
        cbRef.current.onClose();
        return;
      case 'move_cursor_down':
        setCursor((c) => Math.min(rows.length - 1, c + 1));
        return;
      case 'move_cursor_up':
        setCursor((c) => Math.max(0, c - 1));
        return;
      case 'move_cursor_left':
        // h: уменьшить rate/pitch
        if (row.kind === 'rate') setDraft((d) => ({ ...d, rate: clamp(d.rate - 0.25, 0.25, 4) }));
        if (row.kind === 'pitch') setDraft((d) => ({ ...d, pitch: clamp(d.pitch - 0.1, 0.5, 2) }));
        return;
      case 'move_cursor_right':
        // l: увеличить rate/pitch
        if (row.kind === 'rate') setDraft((d) => ({ ...d, rate: clamp(d.rate + 0.25, 0.25, 4) }));
        if (row.kind === 'pitch') setDraft((d) => ({ ...d, pitch: clamp(d.pitch + 0.1, 0.5, 2) }));
        return;
      case 'select':
        activateRow(row);
        return;
      default:
        return;
    }
  };

  function closeVoicePicker(): void {
    setPickingVoice(false);
    setPickingSpeaker(false);
    setSpeakerEntry(null);
    setVoiceFilter('');
    setVoiceError(null);
    setVoiceWarning(null);
    setInstallProgress(null);
  }

  function chooseVoice(v: TtsVoiceEntry): void {
    if ((v.speakers ?? 1) > 1) {
      setSpeakerEntry(v);
      setSpeakerCursor(0);
      setPickingSpeaker(true);
      return;
    }
    setDraft((d) => ({ ...d, voice: entryConfigVoice(v) }));
    closeVoicePicker();
  }

  async function installVoice(v: TtsVoiceEntry): Promise<void> {
    const backend = ttsManager?.resolveBackend(draftRef.current.engine);
    const install = backend?.installVoice;
    if (!backend || !install) {
      setVoiceError(`No installer for ${backend?.label ?? draftRef.current.engine}`);
      return;
    }
    const ctl = new AbortController();
    installAbortRef.current = ctl;
    setInstalling(v.id);
    setVoiceError(null);
    setInstallProgress({ phase: 'download' });
    try {
      const cfgVoice = await install.call(backend, v.id, (p) => setInstallProgress(p), ctl.signal);
      // Метка installed уезжает в кеш каталога только после refresh;
      // обновляем локальный список, чтобы галочка появилась сразу.
      setVoices(
        (prev) => prev?.map((x) => (x.id === v.id ? { ...x, installed: true } : x)) ?? prev,
      );
      setInstallProgress(null);
      setInstalling(null);
      if ((v.speakers ?? 1) > 1) {
        setSpeakerEntry({ ...v, installed: true });
        setSpeakerCursor(0);
        setPickingSpeaker(true);
      } else {
        setDraft((d) => ({ ...d, voice: cfgVoice }));
        closeVoicePicker();
      }
    } catch (e: unknown) {
      // Отмена — не ошибка: список остаётся открытым, запись снова «○».
      setInstallProgress(null);
      setInstalling(null);
      setVoiceError(e instanceof Error ? e.message : String(e));
    } finally {
      if (installAbortRef.current === ctl) installAbortRef.current = null;
    }
  }

  function activateRow(row: Row): void {
    switch (row.kind) {
      case 'engine':
        // Открываем список зарегистрированных движков (реестр менеджера),
        // а не переключаем захардкоженную пару.
        setEngineCursor(
          Math.max(
            0,
            engines.findIndex((e) => e.id === draftRef.current.engine),
          ),
        );
        setPickingEngine(true);
        return;
      case 'voice':
        setPickingVoice(true);
        return;
      case 'follow':
        setDraft((d) => ({ ...d, follow: !d.follow }));
        return;
      case 'download': {
        // Каталог есть только у движков с онлайн-голосами (piper, vosk);
        // у sherpa/espeak строка ведёт в список движков, а не в пустой пикер.
        const backend = ttsManager?.resolveBackend(draftRef.current.engine);
        if (backend?.voiceCatalog) setPickingVoice(true);
        else setPickingEngine(true);
        return;
      }
      case 'apply':
        cbRef.current.onApply(draftRef.current);
        return;
      case 'cancel':
        cbRef.current.onClose();
        return;
      default:
        return;
    }
  }

  // --- рендер ---

  if (pickingEngine) {
    const items = engines.map((e) => {
      const problem = engineAvail[e.id];
      const hint =
        problem === undefined || problem === null
          ? null
          : (ttsManager?.resolveBackend(e.id)?.installHint?.() ?? null);
      const detail =
        problem === undefined
          ? 'checking…'
          : problem === null
            ? 'ready'
            : (hint?.install ?? hint?.package ?? 'not installed');
      return {
        id: e.id,
        label: `${e.id} — ${e.label}${problem === null ? ' ✓' : ''}`,
        detail,
        accent: e.id === draft.engine,
      };
    });
    const current = engines[engineCursor];
    const problem = current ? engineAvail[current.id] : undefined;
    const hint =
      current && problem ? (ttsManager?.resolveBackend(current.id)?.installHint?.() ?? null) : null;
    return (
      <ListModal
        theme={theme}
        title="TTS engine"
        items={items}
        cursor={engineCursor}
        height={Math.min(16, Math.max(items.length, 6))}
        footer={
          problem === null
            ? 'enter select · j/k move · esc back'
            : problem === undefined
              ? 'checking… esc back'
              : (hint?.notes ?? hint?.install ?? 'not installed') + '  ·  esc back'
        }
      />
    );
  }

  if (pickingSpeaker && speakerEntry) {
    const count = Math.max(1, Math.min(20, speakerEntry.speakers ?? 1));
    const items = Array.from({ length: count }, (_, i) => ({
      id: `${speakerEntry.id}#${i}`,
      label: `speaker ${i}`,
      detail: draft.voice === `${speakerEntry.id}#${i}` ? 'current' : '',
      accent: i === speakerCursor,
    }));
    return (
      <ListModal
        theme={theme}
        title={`TTS · ${speakerEntry.label} · speaker`}
        items={items}
        cursor={speakerCursor}
        height={Math.min(16, Math.max(items.length, 6))}
        footer="enter select · j/k move · esc back"
      />
    );
  }

  if (pickingVoice) {
    const items =
      voices === null
        ? [{ id: 'loading', label: loadingVoices ? 'Loading voices…' : 'No voices' }]
        : filteredVoices.length === 0
          ? [{ id: 'empty', label: voiceFilter ? 'No matches' : 'No voices available' }]
          : filteredVoices.map((v) => ({
              id: v.id,
              label: `${isInstalled(v) ? '✓' : '○'} ${v.label}`,
              detail: voiceDetail(v),
              accent: voiceMatches(v, draft.voice),
            }));
    const voiceBackend = ttsManager?.resolveBackend(activeEngine);
    return (
      <ListModal
        theme={theme}
        title={`${voiceBackend?.label ?? activeEngine} voices ${
          voiceFilter ? `· filter: ${voiceFilter}` : ''
        }`}
        items={items}
        cursor={voiceCursor}
        height={Math.min(16, Math.max(items.length, 6))}
        footer={
          installing
            ? `${progressText(installing, installProgress)} … esc cancel`
            : voiceError
              ? `error: ${voiceError}`
              : voiceWarning
                ? `${voiceWarning} · enter select · esc back`
                : 'enter select/download · j/k move · esc back'
        }
      />
    );
  }

  return (
    <ListModal
      theme={theme}
      title="TTS settings"
      items={rows.map((r) => ({
        id: r.kind,
        label: r.label,
        detail: r.value,
        accent: r.kind === 'apply',
      }))}
      cursor={cursor}
      height={rows.length}
      footer="enter change · h/l adjust rate·pitch · esc cancel"
    />
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v * 100) / 100));
}
