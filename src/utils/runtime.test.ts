import { describe, it, expect } from 'vitest';
import { nativeRuntimeError, REQUIRED_NAPI_VERSION, MIN_NODE_VERSION } from './runtime.js';

describe('nativeRuntimeError', () => {
  it('rejects a runtime whose Node-API version is too low', () => {
    const message = nativeRuntimeError('9', 'v22.5.1');
    expect(message).not.toBeNull();
    expect(message).toContain('v22.5.1');
    expect(message).toContain('Node-API v9');
    expect(message).toContain(`Node-API v${REQUIRED_NAPI_VERSION}`);
    expect(message).toContain(MIN_NODE_VERSION);
  });

  it('accepts a runtime at the required Node-API version', () => {
    expect(nativeRuntimeError('10', 'v22.14.0')).toBeNull();
  });

  it('accepts a runtime above the required Node-API version', () => {
    expect(nativeRuntimeError('11', 'v26.5.0')).toBeNull();
  });

  it('does not block when the Node-API version is unreported', () => {
    expect(nativeRuntimeError(undefined, 'v22.5.1')).toBeNull();
  });

  it('does not block when the Node-API version is not numeric', () => {
    expect(nativeRuntimeError('experimental', 'v22.5.1')).toBeNull();
  });

  it('passes on the Node version actually running the test suite', () => {
    expect(nativeRuntimeError()).toBeNull();
  });
});
