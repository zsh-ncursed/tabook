// Native module loader with graceful fallback to pure-JS implementations.

import type * as NativeTypes from '@tabook/native';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let native: typeof NativeTypes | null = null;

// Try CJS require first (works in vitest), then dynamic import (works in ESM)
try {
  native = require('@tabook/native') as typeof NativeTypes;
} catch {
  // CJS failed (ESM-only env); try dynamic import
  // This is async, so native stays null until it resolves
  import('@tabook/native')
    .then((mod) => {
      native = (mod as unknown as typeof NativeTypes) ?? null;
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
    throw new Error(
      'tabook-native is not installed or not yet loaded.',
    );
  }
  return native;
}

export { native };