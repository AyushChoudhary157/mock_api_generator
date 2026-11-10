// Scheduled housekeeping (see vercel.json "crons"). Protected by CRON_SECRET.
import { query } from '../_lib/db.js';
import { config } from '../_lib/env.js';
import { ApiError, wrap, sendJson } from '../_lib/http.js';
import { log } from '../_lib/log.js';

export default wrap(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  if (!config.cronSecret || auth !== `Bearer ${config.cronSecret}`) {
    throw new ApiError(401, 'unauthorized', 'Invalid cron secret.');
  }
  // Anonymous projects (no e-mail attached) that nobody touched for N days. Cascades to
  // resources, records and request logs.
  const projects = await query(
    `DELETE FROM projects WHERE email IS NULL AND last_active_at < now() - make_interval(days => $1::int) RETURNING id`,
    [config.inactiveDays]);
  const logs = await query(`DELETE FROM request_logs WHERE created_at < now() - interval '7 days' RETURNING id`);
  const counters = await query(`DELETE FROM rate_limit_counters WHERE window_start < now() - interval '2 days' RETURNING key`);
  const cache = await query(`DELETE FROM ai_cache WHERE created_at < now() - interval '30 days' RETURNING key`);
  const summary = { projects: projects.length, request_logs: logs.length, counters: counters.length, ai_cache: cache.length };
  log('info', 'cleanup_done', summary);
  sendJson(res, 200, summary);
});
