import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sanitizeObject,
  obfuscateValue,
  detectSensitiveType,
  createSafeLogger,
} from '../log-sanitizer.js';

/**
 * Regression tests for the log sanitizer — the seam that keeps secrets out of
 * logs. These tests are deliberately written to FAIL CLOSED: if a redact key is
 * dropped, if a token starts passing through in the clear, if value-shape
 * detection is weakened, or if the safe-logger wrapper stops wrapping a method,
 * the corresponding assertion breaks.
 *
 * A JWT-shaped fixture used across value-shape tests. The middle/last segments
 * are non-trivial so partial obfuscation (first 10 / last 5) is observable.
 */
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dQw4w9WgXcQsignaturePARTzzzzzEND';

describe('log-sanitizer: full-REDACT key set (branch 1)', () => {
  // Every key here MUST become the literal '[REDACTED]' with NO part of the
  // original value surviving. Partial leakage of a password/secret/apikey is a
  // security regression, so we assert the secret substring is entirely gone.
  const fullRedactCases: Array<[string, string]> = [
    ['password', 'hunter2-super-secret-pw'],
    ['passwordHash', '$2b$10$abcdefghijklmnopqrstuv'],
    ['secret', 'top-secret-value-1234567890'],
    ['clientSecret', 'azure-client-secret-aaaa-bbbb'],
    ['jwtSecret', 'jwt-signing-key-do-not-leak'],
    ['signingSecret', 'hmac-signing-secret-zzzz'],
    ['apiKey', 'oa_sys_LIVE_abcdef1234567890'],
    ['api_key', 'sk-live-0987654321abcdef'],
    ['x-api-key', 'header-api-key-value-here'],
    ['connectionString', 'postgres://user:p%40ss@db.internal:5432/app'],
    ['databaseUrl', 'postgres://admin:secretpw@127.0.0.1:5432/prod'],
    ['database_url', 'mysql://root:rootpw@localhost/db'],
  ];

  it.each(fullRedactCases)(
    'completely redacts %s (no partial value survives)',
    (key, value) => {
      const out = sanitizeObject({ [key]: value });
      expect(out[key]).toBe('[REDACTED]');
      // Fail-closed: the raw secret must not appear anywhere in the result.
      expect(JSON.stringify(out)).not.toContain(value);
    },
  );

  it('redacts full-set keys even when showPartial is enabled (full-set ignores partial mode)', () => {
    // showPartial:true must NOT downgrade a hard-redact key to a partial reveal.
    const out = sanitizeObject(
      { password: 'reveal-me-please-1234567890' },
      { showPartial: true },
    );
    expect(out.password).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('reveal-me-please');
  });

  it('matches full-set keys case-insensitively and as substrings (e.g. dbPassword, userSecret)', () => {
    const out = sanitizeObject({
      dbPassword: 'embedded-pw-aaaa',
      USERSECRET: 'embedded-secret-bbbb',
      myApiKey: 'embedded-key-cccc',
    });
    expect(out.dbPassword).toBe('[REDACTED]');
    expect(out.USERSECRET).toBe('[REDACTED]');
    expect(out.myApiKey).toBe('[REDACTED]');
  });
});

describe('log-sanitizer: token-class keys are obfuscated, never passed through (branch 2)', () => {
  // Long tokens (>20 chars) get first-10 / last-5 treatment. The critical
  // property: the FULL token never survives, but it is not a hard '[REDACTED]'
  // either — it is the obfuscated middle-elided form.
  const longToken =
    'ya29.A0ARrdaM-THIS-IS-A-VERY-LONG-ACCESS-TOKEN-VALUE-1234567890-ENDX';

  const tokenKeys = [
    'token',
    'accessToken',
    'refreshToken',
    'idToken',
    'bearerToken',
    'authorization',
  ];

  it.each(tokenKeys)('obfuscates token-class key %s (first10/last5, full value gone)', (key) => {
    const out = sanitizeObject({ [key]: longToken });
    // Must NOT pass through verbatim.
    expect(out[key]).not.toBe(longToken);
    // Must NOT be a hard redaction — token keys use partial obfuscation.
    expect(out[key]).not.toBe('[REDACTED]');
    // Obfuscated form: first 10 chars + '...' + last 5 chars.
    const expected = `${longToken.substring(0, 10)}...${longToken.substring(longToken.length - 5)}`;
    expect(out[key]).toBe(expected);
    // The interior of the token (the part that carries the secret) is elided.
    expect(out[key]).not.toContain('VERY-LONG-ACCESS-TOKEN');
  });

  it('reduces an overly-short token to [SHORT_TOKEN] rather than revealing it', () => {
    const out = sanitizeObject({ accessToken: 'short.tok.1' });
    expect(out.accessToken).toBe('[SHORT_TOKEN]');
  });

  it('hard-redacts token-class keys when showPartial is explicitly disabled', () => {
    // With showPartial:false, partial-show keys fall back to a hard redaction.
    const out = sanitizeObject(
      { authorization: longToken },
      { showPartial: false },
    );
    expect(out.authorization).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('VERY-LONG-ACCESS-TOKEN');
  });
});

describe('log-sanitizer: detectSensitiveType value-shape detection (branch 3)', () => {
  it('classifies a JWT-shaped value as token regardless of an innocuous key', () => {
    // The headline guard: a JWT under a non-obvious key name is still a token.
    expect(detectSensitiveType('data', JWT)).toBe('token');
    expect(detectSensitiveType('payload', JWT)).toBe('token');
  });

  it('does NOT misclassify a normal string under an innocuous key', () => {
    // Fail-closed in the other direction: ordinary data must return null so it
    // is not needlessly mangled.
    expect(detectSensitiveType('comment', 'just a normal sentence')).toBeNull();
    expect(detectSensitiveType('count', '42')).toBeNull();
  });

  it('classifies email-shaped and uuid-shaped values by content', () => {
    expect(detectSensitiveType('whatever', 'jane.doe@example.com')).toBe('email');
    expect(
      detectSensitiveType('whatever', '550e8400-e29b-41d4-a716-446655440000'),
    ).toBe('uuid');
  });

  it('keys force a type even when the value shape is unremarkable', () => {
    // Key-driven classification: a key containing "token" wins.
    expect(detectSensitiveType('sessionToken', 'plainvalue')).toBe('token');
    expect(detectSensitiveType('userEmail', 'plainvalue')).toBe('email');
    expect(detectSensitiveType('tenantId', 'plainvalue')).toBe('uuid');
  });

  it('a JWT under a token-ish partial key is obfuscated by sanitizeObject end-to-end', () => {
    // Ties the detection into the deep sanitizer: a JWT bearer token is elided.
    const out = sanitizeObject({ bearerToken: JWT });
    expect(out.bearerToken).not.toBe(JWT);
    expect(out.bearerToken).toBe(`${JWT.substring(0, 10)}...${JWT.substring(JWT.length - 5)}`);
  });
});

describe('log-sanitizer: customPatterns RegExp match (branch 4)', () => {
  it('redacts a value matching a custom pattern under an otherwise-innocuous key', () => {
    // Credit-card-shaped values under a benign key would slip past the key
    // lists; customPatterns catch them on value content.
    const ccPattern = /\b\d{4}-\d{4}-\d{4}-\d{4}\b/;
    const out = sanitizeObject(
      { note: '4111-1111-1111-1111' },
      { customPatterns: [ccPattern] },
    );
    expect(out.note).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('4111-1111-1111-1111');
  });

  it('redacts when a custom pattern matches the KEY name', () => {
    const out = sanitizeObject(
      { internalDebugTrace: 'some-internal-value' },
      { customPatterns: [/debug/i] },
    );
    expect(out.internalDebugTrace).toBe('[REDACTED]');
  });

  it('leaves non-matching values untouched when customPatterns are supplied', () => {
    const out = sanitizeObject(
      { note: 'ordinary text', count: 7 },
      { customPatterns: [/\b\d{4}-\d{4}-\d{4}-\d{4}\b/] },
    );
    expect(out.note).toBe('ordinary text');
    expect(out.count).toBe(7);
  });
});

describe('log-sanitizer: NEGATIVE — non-sensitive keys pass through unchanged (branch 5)', () => {
  it('does not over-redact ordinary fields', () => {
    const input = {
      count: 42,
      status: 'active',
      enabled: true,
      ratio: 0.75,
      name: 'incident-triage',
      nullField: null,
      tags: ['ops', 'oncall'],
    };
    const out = sanitizeObject(input);
    expect(out.count).toBe(42);
    expect(out.status).toBe('active');
    expect(out.enabled).toBe(true);
    expect(out.ratio).toBe(0.75);
    expect(out.name).toBe('incident-triage');
    expect(out.nullField).toBeNull();
    expect(out.tags).toEqual(['ops', 'oncall']);
    // The literal '[REDACTED]' must appear NOWHERE — proves no over-redaction.
    expect(JSON.stringify(out)).not.toContain('[REDACTED]');
  });

  it('returns primitives and null unchanged (non-object inputs)', () => {
    expect(sanitizeObject('plain string')).toBe('plain string');
    expect(sanitizeObject(123)).toBe(123);
    expect(sanitizeObject(null)).toBeNull();
    expect(sanitizeObject(undefined)).toBeUndefined();
  });
});

describe('log-sanitizer: nested object / array recursion (branch 6)', () => {
  it('redacts secrets buried deep in nested objects', () => {
    const input = {
      service: 'auth',
      config: {
        retries: 3,
        credentials: {
          password: 'deep-nested-password-9999',
          username: 'svc-account',
        },
      },
    };
    const out = sanitizeObject(input);
    expect(out.service).toBe('auth');
    expect(out.config.retries).toBe(3);
    expect(out.config.credentials.username).toBe('svc-account');
    expect(out.config.credentials.password).toBe('[REDACTED]');
    // The deep secret must not survive anywhere in the serialized output.
    expect(JSON.stringify(out)).not.toContain('deep-nested-password-9999');
  });

  it('redacts secrets inside arrays of objects', () => {
    const input = {
      providers: [
        { name: 'aws', apiKey: 'aws-key-aaaa-secret' },
        { name: 'gcp', apiKey: 'gcp-key-bbbb-secret' },
      ],
    };
    const out = sanitizeObject(input);
    expect(out.providers[0].name).toBe('aws');
    expect(out.providers[0].apiKey).toBe('[REDACTED]');
    expect(out.providers[1].apiKey).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('aws-key-aaaa-secret');
    expect(JSON.stringify(out)).not.toContain('gcp-key-bbbb-secret');
  });

  it('does not mutate the original input object', () => {
    const input = { password: 'original-secret-value' };
    sanitizeObject(input);
    // Sanitizer must be non-destructive on the caller's object.
    expect(input.password).toBe('original-secret-value');
  });
});

describe('log-sanitizer: createSafeLogger wraps every log method (branch 7)', () => {
  const ORIG_NODE_ENV = process.env.NODE_ENV;
  const ORIG_ENABLE = process.env.ENABLE_LOG_SANITIZATION;

  beforeEach(() => {
    // Ensure the wrapper is NOT short-circuited (it bypasses in production
    // unless ENABLE_LOG_SANITIZATION is set). Force the sanitizing path.
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_LOG_SANITIZATION;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIG_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIG_NODE_ENV;
    if (ORIG_ENABLE === undefined) delete process.env.ENABLE_LOG_SANITIZATION;
    else process.env.ENABLE_LOG_SANITIZATION = ORIG_ENABLE;
    vi.restoreAllMocks();
  });

  // A fake logger that records exactly what arguments each method received.
  function makeFakeLogger() {
    const calls: Record<string, any[][]> = {};
    const methods = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    const logger: any = {};
    for (const m of methods) {
      calls[m] = [];
      logger[m] = function (...args: any[]) {
        calls[m].push(args);
      };
    }
    logger.child = function (bindings: any) {
      // Real pino child returns a logger; emulate by returning a fresh fake
      // that also records, so we can assert child bindings are sanitized.
      const childLogger: any = makeFakeLogger();
      childLogger.__childBindings = bindings;
      return childLogger;
    };
    logger.level = 'info';
    logger.__calls = calls;
    return logger;
  }

  const methods = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

  it.each(methods)(
    'sanitizes a secret passed directly to logger.%s — cannot be bypassed',
    (method) => {
      const fake = makeFakeLogger();
      const safe = createSafeLogger(fake);
      // Call the method directly with a secret-bearing object.
      safe[method]({ password: 'leaked-via-' + method + '-9999', userId: 'u1' });
      const received = fake.__calls[method][0][0];
      expect(received.password).toBe('[REDACTED]');
      expect(received.userId).toBe('u1');
      // The raw secret must never reach the underlying logger.
      expect(JSON.stringify(received)).not.toContain('leaked-via-');
    },
  );

  it('passes non-object args (e.g. message strings) through unchanged', () => {
    const fake = makeFakeLogger();
    const safe = createSafeLogger(fake);
    safe.info({ token: 'short.t.x' }, 'a plain log message');
    const [objArg, strArg] = fake.__calls.info[0];
    expect(objArg.token).toBe('[SHORT_TOKEN]');
    expect(strArg).toBe('a plain log message');
  });

  it('sanitizes bindings passed to logger.child()', () => {
    const fake = makeFakeLogger();
    const safe = createSafeLogger(fake);
    const child = safe.child({ requestId: 'r1', apiKey: 'child-secret-key-zzzz' });
    // The child wrapper sanitizes bindings before they are bound.
    expect(child.__childBindings.requestId).toBe('r1');
    expect(child.__childBindings.apiKey).toBe('[REDACTED]');
  });

  it('the child logger is itself a safe (wrapping) logger', () => {
    const fake = makeFakeLogger();
    const safe = createSafeLogger(fake);
    const child = safe.child({ requestId: 'r1' });
    // Logging a secret through the child must still redact — i.e. createSafeLogger
    // recursed into the child so redaction is not bypassable one level down.
    child.warn({ clientSecret: 'child-level-secret-1234' });
    const received = child.__calls.warn[0][0];
    expect(received.clientSecret).toBe('[REDACTED]');
    expect(JSON.stringify(received)).not.toContain('child-level-secret-1234');
  });

  it('returns the raw logger unmodified in production without ENABLE_LOG_SANITIZATION', () => {
    // Guards the documented bypass: production builds skip sanitization unless
    // explicitly enabled. If this flips, the assertion below catches it.
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_LOG_SANITIZATION;
    const fake = makeFakeLogger();
    const safe = createSafeLogger(fake);
    // Same reference — no wrapping happened.
    expect(safe).toBe(fake);
  });

  it('DOES sanitize in production when ENABLE_LOG_SANITIZATION is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_LOG_SANITIZATION = '1';
    const fake = makeFakeLogger();
    const safe = createSafeLogger(fake);
    expect(safe).not.toBe(fake);
    safe.error({ password: 'prod-secret-but-enabled' });
    expect(fake.__calls.error[0][0].password).toBe('[REDACTED]');
  });
});

describe('log-sanitizer: obfuscateValue unit behavior', () => {
  it('token: long value -> first10/last5; short -> [SHORT_TOKEN]', () => {
    const long = 'abcdefghij_MIDDLE_PART_HERE_klmno';
    expect(obfuscateValue(long, 'token')).toBe(
      `${long.substring(0, 10)}...${long.substring(long.length - 5)}`,
    );
    expect(obfuscateValue('tiny', 'token')).toBe('[SHORT_TOKEN]');
  });

  it('email: keeps first 3 of local part + domain, elides the rest', () => {
    expect(obfuscateValue('jonathan@corp.example', 'email')).toBe('jon***@corp.example');
    expect(obfuscateValue('ab@corp.example', 'email')).toBe('***@corp.example');
    expect(obfuscateValue('not-an-email', 'email')).toBe('[INVALID_EMAIL]');
  });

  it('uuid: shows only the 8-char prefix, masks the remainder', () => {
    expect(obfuscateValue('550e8400-e29b-41d4-a716-446655440000', 'uuid')).toBe(
      '550e8400-****-****-****-************',
    );
    expect(obfuscateValue('not-a-uuid', 'uuid')).toBe('[INVALID_UUID]');
  });

  it('default: long value partially shown, short value -> [REDACTED]', () => {
    expect(obfuscateValue('this-is-long-enough', 'default')).toBe('this...gh');
    expect(obfuscateValue('short', 'default')).toBe('[REDACTED]');
  });

  it('falsy input is returned as-is (no crash, no fake redaction)', () => {
    expect(obfuscateValue('', 'token')).toBe('');
    expect(obfuscateValue(undefined as any, 'token')).toBeUndefined();
    expect(obfuscateValue(null as any, 'token')).toBeNull();
  });
});
