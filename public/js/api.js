// Thin client for /api/manage/*. The management token is sent as a header; the OpenRouter key
// never reaches the browser (all AI calls are proxied by the server).
import { getToken } from './store.js';

const BASE = (document.querySelector('meta[name="mock-api-base"]')?.content || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api/manage${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Owner-Token': getToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code || 'error', data?.error?.message || `Request failed (${res.status}).`, data?.error?.details);
  }
  return data;
}

/** Turns an ApiError into one human readable line (adds per-field validation messages). */
export function describeError(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (Array.isArray(err.details) && err.details.length) return `${err.message} ${err.details.map((d) => d.message).join('; ')}`;
  return err.message;
}
