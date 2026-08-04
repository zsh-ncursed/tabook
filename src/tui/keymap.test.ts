import { describe, it, expect } from 'vitest';
import { createActionResolver } from './keymap.js';
import { defaultConfig } from '../config/defaults.js';

function makeResolver() {
  return createActionResolver(defaultConfig());
}

describe('createActionResolver', () => {
  it('resolves single keys to actions', () => {
    const r = makeResolver();
    expect(r.feed('j')).toBe('move_cursor_down');
    expect(r.feed('k')).toBe('move_cursor_up');
  });

  it('resolves multi-key sequences like gg', () => {
    const r = makeResolver();
    expect(r.feed('g')).toBeUndefined();
    expect(r.feed('g')).toBe('go_to_start');
  });

  it('falls back to the single-key action when a sequence does not match', () => {
    const r = makeResolver();
    r.feed('g');
    expect(r.feed('j')).toBe('move_cursor_down');
    expect(r.feed('g')).toBeUndefined();
    expect(r.feed('g')).toBe('go_to_start');
  });

  it('handles named keys without treating them as sequence prefixes', () => {
    const r = makeResolver();
    expect(r.feed('pageup')).toBe('page_up');
    expect(r.feed('pagedown')).toBe('page_down');
    expect(r.feed('g')).toBeUndefined();
  });
});
