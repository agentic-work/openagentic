/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  base: { service: 'openagentic-exec' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['*.password', '*.token', '*.apiKey', '*.secret', '*.authorization'],
    censor: '[REDACTED]',
  },
});

export const loggers = {
  api: logger.child({ component: 'api' }),
  pty: logger.child({ component: 'pty' }),
  storage: logger.child({ component: 'storage' }),
  websocket: logger.child({ component: 'websocket' }),
  shell: logger.child({ component: 'shell' }),
  security: logger.child({ component: 'security' }),
  codeServer: logger.child({ component: 'code-server' }),
  sandbox: logger.child({ component: 'sandbox' }),
};
