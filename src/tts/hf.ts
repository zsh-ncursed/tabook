/**
 * Общие константы для доступа к репозиторию Piper-голосов на HuggingFace.
 *
 * Используем hf-mirror.com — зеркало, которое не бьёт по rate limit так, как
 * основной huggingface.co. Нужны только read-only операции (tree, resolve),
 * токен не требуется.
 */

export const HF_MIRROR = 'https://hf-mirror.com';
export const HF_MODEL = 'rhasspy/piper-voices';

/** Прямая ссылка на файл репозитория: `${HF_RESOLVE}/<path>`. */
export const HF_RESOLVE = `${HF_MIRROR}/${HF_MODEL}/resolve/main`;
