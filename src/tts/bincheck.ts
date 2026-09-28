import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Проверить, доступна ли команда в PATH (без запуска — только поиск файла). */
export function commandAvailable(cmd: string): boolean {
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      if (existsSync(join(dir, cmd + ext))) return true;
    }
  }
  return false;
}
