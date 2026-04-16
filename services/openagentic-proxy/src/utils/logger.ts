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
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['*.password', '*.token', '*.apiKey', '*.secret', '*.authorization'],
    censor: '[REDACTED]',
  },
}).child({ service: 'openagentic-proxy' });
