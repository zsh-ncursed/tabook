export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }
}

export class ParseError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('PARSE_ERROR', message, options);
    this.name = 'ParseError';
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('CONFIG_ERROR', message, options);
    this.name = 'ConfigError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('DB_ERROR', message, options);
    this.name = 'DatabaseError';
  }
}
