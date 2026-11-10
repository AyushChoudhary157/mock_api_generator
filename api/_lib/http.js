// Small HTTP helpers that only rely on the plain Node req/res API so the same handlers work on
// Vercel and in the local dev server.
import { config } from './env.js';
import { log } from './log.js';

export class ApiError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (status === 204 || status === 205 || status === 304) return void res.end();
  const payload = JSON.stringify(body ?? null);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

/** Reads and parses a JSON body with a hard size limit. Rejects non-JSON uploads. */
export async function readJson(req, maxBytes) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json') && !type.includes('+json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes.`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

export function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'invalid_body', 'Request body must be a JSON object.');
  }
  return body;
}

export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.headers['x-real-ip'] || '') || req.socket?.remoteAddress || 'unknown';
}

/** Splits `/api/<prefix>/a/b?x=1` into segments after the prefix + a URLSearchParams. */
export function parseUrl(req, prefix) {
  const url = new URL(req.url, 'http://localhost');
  let path = url.pathname;
  if (path.startsWith(prefix)) path = path.slice(prefix.length);
  const segs = path.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { throw new ApiError(400, 'bad_path', 'Malformed URL path.'); }
  });
  return { segs, query: url.searchParams, pathname: url.pathname };
}

export function baseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

const EXPOSED = ['X-Total-Count', 'X-Page', 'X-Limit', 'X-Total-Pages', 'Link',
  'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'];

/** Public mock endpoints: open CORS for everybody. */
export function publicCors(req, res, extraExposed = []) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Expose-Headers', [...EXPOSED, ...extraExposed].join(', '));
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

/** Management endpoints: only allow-listed origins (same-origin needs no CORS at all). */
export function manageCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (!origin) return;
  const ok = config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!ok) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Owner-Token');
  res.setHeader('Access-Control-Max-Age', '600');
}

/** Wraps a handler so every failure becomes a structured JSON error. */
export function wrap(handler) {
  return async function wrapped(req, res) {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ApiError) {
        return sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details } }, err.headers || {});
      }
      log('error', 'unhandled_error', { path: req.url, method: req.method, error: String(err?.stack || err) });
      sendJson(res, 500, { error: { code: 'internal_error', message: 'Something went wrong on our side.' } });
    }
  };
}
