/**
 * Подготовка текста для Vosk TTS.
 *
 * G2P в vosk-tts понимает только русские фонемы: латиница, цифры и типографские
 * кавычки попадают в `phoneme_id_map` как есть и роняют синтез `KeyError`.
 * Поэтому перед отправкой в движок текст нормализуется: латиница
 * транслитерируется в кириллицу, числа записываются словами, неподдерживаемые
 * символы заменяются пробелом/безопасной пунктуацией.
 */

const DIGITS = [
  'ноль',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
];
/** Женский род для тысяч: «одна тысяча», «две тысячи». */
const FEM_DIGITS = ['ноль', 'одна', 'две', ...DIGITS.slice(3)];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

/** Латинские диграфы → кириллица; порядок важен (длинные раньше коротких). */
const LATIN: Array<[string, string]> = [
  ['shch', 'щ'],
  ['tsch', 'ч'],
  ['sch', 'щ'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['yo', 'ё'],
  ['jo', 'ё'],
  ['yu', 'ю'],
  ['ju', 'ю'],
  ['ya', 'я'],
  ['ja', 'я'],
  ['ye', 'е'],
  ['je', 'е'],
  ['oo', 'у'],
  ['ee', 'и'],
  ['ph', 'ф'],
  ['th', 'с'],
  ['ck', 'к'],
  ['qu', 'кв'],
  ['a', 'а'],
  ['b', 'б'],
  ['c', 'к'],
  ['d', 'д'],
  ['e', 'е'],
  ['f', 'ф'],
  ['g', 'г'],
  ['h', 'х'],
  ['i', 'и'],
  ['j', 'дж'],
  ['k', 'к'],
  ['l', 'л'],
  ['m', 'м'],
  ['n', 'н'],
  ['o', 'о'],
  ['p', 'п'],
  ['q', 'к'],
  ['r', 'р'],
  ['s', 'с'],
  ['t', 'т'],
  ['u', 'у'],
  ['v', 'в'],
  ['w', 'в'],
  ['x', 'кс'],
  ['y', 'и'],
  ['z', 'з'],
];

/**
 * Привести текст к виду, который переживает G2P Vosk. Возвращает строку в
 * нижнем регистре (регистр для синтеза не важен) или '' если озвучивать нечего.
 */
export function prepareVoskText(text: string): string {
  let s = text.toLowerCase();
  s = s.replace(/[«»„“”"]/g, ' ');
  s = s.replace(/…/g, '...');
  s = s.replace(/[—–]/g, '-');
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, raw: string) => {
    const n = Number(raw.replace(',', '.'));
    return `${numberPhrase(raw)} ${percentWord(n)}`;
  });
  s = s.replace(/\d+(?:[.,]\d+)?/g, (m) => numberPhrase(m));
  s = transliterateLatin(s);
  // Оставляем только символы, которые есть в phoneme_id_map всех русских
  // моделей; остальное (№, $, &, /, скобки, апострофы) заменяем пробелом.
  s = s.replace(/[^а-яё\s.,!?;:-]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return /[а-яё]/.test(s) ? s : '';
}

/** true, если в тексте есть латиница (для диагностики/тестов). */
export function hasLatin(text: string): boolean {
  return /[a-z]/i.test(text);
}

/** Транслитерация латиницы в кириллицу (остальной текст не трогает). */
export function transliterateLatin(text: string): string {
  let out = '';
  for (let i = 0; i < text.length;) {
    let matched = false;
    for (const [latin, cyr] of LATIN) {
      if (text.startsWith(latin, i)) {
        out += cyr;
        i += latin.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** Число словами (0…999 999 999); вне диапазона — по цифрам. */
export function numberToRussian(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'ноль';
  if (n > 999_999_999)
    return String(Math.trunc(n))
      .split('')
      .map((d) => DIGITS[Number(d)])
      .join(' ');
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions > 0)
    parts.push(under1000(millions), plural(millions, 'миллион', 'миллиона', 'миллионов'));
  if (thousands > 0)
    parts.push(under1000(thousands, true), plural(thousands, 'тысяча', 'тысячи', 'тысяч'));
  if (rest > 0 || parts.length === 0) parts.push(under1000(rest));
  return parts.join(' ');
}

function under1000(n: number, feminine = false): string {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const d = n % 10;
  if (h > 0) out.push(HUNDREDS[h]!);
  if (t === 1) out.push(TEENS[d]!);
  else {
    if (t > 1) out.push(TENS[t]!);
    if (d > 0) out.push((feminine ? FEM_DIGITS : DIGITS)[d]!);
  }
  return out.join(' ');
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function percentWord(n: number): string {
  return plural(n, 'процент', 'процента', 'процентов');
}

/** «12,5» → «двенадцать запятая пять». */
function numberPhrase(raw: string): string {
  const parts = raw.split(/[.,]/);
  if (parts.length === 1) return numberToRussian(Number(parts[0]));
  const [whole, frac] = parts;
  const fracWords = (frac ?? '')
    .split('')
    .map((d) => DIGITS[Number(d)] ?? '')
    .join(' ');
  return `${numberToRussian(Number(whole))} запятая ${fracWords}`.trim();
}
