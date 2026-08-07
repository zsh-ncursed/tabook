// ponytail: Ink drops the closing frame of a modal through its logUpdate
// "output === previousOutput" guard (the re-opened text is byte-identical to
// the pre-modal text, so Ink thinks nothing changed and never clears the
// modal). The robust escape hatch is `instance.clear()` (resets logUpdate's
// previousOutput) followed by a re-render. main.ts registers that here so
// components can poke it without plumbing the instance around.
let forceRedrawImpl: (() => void) | null = null;

export function registerForceRedraw(fn: () => void): void {
  forceRedrawImpl = fn;
}

export function forceRedraw(): void {
  forceRedrawImpl?.();
}