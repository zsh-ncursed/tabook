// Native module loader with graceful fallback to pure-JS implementations.

import type * as NativeTypes from '@tabook/native';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let native: typeof NativeTypes | null = null;

// The package id goes through a function so esbuild can't statically fold it
// into the require call: in the single-file ESM release bundle a literal
// require('@tabook/native') is converted to import('@tabook/native'), which
// resolves the CJS index.cjs as an ESM namespace ({ default: ... }), losing
// the named exports (parseOpdsAtom, BookLayout, …). A runtime require instead
// hits the banner's createRequire and loads index.cjs directly.
function nativePackageId(): string {
  return '@tabook/native';
}

// Try CJS require first (works in vitest), then dynamic import (works in ESM)
try {
  native = require(nativePackageId()) as typeof NativeTypes;
} catch {
  // CJS failed (ESM-only env); try dynamic import
  // This is async, so native stays null until it resolves
  import(nativePackageId())
    .then((mod) => {
      // ESM-importing a CJS module yields { default: exports }; unwrap it.
      const modNative = (mod as { default?: unknown }).default ?? mod;
      native = (modNative as typeof NativeTypes) ?? null;
    })
    .catch(() => {
      // native not available, use TS fallbacks
    });
}

export function isNativeAvailable(): boolean {
  return native !== null;
}

export function getNative(): typeof NativeTypes {
  if (!native) {
    throw new Error('tabook-native is not installed or not yet loaded.');
  }
  return native;
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
