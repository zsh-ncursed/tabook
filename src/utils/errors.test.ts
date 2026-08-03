import { describe, it, expect } from 'vitest';
import { AppError, ParseError, ConfigError, DatabaseError } from './errors.js';

describe('errors', () => {
  it('AppError carries a code and name', () => {
    const err = new AppError('X', 'boom');
    expect(err.code).toBe('X');
    expect(err.name).toBe('AppError');
    expect(err.message).toBe('boom');
  });

  it('subclasses set their own codes', () => {
    expect(new ParseError('bad').code).toBe('PARSE_ERROR');
    expect(new ParseError('bad').name).toBe('ParseError');
    expect(new ConfigError('bad').code).toBe('CONFIG_ERROR');
    expect(new ConfigError('bad').name).toBe('ConfigError');
    expect(new DatabaseError('bad').code).toBe('DB_ERROR');
    expect(new DatabaseError('bad').name).toBe('DatabaseError');
  });

  it('passes through instanceof checks', () => {
    const err = new ParseError('bad');
    expect(err).toBeInstanceOf(ParseError);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the cause', () => {
    const cause = new Error('root');
    const err = new ParseError('wrapped', { cause });
    expect(err.cause).toBe(cause);
  });
});
