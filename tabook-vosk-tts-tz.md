# Техническое задание: движок Vosk TTS в tabook

**Версия:** 1.1  
**Статус:** принято  
**Дата:** 2026-10-28  
**База:** ветка `main`, коммит `e05d744` (sherpa-onnx уже влит)

**История версий**

- v1.1 (2026-10-28): подписан §19; исправлены неточности по
  `num_speakers`/`speaker_id_map`, обязательности `bert/` для multistream,
  ненужности `VOSK_MODEL_PATH` при `--model`, актуализирована база.
- v1.0 (2026-10-28): первая редакция на согласование.

---

## Содержание

1. [Цель и объём](#1-цель-и-объём)
2. [Зафиксированные решения](#2-зафиксированные-решения)
3. [Термины](#3-термины)
4. [Текущее состояние](#4-текущее-состояние)
5. [Архитектура](#5-архитектура)
6. [Структура модулей](#6-структура-модулей)
7. [Модели данных](#7-модели-данных)
8. [Бэкенд Vosk](#8-бэкенд-vosk)
9. [Каталог, скачивание и распаковка моделей](#9-каталог-скачивание-и-распаковка-моделей)
10. [UI и UX](#10-ui-и-ux)
11. [Конфигурация и документация](#11-конфигурация-и-документация)
12. [Обработка ошибок](#12-обработка-ошибок)
13. [Производительность](#13-производительность)
14. [Тестирование](#14-тестирование)
15. [Этапы](#15-этапы)
16. [Риски](#16-риски)
17. [Критерии готовности](#17-критерии-готовности)
18. [Вне объёма](#18-вне-объёма)
19. [Принятые решения](#19-принятые-решения-подписано-2026-10-28)

---

## 1. Цель и объём

### 1.1. Цель

Добавить в tabook четвёртый встроенный TTS-бэкенд — `vosk` (пакет `vosk-tts`,
ONNX Runtime) — и сделать выбор движка/голоса/скорости полностью
engine-agnostic: пользователь открывает `:tts config`, выбирает Vosk, при
необходимости ставит движок по подсказке, скачивает модель прямо в UI,
выбирает спикера и слушает книгу. Новый движок не должен требовать правок
ридера и не должен добавлять рантайм-зависимостей в сам tabook.

### 1.2. В объёме

- Бэкенд `vosk` (`TtsBackend`): поиск бинарника, проверка модели, синтез
  в WAV, список локальных голосов, подсказка установки.
- Поддержка русских моделей Vosk TTS: `0.9-multi` (5 спикеров),
  `0.4-irina`, `0.4-natasha`. `0.1-tamara` исключена: её словарь без
  длительностей фонем несовместим с `vosk-tts` 0.3.61 (см. §13.2).
- Каталог моделей с alphacephei.com, кеш на диске, скачивание с прогрессом,
  проверка `md5`, распаковка zip, установка в `~/.local/share/vosk`.
- Формат голоса `модель#спикер` в существующем поле `tts.voice`.
- Рефакторинг контракта `TtsBackend`: опциональные `voiceCatalog()`,
  `installVoice()`, `defaultVoice()`; модалка перестаёт знать про piper.
- Выбор спикера отдельным пикером для multi-моделей.
- Отмена скачивания по `Esc`, очистка частичных файлов.
- Тесты, документация, проверка в живом терминале, замеры RTF.

### 1.3. Вне объёма

- Распознавание речи (ASR), голосовые команды, диктовка.
- Докачка прерванных загрузок (HTTP Range/resume).
- Удаление/обновление моделей из UI.
- Автоматический выбор языка книги под движок.
- Другие языки Vosk TTS (сейчас стабильно есть только русский).
- AUR-пакет для `vosk-tts`.
- Windows/macOS.

---

## 2. Зафиксированные решения

| Вопрос               | Решение                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Контракт движков     | Расширяем `TtsBackend` опциональными методами; модалка работает только через контракт.                                                    |
| Формат голоса        | `модель#спикер`, напр. `vosk-model-tts-ru-0.9-multi#2`. Без `#` — спикер 0.                                                               |
| Список голосов       | Каталог перечисляет **модели**; для multi-модели открывается отдельный пикер спикера.                                                     |
| Источник каталога    | `https://alphacephei.com/vosk/models/model-list.json` (HF-репозитории Vosk содержат `.pth`, не ONNX).                                     |
| Куда ставить         | `~/.local/share/vosk/<model-id>/`; переопределение — `[tts.engines.vosk].models_dir` и `VOSK_MODEL_PATH`.                                 |
| Скачивание           | Встроенное, с прогрессом, проверкой `md5`, отменой; zip удаляется после распаковки.                                                       |
| Распаковка           | Внешний `bsdtar` → fallback `unzip`; без изменений в Rust-ядре и без `adm-zip` для больших архивов.                                       |
| Python-движок        | Пользователь ставит сам: `sudo pacman -S pipx && pipx install vosk-tts`.                                                                  |
| Скорость             | `vosk-tts --speech-rate`; pitch не поддерживается (`pitchControl = false`).                                                               |
| Синтез               | Persistent worker (`voskWorker.ts`): модель грузится один раз; сессия ONNX обёрнута прокси, отбрасывающим вход `sid`, которого нет у 0.4. |
| Рекомендуемая модель | `vosk-model-tts-ru-0.4-irina` (~116 МБ) как быстрая; `0.9-multi` — как качественная/многоголосая.                                         |
| Статус-бар           | Первая строка `check()` должна быть самодостаточной: сообщение обрезается до одной строки.                                                |

---

## 3. Термины

| Термин               | Значение                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| Движок / бэкенд      | Реализация `TtsBackend` (`piper`, `sherpa`, `espeak`, `vosk`).           |
| Голос                | Значение `tts.voice`; для Vosk — `модель#спикер`.                        |
| Модель               | Каталог с `model.onnx`, `config.json`, `dictionary` (у 0.9 ещё `bert/`). |
| Спикер               | Идентификатор голоса внутри multi-модели, `0..N-1`.                      |
| Каталог              | Список доступных для скачивания моделей с метаданными.                   |
| Установленная модель | Каталог модели, прошедший валидацию и лежащий в `models_dir`.            |
| Чанк                 | Фрагмент книги, отправляемый в синтез (абзац/предложение).               |

---

## 4. Текущее состояние

### 4.1. Что уже работает и переиспользуется

| Механизм                 | Где                                                 | Комментарий                                                                                                            |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Контракт бэкенда         | `src/tts/backend.ts`                                | `id`, `label`, `capabilities`, `check()`, `synthesize()`, `configure()`, `listVoices()`, `installHint()`, `dispose()`. |
| Реестр движков           | `src/tts/manager.ts`                                | `register()`, `resolveBackend()`, `engines`, `check(id)`.                                                              |
| Регистрация              | `src/tts/index.ts`                                  | `createDefaultTtsManager()`; новый бэкенд появляется в UI сам.                                                         |
| Выбор движка             | `src/tui/components/TtsConfigModal.tsx`             | Список из `ttsManager.engines`, проверка доступности, подсказка установки.                                             |
| Голоса piper             | `src/tts/voiceIndex.ts`, `voiceManager.ts`, `hf.ts` | HF-индекс, кеш 24 ч, скачивание `.onnx` + `.onnx.json`.                                                                |
| Скачивание               | `src/tts/download.ts`                               | Стрим с прогрессом, `AbortSignal`, удаление partial-файла.                                                             |
| Поиск бинарников/моделей | `src/tts/modelPaths.ts`                             | `expandPath`, `commandAvailable`, `modelSearchDirs`, `resolveEngineBin`.                                               |
| Конфиг                   | `src/config/config.ts`, `defaults.ts`               | `[tts]` и `[tts.engines.<id>]` уже парсятся.                                                                           |
| Pre-flight               | `src/tts/manager.ts`                                | `check()` до синтеза, ошибка в статус-бар.                                                                             |

### 4.2. Что захардкожено под piper и подлежит переписыванию

| Место                                          | Проблема                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `TtsConfigModal.tsx` → `installHintFor()`      | Отдельный `switch` по id вместо `backend.installHint()`; новый движок покажет только `not installed`. |
| `TtsConfigModal.tsx` → заголовок пикера        | Всегда `Piper voices`.                                                                                |
| `TtsConfigModal.tsx` → `defaultVoiceFor()`     | Знает только `piper`/`espeak`.                                                                        |
| `TtsConfigModal.tsx` → строка `Download voice` | Скачивание доступно только для piper.                                                                 |
| `TtsConfigModal.tsx` → загрузка голосов        | Ветка `activeEngine !== 'piper'`; тип `PiperVoice[]`.                                                 |
| `voiceManager.ts`                              | Скачивание привязано к piper (`.onnx` + `.onnx.json`, путь HF).                                       |

---

## 5. Архитектура

```
┌──────────────────────────────────────────────────────────┐
│ TUI (React + Ink)                                        │
│  TtsConfigModal                                          │
│   ├─ engine picker  → mgr.engines + backend.check()      │
│   │                    + backend.installHint()           │
│   ├─ voice picker   → backend.voiceCatalog() | listVoices│
│   ├─ speaker picker → entry.speakers > 1                 │
│   └─ install        → backend.installVoice() + progress  │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│ TtsManager                                               │
│  ├─ registry: piper | sherpa | espeak | vosk             │
│  ├─ queue/chunks, status, follow                         │
│  └─ backend.synthesize(chunk, voice) → WavSource         │
└───────────────────────────┬──────────────────────────────┘
                            │ spawn
┌───────────────────────────▼──────────────────────────────┐
│ vosk-tts (Python, onnxruntime)                           │
│  --model <dir> --speaker <n> --speech-rate <x>           │
│  --input=<text> --output <wav>                           │
└───────────────────────────┬──────────────────────────────┘
                            │
                      SystemPlayer (paplay/aplay/ffplay)
```

Принципы:

1. **Бэкенд — единственный источник знаний о движке.** UI не содержит
   `if (engine === 'vosk')`.
2. **Сеть только по действию пользователя.** `check()` и `listVoices()` не
   ходят в сеть; каталог загружается при открытии пикера голосов.
3. **Никаких новых рантайм-зависимостей.** Используем существующие
   `downloadFile`, `modelPaths`, `adm-zip` (только для чтения книг).
4. **Установка атомарна.** Скачивание и распаковка — во временные пути;
   финальный каталог появляется только после валидации.
5. **Ошибка не ломает TUI.** Одна строка в статус-бар, подробности — в
   подсказке модалки/логе.

---

## 6. Структура модулей

### 6.1. Новые файлы

| Файл                          | Назначение                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/tts/vosk.ts`             | `VoskBackend`: `check`, `synthesize`, `listVoices`, `voiceCatalog`, `installVoice`, `defaultVoice`, `installHint`. |
| `src/tts/voskIndex.ts`        | Каталог моделей: fetch `model-list.json`, фильтрация, кэш, парсинг метаданных.                                     |
| `src/tts/voskInstall.ts`      | Скачивание zip, md5, распаковка (`bsdtar`/`unzip`), валидация, атомарная установка.                                |
| `src/tts/stderr.ts`           | Общий `summarizeEngineStderr()` для piper/sherpa/vosk.                                                             |
| `src/tts/cliText.ts`          | Общий `sanitizeForCli()` (вынесен из sherpa, используется vosk).                                                   |
| `src/tts/vosk.test.ts`        | Unit-тесты бэкенда.                                                                                                |
| `src/tts/voskIndex.test.ts`   | Unit-тесты каталога и кеша.                                                                                        |
| `src/tts/voskInstall.test.ts` | Unit-тесты установки/валидации/отмены.                                                                             |

### 6.2. Изменяемые файлы

| Файл                                         | Изменение                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/tts/backend.ts`                         | Новые типы `TtsVoiceInstallPhase`, `TtsVoiceInstallProgress`; поля `TtsVoiceEntry`; опциональные методы контракта. |
| `src/tts/index.ts`                           | Регистрация `VoskBackend`, реэкспорт типов.                                                                        |
| `src/index.ts`                               | Экспорт `VoskBackend` и новых типов.                                                                               |
| `src/tts/piper.ts`                           | `voiceCatalog()`, `installVoice()`, `defaultVoice()`; реэкспорт `summarizeStderr` из `stderr.ts`.                  |
| `src/tts/espeak.ts`, `src/tts/sherpa.ts`     | `defaultVoice()` (устраняет хардкод в модалке).                                                                    |
| `src/tui/components/TtsConfigModal.tsx`      | Engine-agnostic пикеры, спикер, прогресс, отмена.                                                                  |
| `src/tui/components/TtsConfigModal.test.tsx` | Тесты нового поведения.                                                                                            |
| `docs/TTS.md`                                | Раздел про Vosk, обновление сравнения и «как добавить движок».                                                     |
| `docs/CONFIGURATION.md`                      | `engine = "vosk"`, формат `voice`, `[tts.engines.vosk]`, установка.                                                |
| `tabook.install`                             | Строка подсказки про Vosk (pipx).                                                                                  |
| `PKGBUILD`                                   | Без изменений: `vosk-tts` нет в AUR, жёстких зависимостей не добавляем.                                            |

---

## 7. Модели данных

### 7.1. Расширение контракта

```ts
// src/tts/backend.ts

export interface TtsVoiceEntry {
  /** Идентификатор голоса/модели внутри бэкенда. */
  id: string;
  /** Человекочитаемое имя для списка. */
  label: string;
  /** Язык (BCP-47), если известен. */
  language?: string;
  /** Установлен ли голос/модель. По умолчанию true (для listVoices). */
  installed?: boolean;
  /** Размер архива/файла в байтах (для каталога). */
  size?: number;
  /** Число спикеров; > 1 включает пикер спикера. */
  speakers?: number;
  /**
   * Значение для tts.voice, если пикер спикера не нужен.
   * По умолчанию равен id (piper: basename .onnx без расширения).
   */
  configVoice?: string;
}

export type TtsVoiceInstallPhase = 'download' | 'verify' | 'extract' | 'validate';

export interface TtsVoiceInstallProgress {
  phase: TtsVoiceInstallPhase;
  /** Для phase='download' — байты. */
  done?: number;
  total?: number;
  /** Готовая строка для футера (необязательно). */
  message?: string;
}

export interface TtsBackend {
  // ... существующие поля ...

  /** Локальные голоса (offline, быстро). */
  listVoices?(): Promise<TtsVoiceEntry[]>;

  /** Онлайн-каталог моделей/голосов (может ходить в сеть). */
  voiceCatalog?(signal?: AbortSignal): Promise<TtsVoiceEntry[]>;

  /**
   * Установить голос/модель по id из каталога.
   * Возвращает значение для tts.voice (напр. basename .onnx или `model#0`).
   */
  installVoice?(
    voiceId: string,
    onProgress: (p: TtsVoiceInstallProgress) => void,
    signal?: AbortSignal,
  ): Promise<string>;

  /** Голос по умолчанию для нового движка (синхронно, без I/O). */
  defaultVoice?(): string;
}
```

Совместимость: все новые поля и методы опциональны; существующие бэкенды и
сторонние реализации продолжают работать без изменений.

### 7.2. Соглашение о multi-спикерах

- Если `speakers === 1` или поле не задано — голос берётся из
  `configVoice ?? id`.
- Если `speakers > 1` — модалка открывает пикер спикера и записывает
  `voice = `${entry.id}#${speaker}``.
- Бэкенд обязан понимать и `id` без `#` (спикер 0), и `id#N`.

### 7.3. Кэш каталога Vosk

`~/.config/tabook/tts-vosk-index.json`:

```json
{
  "updatedAt": 1790000000000,
  "models": [
    {
      "id": "vosk-model-tts-ru-0.9-multi",
      "label": "Vosk TTS RU 0.9 multi",
      "language": "ru",
      "size": 782787154,
      "md5": "2f8b6dbf64e912f9ee7eda50ba2d3c80",
      "url": "https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.9-multi.zip",
      "speakers": 5,
      "version": "0.9-multi"
    }
  ]
}
```

TTL — 24 часа. Запись атомарная: temp-файл + `rename`. При ошибке сети:
используем кеш (даже просроченный), в футере — предупреждение; если кеша нет —
показываем локальные модели и ошибку каталога.

### 7.4. Конфиг

Новых ключей нет. Используются существующие:

```toml
[tts]
mode = "active"
engine = "vosk"
voice = "vosk-model-tts-ru-0.4-irina#0"
rate = 1.0

[tts.engines.vosk]
command = ""                 # пусто = автопоиск vosk-tts
models_dir = "~/.local/share/vosk"
model = "vosk-model-tts-ru-0.4-irina"   # модель по умолчанию
```

---

## 8. Бэкенд Vosk

### 8.1. Идентификация

```ts
readonly id = 'vosk';
readonly label = 'Vosk TTS (ONNX, RU)';
readonly capabilities = {
  languages: ['ru'],
  offline: true,
  rateControl: true,
  pitchControl: false,
};
```

### 8.2. Поиск бинарника

Порядок (через `resolveEngineBin`/`commandAvailable`):

1. `[tts.engines.vosk].command` или общий `[tts] command`.
2. `VOSK_TTS_COMMAND` (env), затем `TABOOK_TTS_COMMAND`.
3. `vosk-tts` в `PATH`.
4. `~/.local/bin/vosk-tts`.
5. pipx: `~/.local/share/pipx/venvs/vosk-tts/bin/vosk-tts`,
   `~/.local/pipx/venvs/vosk-tts/bin/vosk-tts`.
6. venv рядом с tabook: `.tts-venv/bin/vosk-tts`, `venv/bin/vosk-tts`
   (подъём вверх, как в `piper.ts`).

### 8.3. Поиск модели

Порядок:

1. `[tts.engines.vosk].models_dir`.
2. `VOSK_MODEL_PATH`.
3. `~/.local/share/vosk`, `~/.local/share/tabook/vosk`,
   `~/.cache/vosk`, `~/vosk-models`, `.tts-models` (подъём вверх).

Модель валидна, если каталог содержит:

- `model.onnx`;
- `config.json`;
- `dictionary`.

`bert/` обязателен, когда `config.json.model_type` начинается с
`multistream_` (так у `0.9-multi`): нужны `bert/model.onnx` и
`bert/vocab.txt`. Для остальных моделей (`0.4-*`, `0.1-*`) его нет и он не
требуется — проверять по `model_type`, а не по имени каталога.

### 8.4. `check()`

Возвращает `null` или текст ошибки. **Первая строка всегда самодостаточна**
(статус-бар обрезает сообщение):

| Ситуация      | Первая строка                                               |
| ------------- | ----------------------------------------------------------- |
| Нет бинарника | `vosk-tts not found — install: pipx install vosk-tts`       |
| Нет модели    | `Vosk model not found — download it in :tts config → Voice` |
| Модель битая  | `Vosk model is incomplete: <path> (missing <file>)`         |
| Всё готово    | `null`                                                      |

Подробные шаги (команды, ссылки, `[tts.engines.vosk]`) — со второй строки;
их показывает модалка, а не статус-бар.

### 8.5. Формат голоса

```ts
export function parseVoskVoice(
  voice: string,
  fallbackModel: string,
): { model: string; speaker: number };
```

- `"model#2"` → `{ model: 'model', speaker: 2 }`.
- `"model"` → `{ model: 'model', speaker: 0 }`.
- `""` → `{ model: fallbackModel, speaker: 0 }`.
- Если часть до `#` — существующий каталог (абсолютный путь или `~`),
  используем его как путь к модели.
- Некорректный/отрицательный спикер → 0; верхняя граница проверяется по
  `speakerCount()`.

### 8.6. Число спикеров

```ts
export function readSpeakerCount(modelDir: string): number;
```

Порядок:

1. `config.json` → `num_speakers` (фактический ключ у `0.4-*` и
   `0.9-multi`), затем `n_speakers`, `data.n_speakers`,
   `model.n_speakers`, затем длина `speaker_id_map`.
2. Fallback: имя каталога содержит `-multi` → 5, иначе 1.
3. Ограничение `[1, 20]`.

Важно: у `0.9-multi` `speaker_id_map` — это **список имён**
(`["female_0","female_1","female_2","male_0","male_1"]`), порядок = id
спикера. Имена содержат пол, но UI по решению §19.5 показывает нейтральные
`speaker 0..N-1`; маппинг не используется и может отсутствовать у других
моделей.

Для удалённых моделей в каталоге число спикеров оценивается по имени
(`-multi` → 5). После установки источник истины — `config.json`.

### 8.7. `synthesize()`

```ts
const args = [
  '--model',
  modelDir,
  '--speaker',
  String(speaker),
  '--speech-rate',
  rate.toFixed(2),
  '--log-level',
  'error',
  `--input=${sanitizeForCli(chunk.text)}`,
  '--output',
  outWav,
];
```

Требования:

- `rate` клампится в `[0.25, 4]`; `1.0` можно передавать всегда.
- `--input=` — **обязательно** форма с `=`: иначе текст, начинающийся с `-`,
  будет распознан argparse как флаг.
- `sanitizeForCli()`: убрать control-символы, схлопнуть переводы строк,
  не дать строке начаться с `-` (переиспользовать/вынести из `sherpa.ts`).
- `spawn()` с массивом аргументов, без shell.
- env: дополнительных переменных не требуется. При заданном `--model <dir>`
  `vosk-tts` не вызывает `get_model_path()` и ничего не скачивает;
  `VOSK_MODEL_PATH` читается только при выборе модели по имени
  (`-n`/`-l`), который мы не используем.
- stderr сжимается до одной строки через `summarizeEngineStderr()`.
- `ENOENT` → ошибка с подсказкой установки.
- Ненулевой код → `vosk-tts failed (<code>): <строка>`.
- Выходной файл: `os.tmpdir()/tabook-vosk-<pid>-<rand>.wav`.

### 8.8. `listVoices()`

Сканирует `models_dir`/стандартные каталоги и возвращает **конкретные**
голоса:

```ts
{ id: 'vosk-model-tts-ru-0.4-irina#0', label: 'vosk-model-tts-ru-0.4-irina', language: 'ru', installed: true }
{ id: 'vosk-model-tts-ru-0.9-multi#0', label: 'vosk-model-tts-ru-0.9-multi · speaker 0', language: 'ru', installed: true, speakers: 5 }
// ... #1..#4
```

Для одной модели с `speakers = N` возвращаем N записей. Это нужно для
fallback-режима, когда каталог недоступен.

### 8.9. `voiceCatalog()`

Возвращает **модели**, а не спикеров:

```ts
{ id: 'vosk-model-tts-ru-0.9-multi', label: '...', language: 'ru', size: 782787154, speakers: 5, installed: false }
```

`installed` вычисляется по наличию валидного каталога модели.
Сортировка: установленные → язык → имя.

### 8.10. `installVoice()`

1. Найти метаданные модели в каталоге (id, url, size, md5).
2. Определить `models_dir`, создать его.
3. Если модель уже установлена и валидна — вернуть `id#0`.
4. Проверить свободное место (`fs.statfs`, если доступен): нужно
   `size + 100 МБ`; иначе ошибка `Not enough disk space`.
5. Скачать в `<models_dir>/.<id>.zip.part` через `downloadFile`:
   `expectedSize = size`, `timeoutMs = 60 * 60 * 1000`, `signal`.
   Прогресс → `phase: 'download'`.
6. Проверить `md5` потоково (`createReadStream` + `createHash('md5')`).
   Несовпадение → удалить файл, ошибка `checksum mismatch`.
7. `phase: 'verify'` завершён; распаковать в
   `<models_dir>/.tmp-<id>-<pid>-<rand>`:
   `bsdtar -xf <zip> -C <tmp>`, иначе `unzip -q <zip> -d <tmp>`.
   Нет обоих → ошибка с подсказкой `install libarchive or unzip`.
   Прогресс → `phase: 'extract'`.
8. Найти каталог модели внутри tmp: `<tmp>/<id>` либо единственный
   верхнеуровневый каталог.
9. Валидировать `model.onnx`, `config.json`, `dictionary`, а для
   `model_type` из `multistream_*` — ещё `bert/model.onnx` и
   `bert/vocab.txt`.
   Прогресс → `phase: 'validate'`.
10. Атомарно установить:
    - существующий `<models_dir>/<id>` переименовать в `.old-<id>-<rand>`;
    - `rename(tmpModelDir, <models_dir>/<id>)`;
    - удалить `.old-*`, tmp и zip.
11. При любой ошибке/отмене: удалить `.zip.part`, tmp; старую модель не
    трогать.
12. Вернуть `id#0`.

### 8.11. `defaultVoice()`

- Если `[tts.engines.vosk].model` задан → `${model}#0`.
- Иначе `''` (менеджер/бэкенд выберет первую установленную модель).

### 8.12. `installHint()`

```ts
{
  package: 'vosk-tts',
  install: 'sudo pacman -S pipx && pipx install vosk-tts',
  notes:
    'Then download a model: :tts config → Voice ' +
    '(recommended: vosk-model-tts-ru-0.4-irina, ~116 MB)',
}
```

В AUR пакета `vosk-tts` нет (есть только ASR-пакеты `vosk-api`), это
фиксируем в `docs/TTS.md`.

---

## 9. Каталог, скачивание и распаковка моделей

### 9.1. Источник

`GET https://alphacephei.com/vosk/models/model-list.json` (один запрос,
небольшой JSON). Фильтр:

```ts
m.type === 'tts' && m.obsolete !== 'true';
```

Поля: `name`, `lang`, `size`, `md5`, `url`, `version`, `obsolete`, `type`.
Для `speakers` — эвристика по `name` (`-multi` → 5, иначе 1).

### 9.2. Кеш

- Путь: `~/.config/tabook/tts-vosk-index.json`.
- TTL: 24 часа (по `updatedAt`, не по mtime — проще тестировать).
- Атомарная запись.
- При ошибке сети: stale cache + предупреждение; нет кеша — ошибка в футере.

### 9.3. Скачивание

Используем существующий `downloadFile()` (`src/tts/download.ts`):

- стрим, прогресс, удаление partial при ошибке;
- `AbortSignal` для отмены;
- для моделей — увеличенный таймаут (60 минут).

### 9.4. Распаковка

Почему не `adm-zip`: он уже есть в зависимостях и используется для чтения
FB2/EPUB, но `extractAllTo` держит распакованную запись в памяти; для
`model.onnx` в сотни мегабайт это лишний пик RSS. Для больших архивов
используем потоковые внешние утилиты.

- `bsdtar -xf <zip> -C <dir>` (libarchive есть в базовом Arch).
- fallback `unzip -q <zip> -d <dir>`.
- Если нет ни одной — понятная ошибка, без «тихой» установки.

### 9.5. Атомарность и очистка

- Временные пути: `.zip.part`, `.tmp-<id>-*`, `.old-<id>-*`.
- Финальный каталог появляется только после валидации.
- При отмене/ошибке временные файлы удаляются.
- Zip удаляется после успешной установки.

---

## 10. UI и UX

### 10.1. Выбор движка

Без изменений по структуре, но подсказка берётся из бэкенда:

```ts
const backend = ttsManager?.resolveBackend(engine.id);
const hint = problem ? backend?.installHint?.() : null;
```

`detail`:

- `checking…` — проверка идёт;
- `ready` — `check() === null`;
- `hint.install ?? hint.package ?? 'not installed'` — недоступен.

Футер: `hint.notes ?? hint.install`.

### 10.2. Выбор голоса

Заголовок: `${backend.label} voices`.

Источник:

1. `backend.voiceCatalog()` — если метод есть;
2. иначе `backend.listVoices()`;
3. иначе (espeak) — сообщение «engine uses language codes».

Элемент списка:

```
✓ vosk-model-tts-ru-0.4-irina        Russian · installed
○ vosk-model-tts-ru-0.9-multi        Russian · 746.5 MB · 5 voices
```

Сортировка: установленные → язык → имя.

### 10.3. Выбор спикера

Открывается, если у выбранной модели `speakers > 1`.

```
TTS · vosk-model-tts-ru-0.9-multi · speaker
> speaker 0
  speaker 1
  ...
```

Enter → `voice = "<model>#<speaker>"`, закрыть оба пикера.
Esc → назад к списку моделей.

### 10.4. Установка

- Если модель не установлена, `Enter` запускает `installVoice()`.
- Футер: `⬇ <model> — 42%` → `verifying…` → `extracting…` →
  `installed`.
- Ввод не блокируется.
- `Esc` во время установки: `AbortController.abort()`, остаёмся в списке,
  запись остаётся `○`.
- Повторный `Enter` после отмены запускает заново.
- После успеха: `installed = true`, выбор спикера (если нужно), затем
  `draft.voice`. В конфиг попадает только после `Apply` (как у piper).

### 10.5. Строка `Download voice`

- Показывается только если у активного бэкенда есть `voiceCatalog`.
- Для `sherpa`/`espeak` строка скрыта (локальные модели), вместо неё —
  подсказка в строке `Voice`.
- Для piper и vosk открывает пикер голосов.

### 10.6. Rate / Pitch

- `Rate` работает через `--speech-rate`; подпись без `(resampled)`.
- `Pitch` — `pitchControl = false`, подпись `(unsupported)`; значение
  игнорируется бэкендом.
- Значения те же: rate `0.25..4`, pitch `0.5..2`.

### 10.7. Уведомления

- `:tts` при ошибке показывает первую строку `check()` в статус-баре.
- Полная инструкция доступна в `:tts config` (футер пикера движка).
- `:tts engines` показывает `vosk — Vosk TTS (ONNX, RU) (ready)` или без
  пометки, если движок недоступен.

---

## 11. Конфигурация и документация

### 11.1. `docs/CONFIGURATION.md`

- В списке движков: `piper`, `sherpa`, `espeak`, `vosk`.
- Пример `voice = "vosk-model-tts-ru-0.4-irina#0"`.
- `[tts.engines.vosk]` с `command`, `models_dir`, `model`.
- Раздел «Prerequisites»: движок ставится через `pipx`, модели — кнопкой
  в `:tts config`; формулировку «tabook never downloads anything» заменить
  на «tabook никогда не устанавливает движки сам; голоса/модели
  скачиваются только по явному действию пользователя».

### 11.2. `docs/TTS.md`

- Новый раздел про Vosk: модели, размеры, спикеры, установка, CLI-квирки
  (`--input=`, `--log-level`, `-m` против автоскачивания).
- Обновить таблицу сравнения движков (piper/sherpa/silero/vosk).
- Обновить §11.6 «Как добавить свой движок»: `voiceCatalog`,
  `installVoice`, `defaultVoice`.
- Зафиксировать замеры RTF/времени загрузки после реализации.

### 11.3. `tabook.install`

Добавить строку:

```sh
echo "  Vosk TTS (optional): pipx install vosk-tts, then download a model in :tts config"
```

`PKGBUILD` не меняется: жёсткой зависимости нет, AUR-пакета `vosk-tts` нет.

---

## 12. Обработка ошибок

| Ситуация             | Поведение                                                                |
| -------------------- | ------------------------------------------------------------------------ |
| Нет `vosk-tts`       | `check()` → подсказка pipx; `:tts` не запускает синтез.                  |
| Нет модели           | Подсказка скачать в `:tts config`; синтез не стартует.                   |
| Битая модель         | Ошибка с именем отсутствующего файла; предложение переустановить.        |
| Нет сети, есть кеш   | Каталог из кеша, предупреждение в футере.                                |
| Нет сети, нет кеша   | Локальные модели + ошибка каталога; установка недоступна.                |
| Нет `bsdtar`/`unzip` | Ошибка с командой установки; zip и tmp удаляются.                        |
| `md5` не совпал      | Ошибка, partial удаляется, повторная попытка возможна.                   |
| Мало места           | Pre-flight ошибка до скачивания.                                         |
| Отмена (`Esc`)       | `Download cancelled`, очистка; список остаётся открытым.                 |
| Ошибка синтеза       | `vosk-tts failed (N): <последняя значимая строка stderr>`.               |
| `ENOENT` при spawn   | Ошибка с подсказкой установки.                                           |
| Долгий синтез        | Не блокирует UI; `stop()` инвалидирует поколение (уже есть в менеджере). |

Требование к сообщениям: первая строка — до ~80 символов, без переводов
строк; детали — ниже (для модалки/логов).

---

## 13. Производительность

### 13.1. Ожидаемые цифры

| Модель                          | Размер zip | Спикеры | Ожидание                                                       |
| ------------------------------- | ---------- | ------- | -------------------------------------------------------------- |
| `vosk-model-tts-ru-0.4-irina`   | ~116 МБ    | 1       | после прогрева быстрее реального времени                       |
| `vosk-model-tts-ru-0.4-natasha` | ~116 МБ    | 1       | как 0.4-irina                                                  |
| `vosk-model-tts-ru-0.9-multi`   | ~746 МБ    | 5       | долгая загрузка (~2.5 мин), синтез медленнее реального времени |
| `vosk-model-tts-ru-0.1-tamara`  | ~71 МБ     | 1       | несовместима с `vosk-tts` 0.3.61                               |

### 13.2. Замеры (fact, 2026-10-28)

Машина разработки, CPU-only, onnxruntime 1.31.1, `vosk-tts` 0.3.61,
worker-процесс с загрузкой модели один раз:

| Модель                  | Первый чанк (загрузка + синтез) | Следующие чанки | RTF синтеза |
| ----------------------- | ------------------------------- | --------------- | ----------- |
| `0.4-irina`             | 8.1 с                           | 0.64–0.97 с     | ≈ 0.11–0.15 |
| `0.9-multi` (speaker 0) | 148.8 с                         | 2.9–5.8 с       | ≈ 0.6–0.8   |

Вывод: 0.4-irina остаётся дефолтом; 0.9-multi — качественная/многоголосая
опция. CLI на каждый чанк не используется: кроме повторной загрузки модели,
`vosk-tts` 0.3.61 всегда подаёт вход `sid`, которого нет у 0.4 → `Invalid
input name: sid`. Worker оборачивает ONNX-сессию прокси, и 0.4 работает.

Модель `0.1-tamara` не предлагается: её `dictionary` хранит фонемы без
длительностей (`!SIL SIL`), `Synth` ждёт три колонки и падает
`ValueError: could not convert string to float: 'SIL'`. Фильтр — в
`voskIndex.ts`; локальная 0.1-модель скрывается из `listVoices()`.

### 13.3. Ограничения

- Первый чанк после старта приложения платит за загрузку модели (0.4 — ~8 с,
  0.9 — ~149 с); дальше модель живёт в памяти worker'а.
- 0.9-multi + BERT требует много RAM и грузится минутами.
- G2P понимает только русскую кириллицу: текст нормализуется
  (`voskText.ts`), латиница транслитерируется, числа — словами.

---

## 14. Тестирование

### 14.1. Unit (vitest)

`src/tts/vosk.test.ts`:

- `check()` без бинарника → первая строка содержит `pipx install vosk-tts`;
- `check()` с фейковым бинарником и без модели → подсказка про скачивание;
- `check()` с валидной моделью → `null`;
- `parseVoskVoice`: `model#2`, `model`, `''`, путь, некорректный спикер;
- `readSpeakerCount`: `n_speakers` из config.json, fallback `-multi`;
- `buildVoskArgs`: `--model`, `--speaker`, `--speech-rate`, `--input=`,
  `--output`, `--log-level=error`; текст с ведущим `-` не ломает argparse;
- `capabilities`: `ru`, offline, rate, без pitch;
- `installHint()` содержит pipx.

`src/tts/voskIndex.test.ts`:

- парсинг `model-list.json`: только `type=tts`, `obsolete=false`;
- кеш: запись/чтение/TTL;
- ошибка сети → stale cache;
- атомарная запись (temp + rename) — по возможности.

`src/tts/voskInstall.test.ts`:

- валидация каталога модели (нет `model.onnx` → ошибка);
- выбор `bsdtar`/`unzip` (мок `commandAvailable`);
- успешная установка из маленького zip (созданного через `adm-zip`);
- отмена по `AbortSignal` → partial/tmp удалены, старая модель цела;
- `md5` mismatch → ошибка и очистка.

`src/tui/components/TtsConfigModal.test.tsx`:

- подсказка движка берётся из `installHint()` фейкового бэкенда;
- пикер голосов для не-piper движка с `voiceCatalog()`;
- установленная модель выбирается без установки;
- `speakers > 1` → пикер спикера → `voice = model#2`;
- неустановленная модель → `installVoice()` вызван, прогресс отображён;
- `Esc` во время установки → `abort()` вызван;
- заголовок пикера соответствует label движка.

### 14.2. Регрессия

- Существующие тесты piper/voiceManager/voiceIndex остаются зелёными
  (piper переводится на новые методы без изменения поведения).
- `TtsConfigModal` тесты обновляются под engine-agnostic путь.
- Порог покрытия `vitest.config.ts` (82/78/80/74) не снижается.

### 14.3. Сборка и статика

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

`npm run test:native` не требуется, если `crates/` не менялись (в этом ТЗ
изменений нет).

### 14.4. Живой терминал (по AGENTS.md)

1. `sudo pacman -S pipx` (если нет), `pipx install vosk-tts`.
2. `npm run build`, запустить `node dist/cli/main.js` в реальном терминале.
3. `:tts config` → Engine → `vosk`:
   - без бинарника — `not installed` + pipx-подсказка;
   - с бинарником, без модели — `ready` + подсказка скачать.
4. Voice → скачать `0.4-irina` (прогресс, `✓`), Apply.
5. Открыть русскую книгу, `v` — слышна речь; `V` — стоп.
6. `pgrep -af "vosk-tts|vosk_tts"` после `V`/выхода — процессов нет
   (worker — Python-процесс с `-c` и импортом `vosk_tts`).
7. `Rate 1.5` — темп меняется; `Pitch` — `(unsupported)`.
8. `0.9-multi`: скачать, выбрать спикеров 0 и 4 — голоса различаются.
9. Отключить сеть: каталог из кеша / предупреждение; локальные модели
   выбираются.
10. Отмена скачивания по `Esc`: partial/tmp отсутствуют, список открыт.
11. `:tts engines` — `vosk ... (ready)`.

---

## 15. Этапы

### Этап 1. Контракт и модалка (без Vosk)

- [x] Расширить `TtsVoiceEntry` и `TtsBackend` (`voiceCatalog`,
      `installVoice`, `defaultVoice`, типы прогресса).
- [x] Перевести piper на `voiceCatalog`/`installVoice`/`defaultVoice`.
- [x] Убрать `installHintFor`, `piperVoiceName`, piper-ветку из модалки.
- [x] Динамический заголовок пикера, строка `Download voice` по наличию
      каталога.
- [x] Тесты piper и модалки зелёные; поведение piper не изменилось.

### Этап 2. Бэкенд Vosk (без скачивания)

- [x] `src/tts/vosk.ts`: бинарник, модель, `check`, `parseVoskVoice`,
      `readSpeakerCount`, `synthesize`, `listVoices`, `installHint`.
- [x] `src/tts/stderr.ts`, перевод piper на общий summarizer.
- [x] Регистрация в `tts/index.ts` и `src/index.ts`.
- [x] Unit-тесты `vosk.test.ts`.

### Этап 3. Каталог и установка

- [x] `voskIndex.ts`: fetch, фильтр, кеш, stale fallback.
- [x] `voskInstall.ts`: download, md5, extract, validate, atomic rename,
      cleanup, cancel.
- [x] `voiceCatalog`/`installVoice` в `VoskBackend`.
- [x] UI: список моделей, размеры, прогресс, отмена, пикер спикера.
- [x] Тесты `voskIndex`, `voskInstall`, модалки.

### Этап 4. Документация и приёмка

- [x] `docs/TTS.md`, `docs/CONFIGURATION.md`, `tabook.install`.
- [x] Замеры RTF/загрузки, запись в docs.
- [x] Живой терминал по чек-листу §14.4.
- [x] `lint`, `tsc`, `test`, `build` зелёные.

---

## 16. Риски

| Риск                                       | Влияние                      | Митигация                                                                   |
| ------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------- |
| 746 МБ модель качается долго/обрывается    | Плохой UX                    | Прогресс, отмена, таймаут 60 мин, рекомендация 0.4.                         |
| Распаковка большого zip                    | Пик памяти/диска             | Потоковые `bsdtar`/`unzip`, не `adm-zip`; pre-flight места.                 |
| Загрузка ONNX на каждый чанк               | Задержка                     | Persistent worker (реализован): загрузка один раз, рекомендованная 0.4.     |
| Python/venv ломается после обновления Arch | Движок «пропал»              | Подсказка `pipx reinstall vosk-tts`; автопоиск venv.                        |
| `model-list.json` изменит схему            | Каталог пуст/ошибка          | Толерантный парсер, stale cache, локальные модели.                          |
| Нет `n_speakers` в ONNX-конфиге            | Неверный список спикеров     | Fallback по имени, клампинг, проверка при синтезе.                          |
| Многострочный `check()` в статус-баре      | Разрыв строки                | Первая строка самодостаточна; детали — в модалке.                           |
| Лицензия моделей не указана в model-list   | Юридическая неопределённость | Зафиксировать в docs (HF-карточка — Apache-2.0); проверить перед упаковкой. |
| Отмена/ошибка оставляет мусор              | Занятый диск                 | `.part`/`.tmp`/`.old` + очистка во всех путях.                              |
| `vosk-tts` CLI изменится                   | Синтез падает                | Не парсим `--help`; тесты на аргументы; понятная ошибка.                    |

---

## 17. Критерии готовности

- [x] `:tts config` показывает `vosk` в списке движков; при отсутствии
      бинарника — подсказка `pipx install vosk-tts`.
- [x] При отсутствии модели — подсказка скачать её в UI.
- [x] Каталог Vosk открывается, показывает модели с размерами и отметкой
      установки.
- [x] Скачивание идёт с прогрессом, отменяется по `Esc`, после успеха
      модель лежит в `~/.local/share/vosk/<id>/` и сразу доступна.
- [x] `md5` проверяется; при несовпадении установка не происходит.
- [x] Для `0.9-multi` доступен выбор спикера; конфиг сохраняет
      `model#speaker`.
- [x] `v` озвучивает русскую книгу через Vosk; `V` останавливает; после
      выхода нет процессов `vosk-tts`.
- [x] `Rate` влияет на темп; `Pitch` помечен как неподдерживаемый.
- [x] Каталог при недоступной сети использует кеш; без кеша — локальные
      модели и понятное предупреждение.
- [x] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` —
      зелёные; покрытие не ниже порогов.
- [x] Проверка в живом терминале выполнена.
- [x] Документация обновлена; замеры RTF записаны.

---

## 18. Вне объёма

- ASR/Vosk API для распознавания речи.
- Persistent worker и стриминговый синтез.
- Докачка загрузок и зеркала alphacephei.
- Удаление/обновление моделей из UI.
- Автовыбор языка/голоса по языку книги.
- Другие языки Vosk TTS.
- AUR-пакет `vosk-tts`.
- Изменения в Rust-ядре.
- Windows/macOS.

---

## 19. Принятые решения (подписано 2026-10-28)

1. **Полный рефакторинг модалки** — принято. Piper тоже переводится на
   `voiceCatalog`/`installVoice`/`defaultVoice`; piper-веток в модалке не
   остаётся.
2. **Отмена скачивания по `Esc`** — принято, входит в v1: `AbortController`,
   очистка partial/tmp, список остаётся открытым.
3. **Модель по умолчанию** — `vosk-model-tts-ru-0.4-irina` (~116 МБ,
   121 450 024 байт). `0.9-multi` предлагается как качественная
   многоголосая, но не дефолт.
4. **AUR-пакет для `vosk-tts`** — вне объёма, установка через `pipx`.
5. **Нейтральные подписи спикеров** — `speaker 0..N-1` — принято осознанно.
   У `0.9-multi` `speaker_id_map` содержит имена с полом
   (`female_0…male_1`), но UI на них не опирается: карта может
   отсутствовать, а нейтральные подписи не требуют ручной таблицы.
