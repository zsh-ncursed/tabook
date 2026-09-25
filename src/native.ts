// Native module loader with graceful fallback to pure-JS implementations.
//
// The binding is loaded synchronously when possible (CJS require — vitest,
// the release bundle). In ESM-only environments that fails, so we fall back
// to a dynamic import. That path is asynchronous: `native` stays null until
// it resolves, and a caller running before then used to hit a silent race.
// The in-flight promise is tracked and exposed via whenNativeReady(), and a
// failed load is recorded (getNativeLoadError) + logged instead of being
// swallowed, so a silent regression to the TS fallbacks is diagnosable.

import type * as NativeTypes from '@tabook/native';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let native: typeof NativeTypes | null = null;
let loadError: string | null = null;
let readyPromise: Promise<boolean> | null = null;

// The package id goes through a function so esbuild can't statically fold it
// into the require call: in the single-file ESM release bundle a literal
// require('@tabook/native') is converted to import('@tabook/native'), which
// resolves the CJS index.cjs as an ESM namespace ({ default: ... }), losing
// the named exports (parseOpdsAtom, BookLayout, …). A runtime require instead
// hits the banner's createRequire and loads index.cjs directly.
function nativePackageId(): string {
  return '@tabook/native';
}

// Detect a stubbed resolution. tsconfig.json maps "@tabook/native" to
// src/native-types.d.ts via `paths` for the *type checker*. tsx applies the
// same mapping to runtime require() (vite/vitest does not), so under
// `npm run dev` require() used to return the empty .d.ts module instead of
// the binding — `native` was a truthy {} and every `if (native)` branch
// called a missing function ("native.openLibraryDb is not a function").
// A real napi binding always exports at least hello(); anything else is not
// the binding and must be treated as unavailable.
function looksLikeNativeBinding(mod: unknown): mod is typeof NativeTypes {
  return (
    typeof mod === 'object' &&
    mod !== null &&
    typeof (mod as { hello?: unknown }).hello === 'function'
  );
}

// Try CJS require first (works in vitest, works in the release bundle through
// the banner's createRequire), then dynamic import (works in ESM-only envs).
try {
  const required = require(nativePackageId()) as unknown;
  if (looksLikeNativeBinding(required)) {
    native = required;
  } else {
    // Dev-environment stub (tsconfig paths → .d.ts): load error, but keep the
    // dynamic-import fallback below a chance to resolve the real binding.
    loadError = `require('@tabook/native') resolved to a non-binding stub (tsconfig paths mapping?)`;
    readyPromise = import(nativePackageId())
      .then((mod) => {
        // ESM-importing a CJS module yields { default: exports }; unwrap it.
        const modNative = (mod as { default?: unknown }).default ?? mod;
        if (looksLikeNativeBinding(modNative)) {
          native = modNative;
          loadError = null;
          return true;
        }
        console.error(`[tabook] ${loadError} — falling back to pure-TS implementations.`);
        native = null;
        return false;
      })
      .catch(() => {
        console.error(`[tabook] ${loadError} — falling back to pure-TS implementations.`);
        native = null;
        return false;
      });
  }
} catch (syncErr) {
  // CJS failed (ESM-only env); try dynamic import. Track the promise so
  // callers can await readiness instead of racing it.
  const syncReason = syncErr instanceof Error ? syncErr.message : String(syncErr);
  readyPromise = import(nativePackageId())
    .then((mod) => {
      // ESM-importing a CJS module yields { default: exports }; unwrap it.
      const modNative = (mod as { default?: unknown }).default ?? mod;
      if (!looksLikeNativeBinding(modNative)) {
        loadError = `native module unavailable — require: ${syncReason}; import resolved to a non-binding stub`;
        console.error(`[tabook] ${loadError} — falling back to pure-TS implementations.`);
        native = null;
        return false;
      }
      native = modNative;
      return native !== null;
    })
    .catch((asyncErr) => {
      const asyncReason = asyncErr instanceof Error ? asyncErr.message : String(asyncErr);
      loadError = `native module unavailable — require: ${syncReason}; import: ${asyncReason}`;
      // One-time diagnostic: a missing binding previously degraded to the TS
      // fallbacks with no trace, hiding drift between the two implementations.
      console.error(`[tabook] ${loadError} — falling back to pure-TS implementations.`);
      native = null;
      return false;
    });
}

export function isNativeAvailable(): boolean {
  return native !== null;
}

export function getNative(): typeof NativeTypes {
  if (!native) {
    throw new Error(
      loadError
        ? `tabook-native: ${loadError}`
        : 'tabook-native is not installed or not yet loaded.',
    );
  }
  return native;
}

/** Resolves when the binding either loaded or definitively failed. Resolves
 *  true when native is available. Safe to call in the synchronous-require
 *  case (resolves immediately). */
export function whenNativeReady(): Promise<boolean> {
  return readyPromise ?? Promise.resolve(native !== null);
}

/** Reason the binding is unavailable (null when it loaded fine). */
export function getNativeLoadError(): string | null {
  return loadError;
}

// napi-rs returns Err from `#[napi] fn -> Result<T>` as a JS value (an Error
// object like { code: 'GenericFailure' }) instead of throwing it. TS wrappers
// must detect these and re-throw to keep the TS contract (see detectFormat,
// parseOpdsAtom).
export function isNativeErrorResult(value: unknown): value is { code: string; message?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { id?: unknown }).id !== 'string'
  );
}

export { native };
