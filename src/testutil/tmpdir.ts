/**
 * Временная директория для тестов — в дереве проекта (build/.tmp), а не в /tmp.
 *
 * /tmp во многих дистрибутивах — это tmpfs, то есть RAM. Тесты, которые пишут
 * туда книги, базы и кеши голосов, отъедают оперативку и могут попадать под
 * ограничения sandbox. Дерево проекта гарантированно на диске.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir as osTmpdir } from 'node:os';

const TEST_TMP_ROOT = join(process.cwd(), 'build', '.tmp');

/**
 * Создать уникальную временную директорию для теста.
 * Возвращает абсолютный путь.
 */
export function testTmpdir(prefix = 'test'): string {
  mkdirSync(TEST_TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TEST_TMP_ROOT, `${prefix}-`));
}

/** Корень для тестовых временных файлов (не создаётся автоматически). */
export function testTmpRoot(): string {
  return TEST_TMP_ROOT;
}

/** Путь по умолчанию для тестов, которым нужна просто «какая-то» tmp директория. */
export function defaultTmpdir(): string {
  return process.env.TABOOK_TEST_TMPDIR ?? osTmpdir();
}
