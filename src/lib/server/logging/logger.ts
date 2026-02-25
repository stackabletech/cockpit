import pino from 'pino';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { redactionPaths, redactionCensor } from './redaction.js';
import type { LoggingConfig } from './types.js';

function resolveConfig(): LoggingConfig {
  const level = env.LOG_LEVEL ?? (dev ? 'trace' : 'info');
  const pretty = env.LOG_PRETTY === undefined ? dev : env.LOG_PRETTY === 'true';
  const jsonLogFile = env.LOG_JSON_FILE || undefined;
  return { level, pretty, jsonLogFile };
}

function createLogger(): pino.Logger {
  const config = resolveConfig();

  const options: pino.LoggerOptions = {
    level: config.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'stackable-ui' },
    redact: {
      paths: redactionPaths,
      censor: redactionCensor
    },
    formatters: {
      level(label) {
        return { level: label };
      }
    }
  };

  const targets: pino.TransportTargetOptions[] = [];

  if (config.pretty) {
    targets.push({ target: 'pino-pretty', level: config.level });
  } else {
    targets.push({ target: 'pino/file', level: config.level });
  }

  if (config.jsonLogFile) {
    targets.push({
      target: 'pino/file',
      options: { destination: config.jsonLogFile, mkdir: true },
      level: config.level
    });
  }

  return pino(options, pino.transport({ targets }));
}

/** Root pino logger instance. Use `logger.child({ module: '...' })` for module-level loggers. */
export const logger = createLogger();
