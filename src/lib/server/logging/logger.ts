import pino from 'pino';
import { redactionPaths, redactionCensor } from './redaction.js';
import type { LoggingConfig } from './types.js';

// Use process.env directly instead of SvelteKit's $app/environment and
// $env/dynamic/private so the logger can be imported from any Node.js context
// (e.g. the better-auth CLI which loads auth.ts outside of SvelteKit via jiti).
// This is safe because the file lives under $lib/server/ which SvelteKit
// already prevents from being imported client-side.
const dev = process.env.NODE_ENV !== 'production';

function resolveConfig(): LoggingConfig {
  const level = process.env.LOG_LEVEL ?? (dev ? 'trace' : 'info');
  const pretty = process.env.LOG_PRETTY === undefined ? dev : process.env.LOG_PRETTY === 'true';
  const jsonLogFile = process.env.LOG_JSON_FILE || undefined;
  return { level, pretty, jsonLogFile };
}

function createLogger(): pino.Logger {
  const config = resolveConfig();

  const options: pino.LoggerOptions = {
    level: config.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'stackable-cockpit' },
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
