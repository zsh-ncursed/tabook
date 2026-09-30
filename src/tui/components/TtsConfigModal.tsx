import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Key } from 'ink';
import type { Theme } from '../../themes/themes.js';
import type { Config, TtsConfig } from '../../config/defaults.js';
import { ListModal } from './ListModal.js';
import { createActionResolver, resolveKeyName } from '../keymap.js';
import { useInputDispatch } from '../useInputDispatch.js';
import { VoiceManager, type PiperVoice } from '../../tts/voiceManager.js';
import { formatBytes } from '../../tts/download.js';

export interface TtsConfigModalProps {
  theme: Theme;
  config: Config;
  /** Текущие настройки TTS (черновик редактируется локально). */
  tts: TtsConfig;
  isActive: boolean;
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

// TTS settings modal: engine, voice, rate, pitch, follow toggle, plus an
// embedded Piper voice browser that lists HuggingFace voices and downloads
// the selected one on demand. Settings edit a local draft; Apply persists.
export function TtsConfigModal(props: TtsConfigModalProps): React.JSX.Element {
  const { theme, config, tts, isActive, onApply, onClose } = props;
  const resolver = useMemo(() => createActionResolver(config), [config]);
  const voiceMgr = useMemo(() => new VoiceManager(), []);

  const [draft, setDraft] = useState<TtsConfig>(tts);
  const [cursor, setCursor] = useState(0);
  // Режим выбора голоса (под-список) или настроек (главный список).
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
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const cbRef = useRef({ onApply, onClose });
  cbRef.current = { onApply, onClose };

  // Загрузить список голосов при входе в режим выбора.
  useEffect(() => {
    if (!pickingVoice) return;
    let cancelled = false;
    setLoadingVoices(true);
    setVoiceError(null);
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
  }, [pickingVoice, voiceMgr]);

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [
      { kind: 'engine', label: 'Engine', value: draft.engine },
      { kind: 'voice', label: 'Voice', value: draft.voice },
      { kind: 'rate', label: 'Rate', value: `${draft.rate.toFixed(2)}x` },
      {
        kind: 'pitch',
        label: 'Pitch',
        value: `${draft.pitch.toFixed(2)}${draft.engine === 'piper' ? ' (espeak only)' : ''}`,
      },
      { kind: 'follow', label: 'Follow', value: draft.follow ? 'on' : 'off' },
      { kind: 'download', label: 'Download voice', value: 'piper ▸' },
      { kind: 'apply', label: 'Apply', value: '' },
      { kind: 'cancel', label: 'Cancel', value: '' },
    ];
    return r;
  }, [draft]);

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
            // Уже скачан — просто выбираем.
            setDraft((d) => ({ ...d, voice: v.id }));
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
        // Цикл: piper → espeak → piper
        setDraft((d) => ({ ...d, engine: d.engine === 'piper' ? 'espeak' : 'piper' }));
        return;
      case 'voice':
        setPickingVoice(true);
        return;
      case 'follow':
        setDraft((d) => ({ ...d, follow: !d.follow }));
        return;
      case 'download':
        // Для piper открывает тот же пикер; для espeak — подсказка.
        if (draftRef.current.engine !== 'piper') {
          setDraft((d) => ({ ...d, engine: 'piper' }));
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
      setDraft((d) => ({ ...d, voice: v.id }));
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

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v * 100) / 100));
}
