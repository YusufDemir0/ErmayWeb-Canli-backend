import { AsyncLocalStorage } from 'async_hooks';

/**
 * Structured application logger.
 *
 * - One JSON object per line (JSON Lines), field names follow Elastic Common Schema (ECS) so logs can be shipped to
 *   Elasticsearch / Loki / Datadog / CloudWatch without a custom parser.
 * - Severity levels follow RFC 5424 names: debug < info < warn < error. Minimum level from LOG_LEVEL (default: info).
 * - Messages are short, plain English. Personal data (KVKK/GDPR) is never written: known PII keys are redacted and
 *   free-text error messages are passed through `redactText` (phone numbers, e-mail addresses).
 * - The current request id (trace.id) is attached automatically via AsyncLocalStorage.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configuredLevel = ((process.env.LOG_LEVEL || '').toLowerCase() as Level) || (process.env.NODE_ENV === 'test' ? 'warn' : 'info');
const minLevel = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.info;

export interface RequestContext {
  requestId: string;
  userId?: string;
  userRole?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Keys whose values must never reach the log sink
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|integration[-_]?key|iban|card|cvv|phone|email|e-mail|address|addressline|customername|fullname|tckn|ip$/i;

const PHONE_RE = /(?:\+?90[\s-]?)?0?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Masks phone numbers and e-mail addresses inside free text (e.g. third-party error messages). */
export function redactText(text: string): string {
  return text.replace(EMAIL_RE, '[redacted-email]').replace(PHONE_RE, '[redacted-phone]');
}

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return redactText(value.length > 2000 ? `${value.slice(0, 2000)}…` : value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

/** ECS `error.*` fields from any thrown value. Stack traces are kept (no PII), messages are redacted. */
export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return {
      'error.type': err.name,
      'error.message': redactText(err.message),
      ...(code !== undefined ? { 'error.code': String(code) } : {}),
      ...(err.stack ? { 'error.stack_trace': redactText(err.stack) } : {}),
    };
  }
  return { 'error.message': redactText(String(err)) };
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < minLevel) return;
  const ctx = requestContext.getStore();
  const entry: Record<string, unknown> = {
    '@timestamp': new Date().toISOString(),
    'log.level': level,
    message,
    'service.name': 'ermayweb-backend',
    ...(ctx?.requestId ? { 'trace.id': ctx.requestId } : {}),
    ...(ctx?.userId ? { 'user.id': ctx.userId } : {}),
    ...(ctx?.userRole ? { 'user.roles': [ctx.userRole] } : {}),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
  /**
   * Audit trail for business/security events (who changed what). `action` uses dotted names,
   * e.g. "order_request.created", "store.updated", "auth.login_failed".
   */
  audit: (action: string, outcome: 'success' | 'failure', fields?: Record<string, unknown>) =>
    write(outcome === 'failure' ? 'warn' : 'info', `${action} ${outcome}`, {
      'event.kind': 'event',
      'event.category': ['audit'],
      'event.action': action,
      'event.outcome': outcome,
      ...fields,
    }),
};

export default logger;
