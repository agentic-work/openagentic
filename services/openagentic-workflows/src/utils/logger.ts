import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function createLogger(name: string): pino.Logger {
  return pino.default({
    level,
    name,
    timestamp: pino.default.stdTimeFunctions.isoTime,
    base: {
      service: 'openagentic-workflows',
      component: name,
      pid: process.pid,
      hostname: process.env.HOSTNAME,
    },
    redact: {
      paths: ['password', '*.password', 'accessToken', '*.accessToken', 'token', '*.token'],
      censor: '[REDACTED]',
    },
  });
}

export const loggers = {
  server: createLogger('server'),
  routes: createLogger('routes'),
  services: createLogger('services'),
};
