import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, TtsConfig } from '../../config/defaults.js';
import { ListModal } from './ListModal.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { VoiceManager, type PiperVoice } from '../../tts/voiceManager.js';
import { formatBytes } from '../../tts/download.js';
import type { TtsManager } from '../../tts/manager.js';
import type { TtsVoiceEntry, TtsInstallHint } from '../../tts/backend.js';

export interface TtsConfigModalProps {
  theme: Theme;
  config: Config;
  /** Текущие настройки TTS (черновик редактируется локально). */
  tts: TtsConfig;
  isActive: boolean;
  /**
   * Менеджер TTS — источник истины для списка движков. Модалка не знает
   * про piper/espeak/sherpa поимённо: она показывает ровно то, что
   * зарегистрировано, поэтому новый бэкенд появляется здесь сам.
   */
  ttsManager?: TtsManager;
  /** Применить настройки (persist + обновить live config). */
  onApply: (tts: TtsConfig) => void;
  /** Закрыть модалку. */
  onClose: () => void;
}

type RowKind = 'engine' | 'voice' | 'rate' | 'pitch' | 'follow' | 'download' | 'apply' | 'cancel';

/**
 * Имя голоса для конфига: basename .onnx без расширения ("ru_RU-irina-medium").
 * Именно такое имя piper ищет в каталогах моделей (findModel в piper.ts).
 */
function piperVoiceName(v: PiperVoice): string {
  return v.file.replace(/\.onnx$/, '');
}

interface Row {
  kind: RowKind;
  label: string;
  value: string;
}

// TTS settings modal: engine, voice, rate, pitch, follow toggle, plus an
// embedded Piper voice browser that lists HuggingFace voices and downloads
// the selected one on demand. Settings edit a local draft; Apply persists.
export function TtsConfigModal(props: TtsConfigModalProps): React.JSX.Element {
  const { theme, config, tts, isActive, ttsManager, onApply, onClose } = props;
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const voiceMgr = useMemo(() => new VoiceManager(), []);

  const [draft, setDraft] = useState<TtsConfig>(tts);
  const [cursor, setCursor] = useState(0);
  // Три режима: список настроек, выбор движка, выбор голоса.
  const [pickingEngine, setPickingEngine] = useState(false);
  const [engineCursor, setEngineCursor] = useState(0);
  const [engineAvail, setEngineAvail] = useState<Record<string, string | null>>({});
  const engineAvailRef = useRef<Record<string, string | null>>({});
  const [pickingVoice, setPickingVoice] = useState(false);
  const [voiceCursor, setVoiceCursor] = useState(0);
  const [voices, setVoices] = useState<PiperVoice[] | null>(null);
  const [voiceFilter, setVoiceFilter] = useState('');
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState<number>(0);

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
    // Читаем уже опросенные движки через ref, а не state:
    // взаисимость engineAvail в deps заставила бы эффект перезапуск,
    // а ref ведёт себя актуальное значение без переразданка.
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

  // Загрузить список голосов при входе в режим выбора. Для piper список берётся
  // из индекса HuggingFace (с возможностью скачать голос прямо из UI), для
  // остальных движков — из их локальных моделей через listVoices().
  const activeEngine = draftRef.current.engine;
  useEffect(() => {
    if (!pickingVoice) return;
    let cancelled = false;
    setLoadingVoices(true);
    setVoiceError(null);
    const backend = ttsManager?.resolveBackend(activeEngine);
    // Piper — особый случай: у него голоса качаются с HF.
    if (activeEngine !== 'piper' || !backend?.listVoices) {
      if (!backend?.listVoices) {
        // espeak и подобные: голос = код языка, списка нет.
        setVoices(null);
        setLoadingVoices(false);
        return;
      }
      backend
        .listVoices()
        .then((list) => {
          if (cancelled) return;
          setVoices(
            list.map((v: TtsVoiceEntry) => ({
              id: v.id,
              file: v.id,
              name: v.label,
              language: v.language ?? '',
              languageName: v.language ?? '',
              quality: 'local',
              downloadUrl: '',
              downloads: 0,
              installed: true,
            })),
          );
          const cur = draftRef.current.voice;
          const idx = list.findIndex((v) => v.id === cur);
          setVoiceCursor(idx >= 0 ? idx : 0);
        })
        .catch((e: unknown) => {
          if (!cancelled) setVoiceError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoadingVoices(false);
        });
      return;
    }
    voiceMgr
      .getVoices()
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        // Курсор — на текущем голосе, если он есть в списке.
        const cur = draftRef.current.voice;
        const idx = list.findIndex((v) => v.id === cur);
        setVoiceCursor(idx >= 0 ? idx : 0);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setVoiceError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingVoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickingVoice, voiceMgr, ttsManager, activeEngine]);

  // Pitch/rate поддерживаются на способность самого движка: подпись “only espeak” был захардкой
  // захардкого виджета и считался неверным для любого движка.
  const engine = ttsManager?.resolveBackend(draft.engine);
  const pitchNote = engine?.capabilities.pitchControl
    ? ''
    : ` (${engine ? 'unsupported' : 'engine-dependent'})`;
  const rateNote = engine?.capabilities.rateControl ? '' : ' (resampled)';
  const hasVoiceList = Boolean(engine?.listVoices);

  const rows: Row[] = useMemo(
    () => [
      { kind: 'engine', label: 'Engine', value: draft.engine },
      {
        kind: 'voice',
        label: 'Voice',
        // У espeak голос — это код языка, а не выбираемое из списка.
        value:
          hasVoiceList || draft.engine === 'piper' ? draft.voice : `${draft.voice} (language code)`,
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
        value: draft.engine === 'piper' ? 'piper voices ▸' : 'n/a (local models)',
      },
      { kind: 'apply', label: 'Apply', value: '' },
      { kind: 'cancel', label: 'Cancel', value: '' },
    ],
    [draft, hasVoiceList, pitchNote, rateNote],
  );

  const filteredVoices = useMemo(() => {
    if (!voices) return [];
    const q = voiceFilter.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter(
      (v) =>
        v.id.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.languageName.toLowerCase().includes(q),
    );
  }, [voices, voiceFilter]);

  // splitChunks: быстрый ввод (или вставка) приходит одним чанком, а Ink
  // парсит только первый символ — j/k и h/l serieями терялись бы.
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
            // Голос принадлежит движку: при смене движка старый голос (напр.
            // ru_RU-irina-medium) в новом невалиден, поэтому сбрасываем его и
            // даём движку применить свой дефолт.
            const sameEngine = d.engine === e.id;
            return {
              ...d,
              engine: e.id,
              voice: sameEngine ? d.voice : defaultVoiceFor(e.id, d.engines),
            };
          });
          setPickingEngine(false);
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
          setPickingVoice(false);
          setVoiceFilter('');
          return;
        case 'move_cursor_down':
          setVoiceCursor((c) => Math.min(filteredVoices.length - 1, c + 1));
          return;
        case 'move_cursor_up':
          setVoiceCursor((c) => Math.max(0, c - 1));
          return;
        case 'select': {
          const v = filteredVoices[voiceCursor];
          if (!v) return;
          if (v.installed) {
            // Уже скачан — просто выбираем. В конфиг идёт piper-имя модели
            // (basename без .onnx): именно его piper ищет в каталогах моделей.
            setDraft((d) => ({ ...d, voice: piperVoiceName(v) }));
            setPickingVoice(false);
            setVoiceFilter('');
          } else if (!downloading) {
            // Скачиваем, потом выбираем.
            void downloadVoice(v);
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
      case 'download':
        // Скачивание голосов из UI есть только у piper (индекс HuggingFace).
        // Для остальных движков показываем список движков, а не пустой пикер.
        if (draftRef.current.engine !== 'piper') {
          setPickingEngine(true);
          return;
        }
        setPickingVoice(true);
        return;
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

  async function downloadVoice(v: PiperVoice): Promise<void> {
    setDownloading(v.id);
    setDownloadPct(0);
    try {
      await voiceMgr.downloadVoice(v.id, (done, total) => {
        setDownloadPct(total ? Math.round((done / total) * 100) : 0);
      });
      // Метка installed уезжает в кеш voiceIndex только после refresh;
      // обновляем локальный список, чтобы галочка появилась сразу.
      setVoices(
        (prev) => prev?.map((x) => (x.id === v.id ? { ...x, installed: true } : x)) ?? prev,
      );
      setDraft((d) => ({ ...d, voice: piperVoiceName(v) }));
      setPickingVoice(false);
      setVoiceFilter('');
    } catch (e: unknown) {
      setVoiceError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
      setDownloadPct(0);
    }
  }

  // --- рендер ---

  if (pickingEngine) {
    const items = engines.map((e) => {
      const problem = engineAvail[e.id];
      const hint = problem === undefined || problem === null ? null : installHintFor(e.id);
      // Только первое окно — пока модуль открывается, для остальных
      // строк мешает явный параметр ошибки, а не список повторенных подсказовок.
      const detail =
        problem === undefined
          ? 'checking…'
          : problem === null
            ? 'ready'
            : (hint?.install ?? hint?.package ?? 'not installed');
      return {
        id: e.id,
        label: `${e.id}${problem === null ? ' ✓' : ''}`,
        detail,
        accent: e.id === draft.engine,
      };
    });
    const current = engines[engineCursor];
    const problem = current ? engineAvail[current.id] : undefined;
    const hint = current && problem ? installHintFor(current.id) : null;
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

  if (pickingVoice) {
    const items =
      voices === null
        ? [{ id: 'loading', label: loadingVoices ? 'Loading voices…' : 'No voices' }]
        : filteredVoices.length === 0
          ? [{ id: 'empty', label: voiceFilter ? 'No matches' : 'No voices available' }]
          : filteredVoices.map((v) => ({
              id: v.id,
              label: `${v.installed ? '✓' : '○'} ${v.id}`,
              detail: v.installed
                ? v.languageName
                : `${v.languageName} · ${formatBytes(v.size ?? 0)}`,
              accent: v.id === draft.voice,
            }));
    return (
      <ListModal
        theme={theme}
        title={`Piper voices ${voiceFilter ? `· filter: ${voiceFilter}` : ''}`}
        items={items}
        cursor={voiceCursor}
        height={Math.min(16, Math.max(items.length, 6))}
        footer={
          downloading
            ? `⬇ ${downloading} — ${downloadPct}% … esc back`
            : voiceError
              ? `error: ${voiceError}`
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

/**
 * Подсказка по установке для выбранного движка: можно возвать дефолт
 * звука движка или первый локально найденный модель (напр. више каталог
 * моделей). Голос предыдуществует папка `piper` — она единственный
 * в конфиге для всех движков и не валиден для отдельных серий.
 */
function defaultVoiceFor(
  engineId: string,
  engines: Record<string, { model: string }> | undefined,
): string {
  const fromConfig = engines?.[engineId]?.model;
  if (fromConfig) return fromConfig;
  if (engineId === 'piper') return 'ru_RU-irina-medium';
  // У espeak голос — это код языка, а не имя голоса piper'а.
  if (engineId === 'espeak') return 'ru';
  return '';
}

/** Подсказка по установке для недоступного движка. */
function installHintFor(engineId: string): TtsInstallHint | null {
  switch (engineId) {
    case 'piper':
      return { install: 'yay -S piper-tts', notes: 'or: pipx install piper-tts' };
    case 'sherpa':
      return {
        install: 'yay -S sherpa-onnx',
        notes: 'then unpack a model and set [tts.engines.sherpa].model',
      };
    case 'espeak':
      return { install: 'sudo pacman -S espeak-ng', notes: 'apt install espeak-ng' };
    default:
      return null;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v * 100) / 100));
}
