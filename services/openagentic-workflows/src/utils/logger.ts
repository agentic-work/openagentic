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
