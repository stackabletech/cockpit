import { vi } from 'vitest';
import type pino from 'pino';

export function createMockLogger(): pino.Logger {
  const childLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    child: vi.fn()
  };

  childLogger.child.mockReturnValue(childLogger);
  return childLogger as unknown as pino.Logger;
}

const childLogger = createMockLogger();
export const logger = { child: vi.fn(() => childLogger) };
