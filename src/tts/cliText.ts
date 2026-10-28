/**
 * Подготовка текста для CLI-движков: вырезаем управляющие символы (NUL роняет
 * C++/Python-парсеры), схлопываем переводы строк (текст уходит одним
 * аргументом) и не даём строке начаться с «-», иначе argparse/posix-парсер
 * примет её за флаг.
 */
export function sanitizeForCli(text: string): string {
  const clean = text
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.startsWith('-') ? `…${clean}` : clean;
}
