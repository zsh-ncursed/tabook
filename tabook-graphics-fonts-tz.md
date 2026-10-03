# Техническое задание: пропорциональные шрифты в tabook

**Версия:** 1.2  
**Статус:** согласовано  
**Дата:** 2026-10-03

---

## Содержание

1. [Цель и объём](#1-цель-и-объём)
2. [Зафиксированные решения](#2-зафиксированные-решения)
3. [Термины](#3-термины)
4. [Архитектура](#4-архитектура)
5. [Структура модулей](#5-структура-модулей)
6. [Модели данных](#6-модели-данных)
7. [Variable fonts](#7-variable-fonts)
8. [Пакеты и опциональные зависимости](#8-пакеты-и-опциональные-зависимости)
9. [Пайплайн рендера](#9-пайплайн-рендера)
10. [Кэши](#10-кэши)
11. [Kitty graphics](#11-kitty-graphics)
12. [Мышь и выделение](#12-мышь-и-выделение)
13. [Подсветка](#13-подсветка)
14. [Шрифты](#14-шрифты)
15. [Настройки](#15-настройки)
16. [Профили типографики](#16-профили-типографики)
17. [Обработка ошибок](#17-обработка-ошибок)
18. [Производительность](#18-производительность)
19. [Тестирование](#19-тестирование)
20. [Этапы](#20-этапы)
21. [Риски](#21-риски)
22. [Критерии готовности](#22-критерии-готовности)
23. [Открытые вопросы](#23-открытые-вопросы)

---

## 1. Цель и объём

### 1.1. Цель

Добавить в tabook опциональный графический режим чтения с пропорциональными шрифтами (TTF/OTF), не ломая существующий моноширинный TUI-режим и не нарушая работу TTS, поиска, выделения и навигации.

### 1.2. В объёме

- Второй бэкенд рендера — `graphics` (Kitty protocol).
- Загрузка и использование произвольных TTF/OTF.
- Поддержка variable fonts как фиксированных инстансов.
- Shaping, layout, кэширование глифов, строк, PNG.
- Единый `source offset ↔ cluster ↔ rect` mapping.
- Выделение мышью, копирование (OSC 52 / arboard).
- Единый слой подсветки (TTS, поиск, выделение, закладки).
- Настройки через TOML и команды.
- Экспорт/импорт профилей типографики.

### 1.3. Вне объёма

- Sixel.
- Вертикальная письменность.
- Слайдеры осей variable fonts.
- LLM-нормализация перед TTS (отдельное ТЗ).
- Клонирование голоса.
- Синхронизация между устройствами.

---

## 2. Зафиксированные решения

| Вопрос              | Решение                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Sixel               | Не поддерживаем. Только Kitty protocol + ueberzugpp (для изображений).                                                            |
| Шрифты              | Опциональная зависимость. При вызове `:font` / `:set render graphics` без пакета — уведомление с предложением скачать/установить. |
| Variable fonts      | Вариант B: фиксированные инстансы Regular (400), Bold (700), Italic (400 italic). Без слайдеров осей.                             |
| Дисковый кэш PNG    | Да. `~/.cache/tabook/render/`, LRU, лимит 500 МБ, TTL 30 дней.                                                                    |
| Вертикальный текст  | Не поддерживаем. Только горизонтальный.                                                                                           |
| Профили типографики | Экспорт/импорт делаем сразу, в основном объёме.                                                                                   |
| Встроенные шрифты   | В репозитории не хранятся. Опциональная установка.                                                                                |
| Shared disk cache   | Возможная фича, отдельный этап (nice-to-have).                                                                                    |

---

## 3. Термины

| Термин    | Значение                                                   |
| --------- | ---------------------------------------------------------- |
| Offset    | Позиция в plain text главы (UTF-8 byte offset).            |
| Cluster   | Графемный кластер — единица shaping'а.                     |
| Glyph     | Растеризованное представление глифа шрифта.                |
| Atlas     | Текстура с упакованными глифами.                           |
| Layout    | Результат shaping + переносов + выравнивания.              |
| Viewport  | Видимая область книги.                                     |
| Placement | Изображение, размещённое в терминале через Kitty protocol. |
| Dirty     | Флаг необходимости перерисовки.                            |
| VF        | Variable Font.                                             |

---

## 4. Архитектура

```
┌─────────────────────────────────────────────────┐
│  TS UI (React + Ink)                            │
│  ├─ команды, настройки, ввод                    │
│  ├─ mouse handling (SGR mouse mode)             │
│  ├─ Kitty graphics emitter                      │
│  └─ package-check (шрифты)                      │
└───────────────────┬─────────────────────────────┘
                    │ napi
┌───────────────────▼─────────────────────────────┐
│  tabook-native (Rust)                           │
│  ├─ parser / library / opds / tts  [есть]       │
│  ├─ text model + mapping           [новое]      │
│  ├─ font manager (+ VF instances)  [новое]      │
│  ├─ shaper (rustybuzz)             [новое]      │
│  ├─ layout engine                  [новое]      │
│  ├─ glyph atlas                    [новое]      │
│  ├─ page renderer (RGBA/PNG)       [новое]      │
│  ├─ highlight layer                [новое]      │
│  └─ cache manager (mem + disk)     [новое]      │
└─────────────────────────────────────────────────┘
```

### Принципы

- **Один mapping** — `source offset ↔ cluster ↔ rect` — общий для TTS, поиска, выделения, LLM.
- **Два бэкенда** — `mono` (Ink/ANSI) и `graphics` (RGBA/Kitty), переключаются на лету.
- **Ленивое кэширование** — глифы и layout считаются по мере надобности.
- **Dirty-инвалидация** — перерисовка только изменённых строк.
- **Opt-in** — graphics включается явно или автодетектом; mono всегда доступен.

---

## 5. Структура модулей

### 5.1. Rust (`crates/tabook-native/src/`)

```
src/
├── lib.rs
├── parser/ library/ opds/ tts/       # есть
│
├── text/                             # НОВОЕ
│   ├── mod.rs
│   ├── position.rs
│   ├── document.rs
│   └── mapping.rs
│
├── font/                             # НОВОЕ
│   ├── mod.rs
│   ├── manager.rs                    # загрузка, fontdb
│   ├── fallback.rs                   # цепочка fallback
│   ├── instance.rs                   # VF -> инстансы
│   └── packages.rs                   # детект системных пакетов
│
├── shape/                            # НОВОЕ
│   ├── mod.rs
│   ├── shaper.rs                     # rustybuzz
│   └── cluster.rs
│
├── layout/                           # НОВОЕ
│   ├── mod.rs
│   ├── engine.rs
│   ├── hyphenation.rs
│   └── page.rs
│
├── render/                           # НОВОЕ
│   ├── mod.rs
│   ├── atlas.rs
│   ├── raster.rs
│   ├── page.rs
│   ├── row_cache.rs
│   ├── png.rs
│   └── disk_cache.rs                 # ~/.cache/tabook/render/
│
├── highlight/                        # НОВОЕ
│   ├── mod.rs
│   ├── layer.rs
│   └── styles.rs
│
├── cache/                            # НОВОЕ
│   ├── mod.rs
│   ├── lru.rs
│   ├── keys.rs
│   └── prefetch.rs
│
├── profile/                          # НОВОЕ
│   ├── mod.rs
│   ├── schema.rs
│   └── builtin.rs
│
└── napi_api/
    ├── mod.rs
    ├── text.rs
    ├── font.rs
    ├── layout.rs
    ├── render.rs
    ├── highlight.rs
    ├── profile.rs
    └── packages.rs
```

### 5.2. TypeScript (`src/`)

```
src/
├── ui/
│   ├── components/
│   │   ├── BookView.tsx              # переключает mono/graphics
│   │   ├── MonoView.tsx
│   │   └── GraphicsView.tsx
│   ├── hooks/
│   │   ├── useMouse.ts
│   │   ├── useSelection.ts
│   │   ├── useKittyGraphics.ts
│   │   └── useViewport.ts
│   └── settings/
│       └── FontSettings.tsx
├── services/
│   ├── renderBridge.ts
│   ├── highlightBridge.ts
│   ├── profileBridge.ts
│   └── packageBridge.ts
└── config/
    └── fonts.ts
```

---

## 6. Модели данных

### 6.1. Rust

```rust
// text/position.rs

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TextPosition {
    pub book_id: i64,
    pub chapter: u32,
    pub offset: u32,           // UTF-8 byte offset
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextRange {
    pub start: TextPosition,
    pub end: TextPosition,     // exclusive
}

// font/instance.rs

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum FontWeight { Regular, Bold }

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum FontStyle { Normal, Italic }

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum Hinting { None, Slight, Full }

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum AntiAlias { Grayscale, Subpixel }

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct FontInstance {
    pub family: String,
    pub weight: FontWeight,
    pub style: FontStyle,
    pub size_px: u32,
    pub hinting: Hinting,
    pub antialias: AntiAlias,
}

// font/manager.rs

pub struct FontFile {
    pub path: PathBuf,
    pub is_variable: bool,
    pub axes: Vec<Axis>,
    pub instances: Vec<FontInstance>,
}

pub struct Axis {
    pub tag: [u8; 4],
    pub min: f32,
    pub max: f32,
    pub default: f32,
}

// font/packages.rs

pub struct PackageRequirement {
    pub id: &'static str,
    pub display_name: &'static str,
    pub per_distro: HashMap<Distro, &'static str>,
}

pub enum Distro { Debian, Arch, Fedora, MacOs, Unknown }

// layout/engine.rs

#[derive(Clone, Debug)]
pub struct LayoutLine {
    pub clusters: Vec<LayoutCluster>,
    pub baseline_y: f32,
    pub height: f32,
    pub source_range: TextRange,
}

#[derive(Clone, Debug)]
pub struct LayoutCluster {
    pub glyphs: Vec<GlyphId>,
    pub advance_x: f32,
    pub offset_x: f32,
    pub source_range: TextRange,
    pub bbox: Rect,
}

#[derive(Clone, Debug)]
pub struct LayoutPage {
    pub lines: Vec<LayoutLine>,
    pub width: u32,
    pub height: u32,
    pub source_range: TextRange,
}

// render/atlas.rs

#[derive(Clone, Copy, Debug)]
pub struct AtlasEntry {
    pub glyph_id: GlyphId,
    pub font_id: FontId,
    pub uv: Rect,
    pub size: (u16, u16),
    pub bearing: (i16, i16),
    pub advance: f32,
}

// highlight/layer.rs

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HighlightKind {
    TtsCurrent,
    TtsSentence,
    SearchMatch,
    SearchActive,
    Selection,
    Bookmark,
}

#[derive(Clone, Debug)]
pub struct Highlight {
    pub range: TextRange,
    pub kind: HighlightKind,
    pub style: HighlightStyle,
}

#[derive(Clone, Debug)]
pub struct HighlightStyle {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub underline: bool,
}
```

### 6.2. napi-экспорт

```rust
#[napi]
pub struct RenderEngine { /* ... */ }

#[napi]
impl RenderEngine {
    #[napi(constructor)]
    pub fn new(config: RenderConfig) -> Result<Self>;

    #[napi] pub fn load_page(&mut self, pos: TextPosition) -> Result<PageInfo>;
    #[napi] pub fn render_viewport(&mut self, rect: ViewportRect) -> Result<Buffer>;
    #[napi] pub fn get_rect_at(&self, pos: TextPosition) -> Option<Rect>;
    #[napi] pub fn get_offset_at(&self, x: f32, y: f32) -> Option<TextPosition>;
    #[napi] pub fn get_word_at(&self, pos: TextPosition) -> TextRange;
    #[napi] pub fn get_paragraph_at(&self, pos: TextPosition) -> TextRange;
    #[napi] pub fn set_highlights(&mut self, highlights: Vec<HighlightDto>) -> Result<()>;
    #[napi] pub fn invalidate(&mut self, reason: InvalidationReason) -> Result<()>;
}

#[napi]
pub fn detect_packages() -> Vec<PackageStatusDto>;

#[napi]
pub fn check_font_availability(family: String) -> PackageCheckDto;

#[napi(object)]
pub struct PackageCheckDto {
    pub available: bool,
    pub package_name: Option<String>,
    pub install_hint: Option<String>,
    pub distro: String,
}
```

---

## 7. Variable fonts

### 7.1. Поведение

- VF открывается как обычный шрифт, но с фиксированными инстансами.
- Из VF извлекаются три инстанса:
  - Regular: `wght=400`, `ital=0`
  - Bold: `wght=700`, `ital=0`
  - Italic: `wght=400`, `ital=1` (если ось есть; иначе synthetic oblique)
- Инстанс = отдельный `FontInstance` = отдельный атлас = отдельный layout-кэш.
- Пользователь видит те же опции, что и для статического шрифта: Regular / Bold / Italic.
- Если у VF нет нужной оси — используется дефолт.

### 7.2. Метрики

- Расчёт при загрузке: advance, ascent, descent, line-gap для каждого инстанса.
- Кэшируется в `FontMetrics`.

### 7.3. Что не делаем

- Слайдеры осей в UI.
- Плавную интерполяцию веса.
- Промежуточные инстансы.

---

## 8. Пакеты и опциональные зависимости

### 8.1. Шрифты и утилиты

Не входят в базовую установку. Проверяются при первом использовании graphics-режима или `:font`.

| Пакет             | Назначение            | Debian                   | Arch                 | Fedora                          | macOS    |
| ----------------- | --------------------- | ------------------------ | -------------------- | ------------------------------- | -------- |
| Literata          | Serif                 | `fonts-literata`         | `ttf-literata` (AUR) | вручную                         | Homebrew |
| Noto Serif CJK    | CJK fallback          | `fonts-noto-cjk`         | `noto-fonts-cjk`     | `google-noto-serif-cjk-fonts`   | Homebrew |
| Noto Naskh Arabic | Arabic fallback       | `fonts-noto-core`        | `noto-fonts`         | `google-noto-sans-arabic-fonts` | Homebrew |
| Noto Color Emoji  | Emoji                 | `fonts-noto-color-emoji` | `noto-fonts-emoji`   | `google-noto-emoji-color-fonts` | встроено |
| ueberzugpp        | Fallback для картинок | `ueberzugpp`             | `ueberzugpp` (AUR)   | `ueberzugpp`                    | Homebrew |

### 8.2. Поведение при отсутствии

При `:set render graphics` без шрифтов:

```
Graphics-режим требует шрифт. Установите:
  Debian/Ubuntu: sudo apt install fonts-literata
  Arch:          yay -S ttf-literata
  Fedora:        sudo dnf install ...
Опции:
  [S] скачать шрифт в ~/.local/share/tabook/fonts/
  [P] установить системный пакет (если есть права)
  [M] остаться в mono
  [F] указать путь вручную
```

- Уведомление показывается один раз, флаг сохраняется в `font.packages.acknowledged_missing`.
- `:font <name>` без пакета → аналогично, режим не переключается.

### 8.3. Резолвинг дистрибутива

- Linux: `/etc/os-release` → `ID`, `ID_LIKE`.
- macOS: `cfg!(target_os = "macos")`.
- Fallback: `Unknown` → общая инструкция.

### 8.4. Загрузка шрифтов

- Путь скачанных шрифтов: `~/.local/share/tabook/fonts/`.
- При согласии пользователя — скачивание с официальных источников (Google Fonts, GitHub releases).
- Проверка SHA-256 и подписи, если доступна.
- Если сети нет — предложение системного пакета.
- Если и его нет — инструкция + путь к локальному шрифту.

---

## 9. Пайплайн рендера

```
1. UI: запрос viewport (scroll_y, height)
   ↓ napi
2. RenderEngine::render_viewport(rect)
   ↓
3. Проверка дискового кэша PNG
   ├─ hit → отдать Buffer из ~/.cache/tabook/render/
   └─ miss ↓
4. Проверка кэша отрендеренных строк
   ├─ hit → compositing
   └─ miss ↓
5. Layout: shaping + fallback + переносы + выравнивание
   ↓
6. Raster: атлас + растеризация через swash
   ↓
7. Composition: текст + highlight + изображения
   ↓
8. PNG-энкод
   ↓
9. Запись в дисковый кэш
   ↓ napi (Buffer)
10. UI: отправка через Kitty graphics
```

### 9.1. Dirty-инвалидация

Ключ строки:

```rust
struct RowCacheKey {
    page_id: u64,
    line_index: u32,
    font_instance: FontInstance,
    viewport_width: u32,
    highlights_hash: u64,
}
```

Инвалидация при:

- смене шрифта / кегля / line-height;
- ресайзе окна;
- изменении подсветки на строке;
- смене темы.

---

## 10. Кэши

| Кэш                        | Ключ                                               | Размер     | Инвалидация   |
| -------------------------- | -------------------------------------------------- | ---------- | ------------- |
| Glyph atlas (mem)          | `(font_id, size, hinting)`                         | 4096×4096  | шрифт/кегль   |
| Layout строк (mem)         | `(page_id, line_idx, font, width)`                 | LRU 2000   | resize, шрифт |
| Layout страниц (mem)       | `(page_id, font, width)`                           | LRU 20     | resize, шрифт |
| Отрендеренные строки (mem) | `RowCacheKey`                                      | LRU 2000   | dirty         |
| PNG viewport (mem)         | `(page_id, scroll_y, height)`                      | LRU 10     | любое         |
| PNG viewport (disk)        | `hash(page_id, scroll_y, font, width, highlights)` | 500 МБ LRU | TTL 30 дней   |

### 10.1. Дисковый кэш

- Путь: `~/.cache/tabook/render/<book_id>/<hash>.png`.
- Метаданные: `<hash>.json` с ключом и timestamp.
- Очистка: LRU по access time, лимит 500 МБ (настраивается).
- При смене шрифта/кегля/темы старые хэши не совпадут — естественная инвалидация.
- Advisory lock на запись, чтобы не пересекаться с префетчем.
- Настройки: `cache.disk_enabled`, `cache.disk_path`, `cache.disk_limit_mb`, `cache.disk_ttl_days`.

### 10.2. Префетч

- 2 страницы вперёд/назад в фоне (tokio task).
- 1–2 абзаца для TTS.
- Приоритет — направление скролла.

---

## 11. Kitty graphics

- Единое placement для viewport (скролл), построчные placements (dirty-подсветка).
- Escape-последовательности: `a=T` (transmit+display), `a=p`, `a=d`, `i=<id>`, `p=<id>`, `f=100` (PNG).
- Синхронизация с Ink: viewport на `(0, header_height)`, Ink не затирает область.
- Статусбар, меню — обычный Ink.
- Sixel не используется.
- Fallback для терминалов без Kitty protocol: ueberzugpp (для картинок), mono (для текста).

---

## 12. Мышь и выделение

### 12.1. Mouse mode

SGR: `\x1b[?1000h\x1b[?1002h\x1b[?1006h`. Вкл при входе в graphics, выкл при выходе.

### 12.2. Жесты

| Жест         | Действие                 |
| ------------ | ------------------------ |
| Click        | Каретка, снять выделение |
| Double click | Слово                    |
| Triple click | Абзац                    |
| Drag         | Диапазон                 |
| Shift+drag   | Расширить                |
| Ctrl+Shift+C | Копировать (OSC 52)      |

### 12.3. Копирование

- OSC 52: `\x1b]52;c;<base64>\x07`.
- Лимит 8 КБ безопасно; для больших — предупреждение.
- Fallback: `arboard` для локальных сессий.

---

## 13. Подсветка

### 13.1. Единый слой

```rust
pub struct HighlightLayer {
    highlights: Vec<Highlight>,
}

impl HighlightLayer {
    pub fn set(&mut self, kind: HighlightKind, range: TextRange);
    pub fn clear(&mut self, kind: HighlightKind);
    pub fn clear_all(&mut self);
    pub fn intersects_row(&self, row: &LayoutLine) -> bool;
    pub fn hash_for_row(&self, row: &LayoutLine) -> u64;
}
```

### 13.2. Приоритет отрисовки

1. Selection (низ)
2. Search match
3. Search active
4. Bookmark
5. TTS sentence
6. TTS current word (верх)

### 13.3. Стили

- mono: ANSI reverse/underline/background.
- graphics: bg-заливка + underline + смена fg.

---

## 14. Шрифты

### 14.1. Встроенные (рекомендуемые, OFL)

- Literata — основной serif.
- Source Serif 4 — альтернатива.
- Noto Serif — многоскриптовый fallback.
- Inter — UI.

Не хранятся в репозитории, устанавливаются опционально.

### 14.2. Пользовательские

- Путь: `~/.config/tabook/fonts/`.
- Команда: `:font /path/to/font.ttf`.
- Индексация в SQLite.
- Скачанные: `~/.local/share/tabook/fonts/`.

### 14.3. Fallback chain

Основной → script-specific (CJK, Arabic) → Emoji → system default.

Реализация: `fontdb` + `rustybuzz` fallback API.

### 14.4. Variable fonts

Три фиксированных инстанса: Regular, Bold, Italic. Без слайдеров осей.

---

## 15. Настройки

### 15.1. Команды

```
:set render mono|graphics|auto
:font <family|path>
:font-size <px>
:line-height <float>
:hyphenation on|off
:justify on|off
:font-fallback <family> <family> ...
:profile export [path]
:profile import <path>
:profile list
:profile load <name>
:profile save <name>
```

### 15.2. Конфиг

```toml
[render]
mode = "auto"                # mono | graphics | auto

[font]
family = "Literata"
path = ""
size = 18
line_height = 1.5
hinting = "slight"
antialias = "grayscale"

[font.fallback]
cjk = "Noto Serif CJK"
arabic = "Noto Naskh Arabic"
emoji = "Noto Color Emoji"

[font.packages]
acknowledged_missing = false

[layout]
hyphenation = false
justify = true
max_width = 720

[cache]
disk_enabled = true
disk_path = "~/.cache/tabook/render"
disk_limit_mb = 500
disk_ttl_days = 30

[highlight]
tts_current_bg = "#3a5a8c"
tts_sentence_bg = "#2a3a4c"
search_bg = "#5a4a2a"
selection_bg = "#3a3a3a"
```

---

## 16. Профили типографики

### 16.1. Формат

Файл `tabook-profile.toml`, `schema_version = 1`.

**Содержимое:**

- `[font]` — family, path, size, line_height, hinting, antialias.
- `[font.fallback]` — cjk, arabic, emoji.
- `[layout]` — hyphenation, justify, max_width.
- `[highlight]` — цвета всех типов подсветки.
- `[render]` — mode.
- Метаданные: `name`, `description`, `author` (опционально).

**Не входит:** прогресс чтения, закладки, пути к библиотеке, настройки TTS-голоса, любые пользовательские данные.

### 16.2. Команды

```
:profile export [path]      # сохранить текущие настройки
:profile import <path>      # загрузить, применить, валидировать schema_version
:profile list               # встроенные + пользовательские
:profile load <name>        # применить пресет
:profile save <name>        # сохранить текущие как именованный профиль
```

### 16.3. Встроенные пресеты

- `novel` — Literata, serif, 18px, line-height 1.6, justify, hyphenation.
- `poetry` — без justify, узкая колонка, центрирование.
- `technical` — sans + mono для кода, выравнивание по левому краю.
- `cjk` — Noto Serif CJK, увеличенный line-height, без гифенации.
- `dyslexia` — OpenDyslexic (опциональная зависимость), увеличенный letter-spacing и line-height.

### 16.4. Валидация при импорте

- Проверка `schema_version`; при несовпадении — предупреждение и попытка миграции или отказ.
- Проверка доступности шрифта; если нет — предложение установить (см. раздел 8).
- Неизвестные поля — игнорируются с логом, не ломают импорт.

### 16.5. Хранение

- Пользовательские профили: `~/.config/tabook/profiles/<name>.toml`.
- `:profile list` показывает встроенные и пользовательские.

### 16.6. Пример файла

```toml
schema_version = 1
name = "Novel reading"
description = "Serif, wide line-height, justified"
author = "user"

[font]
family = "Literata"
size = 18
line_height = 1.6
hinting = "slight"
antialias = "grayscale"

[font.fallback]
cjk = "Noto Serif CJK"
arabic = "Noto Naskh Arabic"
emoji = "Noto Color Emoji"

[layout]
hyphenation = true
justify = true
max_width = 720

[render]
mode = "graphics"

[highlight]
tts_current_bg = "#3a5a8c"
tts_sentence_bg = "#2a3a4c"
search_bg = "#5a4a2a"
selection_bg = "#3a3a3a"
```

---

## 17. Обработка ошибок

| Ситуация                           | Поведение                                    |
| ---------------------------------- | -------------------------------------------- |
| Kitty недоступен                   | Fallback mono, уведомление                   |
| Шрифт не найден                    | Fallback chain, лог                          |
| Пакет не установлен                | Уведомление с командой установки, откат mono |
| Глиф отсутствует                   | Fallback font, tofu в крайнем случае         |
| OOM атласа                         | Сброс атласа, перерастеризация               |
| Resize во время рендера            | Debounce 100 мс, отмена                      |
| TTS boundary вне диапазона         | Игнор, лог                                   |
| Дисковый кэш повреждён             | Удаление файла, рендер заново                |
| Диск переполнен                    | LRU-очистка, при неудаче — только mem        |
| VF не имеет оси italic             | Synthetic oblique                            |
| Пользователь без прав на установку | Ручная инструкция + путь к локальному шрифту |
| Дисковый кэш на медленном диске    | Async write, отключаемо через конфиг         |

---

## 18. Производительность

| Операция                      | Цель     |
| ----------------------------- | -------- |
| Первый рендер страницы        | < 150 мс |
| Скролл на строку (mem)        | < 16 мс  |
| Скролл на строку (disk hit)   | < 8 мс   |
| Изменение подсветки (1 слово) | < 16 мс  |
| Resize                        | < 300 мс |
| Листание страницы             | < 100 мс |

Профилирование: `tracing`, `metrics`, флаг `--profile`.

---

## 19. Тестирование

### 19.1. Unit (Rust)

- Shaping: лигатуры, арабица, деванагари, emoji.
- Mapping: offset ↔ cluster ↔ rect на разных скриптах.
- Atlas: упаковка, попадания, инвалидация.
- Layout: переносы, выравнивание, гифенация.
- Highlight: пересечение со строками, приоритеты.
- VF-инстансы: корректное извлечение Regular / Bold / Italic.
- Профили: экспорт/импорт, валидация schema_version.

### 19.2. Интеграционные

- Открыть FB2, отрендерить 100 страниц подряд, проверить отсутствие утечек.
- Ресайз 50 раз, проверить корректность.
- TTS + подсветка + скролл одновременно.
- Дисковый кэш: hit/miss, LRU, TTL, повреждённые файлы.

### 19.3. Терминалы

- kitty, WezTerm, Ghostty, Konsole — основная поддержка.
- xterm, foot — mono + ueberzugpp для картинок.

### 19.4. Пакеты

- Проверка detect на Debian, Arch, Fedora, macOS.
- Проверка сценариев: нет пакета, есть права, нет прав, нет сети.

### 19.5. Специальные случаи

- Текст с моноширинным шрифтом (baseline).
- Лигатуры (`fi`, `ffi`).
- Combining marks (é, й).
- RTL и арабица.
- ZWJ-emoji.
- Смешанные скрипты в одном абзаце.
- Очень длинные абзацы (10 000+ символов).

---

## 20. Этапы

### Этап 1. Инфраструктура (1–2 недели)

- `text/position.rs`, `text/document.rs`, `text/mapping.rs`.
- napi: `get_rect_at`, `get_offset_at`, `get_word_at`, `get_paragraph_at`.
- Перевод TTS-подсветки на новый API.
- Тесты mapping'а.

### Этап 2. Базовый graphics (2–3 недели)

- `font/manager.rs`, `shape/shaper.rs`.
- `layout/engine.rs` — одна страница.
- `render/atlas.rs`, `render/raster.rs`, `render/page.rs`.
- Kitty emitter в TS.
- Команда `:set render graphics`.
- Один встроенный шрифт.

### Этап 3. Кэши и производительность (1–2 недели)

- LRU-кэши в памяти.
- Дисковый кэш PNG.
- Префетч.
- Dirty-инвалидация.
- Row-level placements.

### Этап 4. Выделение и мышь (1–2 недели)

- SGR mouse mode.
- Selection в UI.
- OSC 52 + arboard.
- Синхронизация с TTS.

### Этап 5. Настройки, VF, пакеты, профили (1–2 недели)

- TOML-конфиг.
- Команды.
- Fallback-шрифты.
- VF → три инстанса.
- Детект пакетов, уведомления, скачивание.
- Профили типографики: экспорт/импорт, встроенные пресеты.
- Документация.

### Этап 6. Стабилизация (1 неделя)

- Профилирование.
- Тесты.
- Кросс-терминальные проверки.

### Этап 7. Nice-to-have (по желанию)

- Shared disk cache по `text_hash` между книгами одного автора.
- Дополнительные встроенные пресеты.
- Экспорт профиля в Gist (опционально).

---

## 21. Риски

| Риск                               | Митигация                                    |
| ---------------------------------- | -------------------------------------------- |
| Kitty отваливается при resize      | Debounce + перерисовка                       |
| Медленный shaping больших глав     | Асинхронный префетч, кэш                     |
| Дыры в fallback                    | Широкая цепочка, тесты CJK/Arabic            |
| OOM атласа                         | Динамический размер, сброс                   |
| Потеря доступности                 | mono как явный fallback                      |
| Лицензии шрифтов                   | Только OFL/CC0, не хранить в репо            |
| Конфликт Ink и Kitty               | Чёткое разделение областей                   |
| Утечки napi Buffer                 | Явное освобождение, тесты                    |
| VF без оси italic                  | Synthetic oblique                            |
| Пользователь без прав на установку | Ручная инструкция + локальный шрифт          |
| Дисковый кэш на медленном диске    | Async write, отключаемо                      |
| Приватность дискового кэша         | Только пользовательские пути, очистка по TTL |
| Скачивание шрифтов без сети        | Fallback на системный пакет или ручной путь  |

---

## 22. Критерии готовности

- `:set render graphics` включает пропорциональный рендер.
- Любой TTF/OTF из конфига работает.
- VF даёт Regular / Bold / Italic без слайдеров.
- Скролл, resize, листание без артефактов.
- TTS-подсветка работает в обоих режимах.
- Выделение мышью + копирование через OSC 52.
- Поиск подсвечивается в graphics.
- Дисковый кэш PNG работает, лимит 500 МБ, TTL 30 дней.
- При отсутствии пакета — понятное уведомление с опциями.
- Профили типографики экспортируются и импортируются.
- Встроенные пресеты (`novel`, `poetry`, `technical`, `cjk`, `dyslexia`) работают.
- Метрики производительности достигнуты.
- mono — дефолт, не сломан.
- Тесты на kitty, WezTerm, Ghostty, Konsole.

---

## 23. Открытые вопросы

1. **Где хранить скачанные шрифты:** `~/.local/share/tabook/fonts/` (рекомендуется, FHS-корректно) или `~/.config/tabook/fonts/` (рядом с конфигом)?
2. **Нужен ли мигратор `schema_version`?** Рекомендуется заложить поле, но мигратор не писать до первого изменения формата.
3. **Нужна ли интеграция `:profile share` с внешними сервисами (Gist, pastebin)?** Рекомендуется только локальный файл на первой итерации.
4. **Нужно ли отдавать приоритет системным шрифтам перед скачанными?** Влияет на предсказуемость рендера.
5. **Кэшировать ли неудачные попытки рендера** (например, битые глифы) в дисковом кэше?

---

**Конец документа.**
