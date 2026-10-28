/**
 * Общая обработка stderr дочерних процессов TTS (piper, sherpa, vosk).
 *
 * Движки сыплют в stderr ANSI-раскраской, Python-traceback'ами, телеметрией
 * onnxruntime и usage-блоками. В raw-mode TUI многострочный вывод рвёт экран,
 * поэтому оставляем одну значимую строку — обычно это причина ошибки.
 */
export function summarizeEngineStderr(raw: string): string {
  const lines = raw
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    // sherpa печатает путь к исходнику вместо сообщения
    // ('file.cc:Func:38 ...') — путь неполезен, причина нужна.
    .map((l) => l.replace(/^\S+\.(?:cc|h|cpp|cxx):[A-Za-z_]*:?\d*\s*/, ''))
    .filter((l) => l.length > 0)
    // Служебный шум: timestamps, телеметрия onnxruntime, обвязка traceback.
    .filter(
      (l) =>
        !/\d{4}-\d{2}-\d{2}|onnxruntime|telemetry|^Traceback|^ {2}File |^\s*~+|^sys\.exit|\{$|\}$/i.test(
          l,
        ),
    )
    // usage-блок sherpa в TUI не нужен.
    .filter((l) => !/^Usage:|^\s+--|^Please read/i.test(l));
  // Конкретная причина важнее общего «Errors in config!» в конце вывода.
  const specific = lines.filter((l) => /does not exist|no such|not found|cannot|unable/i.test(l));
  const generic = lines.filter((l) => /error|fail|invalid/i.test(l));
  const line =
    specific[specific.length - 1] ?? generic[generic.length - 1] ?? lines[lines.length - 1] ?? '';
  return line.slice(0, 200);
}
