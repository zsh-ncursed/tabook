// Native module loader with graceful fallback to pure-JS implementations.
//
// Phase 0: fallback is the existing TS code. Once all phases complete and
// native is stable, fallback can be removed (phase 16).

import type * as NativeTypes from '@tabook/native';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let native: typeof NativeTypes | null = null;

try {
  native = require('@tabook/native') as typeof NativeTypes;
} catch {
  native = null;
}

export function isNativeAvailable(): boolean {
  return native !== null;
}

export function getNative(): typeof NativeTypes {
  if (!native) {
    throw new Error(
      'tabook-native is not installed. Install @tabook/native or use pure-JS fallback.',
    );
  }
  return native;
}

export { native };