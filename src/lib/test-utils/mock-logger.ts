import { vi } from 'vitest';

const childLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  child: vi.fn()
};

childLogger.child.mockReturnValue(childLogger);

export const logger = { child: vi.fn(() => childLogger) };
