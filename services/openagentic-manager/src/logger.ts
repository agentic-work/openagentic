import pino from 'pino';

// JSON output by default (for Promtail/Loki/Splunk ingestion)
// Set LOG_PRETTY=true for human-readable local dev output
const usePretty = process.env.LOG_PRETTY === 'true';
let transport: pino.TransportSingleOptions | undefined;
if (usePretty) {
  try {
    require.resolve('pino-pretty');
    transport = { target: 'pino-pretty', options: { colorize: true } };
  } catch {
    // pino-pretty not installed, fall back to JSON
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
  base: { service: 'openagentic-manager' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['*.password', '*.token', '*.apiKey', '*.secret', '*.authorization'],
    censor: '[REDACTED]',
  },
});

// Child loggers for each component
export const loggers = {
  sessions: logger.child({ component: 'sessions' }),
  k8s: logger.child({ component: 'k8s' }),
  storage: logger.child({ component: 'storage' }),
  websocket: logger.child({ component: 'websocket' }),
  metrics: logger.child({ component: 'metrics' }),
  api: logger.child({ component: 'api' }),
  security: logger.child({ component: 'security' }),
  init: logger.child({ component: 'init' }),
  events: logger.child({ component: 'events' }),
  admin: logger.child({ component: 'admin' }),
  sandbox: logger.child({ component: 'sandbox' }),
  serverless: logger.child({ component: 'serverless' }),
};
