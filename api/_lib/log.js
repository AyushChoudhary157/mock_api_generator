// Structured (JSON-lines) logging; easy to ship to Vercel/Datadog/Logtail.
export function log(level, message, fields = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: message, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
