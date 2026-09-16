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

  it('resolves chapter navigation keys', () => {
    const r = makeResolver();
    expect(r.feed(']')).toBe('next_chapter');
    expect(r.feed('[')).toBe('prev_chapter');
  });

  it('allows rebinding chapter navigation keys via config', () => {
    const config = defaultConfig();
    config.keybindings[']'] = 'prev_chapter';
    config.keybindings['['] = 'next_chapter';
    config.keybindings['}'] = 'next_chapter';
    const r = createActionResolver(config);
    expect(r.feed('}')).toBe('next_chapter');
    expect(r.feed('[')).toBe('next_chapter');
    expect(r.feed(']')).toBe('prev_chapter');
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

  it('does not double-fire when a key is both a single binding and a combo prefix', () => {
    const config = defaultConfig();
    config.keybindings.g = 'scroll_down';
    config.keybindings.gg = 'go_to_start';
    const r = createActionResolver(config);
    // First 'g': key is a prefix of 'gg' — must NOT return scroll_down.
    expect(r.feed('g')).toBeUndefined();
    // Second 'g': completes 'gg' combo.
    expect(r.feed('g')).toBe('go_to_start');
  });

  it('returns the single-key action when the next key breaks the combo', () => {
    const config = defaultConfig();
    config.keybindings.g = 'scroll_down';
    config.keybindings.gg = 'go_to_start';
    const r = createActionResolver(config);
    // First 'g': buffered as prefix.
    expect(r.feed('g')).toBeUndefined();
    // 'j' breaks the combo — 'g' is flushed, 'j' resolves to its own action.
    expect(r.feed('j')).toBe('move_cursor_down');
    // But 'g' was consumed, so the single-key 'scroll_down' never fired.
    // Next 'g' starts a fresh combo.
    expect(r.feed('g')).toBeUndefined();
    expect(r.feed('g')).toBe('go_to_start');
  });

  it('returns direct action for a non-prefix single key', () => {
    const config = defaultConfig();
    config.keybindings.g = 'scroll_down';
    config.keybindings.gg = 'go_to_start';
    const r = createActionResolver(config);
    // 'j' is not a combo prefix — fires directly.
    expect(r.feed('j')).toBe('move_cursor_down');
    // 'g' is a prefix — buffered.
    expect(r.feed('g')).toBeUndefined();
    expect(r.feed('g')).toBe('go_to_start');
  });

  it('does not treat a 2-char named key as a combo prefix', () => {
    // 'up' is a named key, not a 'u'+'p' combo. Before the fix, 'u' looked
    // like the prefix of the 'up' "combo" and was swallowed — which broke
    // the OPDS 'u' = back verb once it routed through the resolver.
    const config = defaultConfig();
    config.keybindings.u = 'back';
    const r = createActionResolver(config);
    expect(r.feed('u')).toBe('back');
    // And a real prefix still buffers correctly.
    expect(r.feed('g')).toBeUndefined();
    expect(r.feed('g')).toBe('go_to_start');
  });
});
