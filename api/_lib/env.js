// Central, typed access to environment configuration. Nothing here is ever sent to the browser
// except the whitelisted `publicLimits()` summary.
const int = (key, fallback) => {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};
const str = (key, fallback = '') => (process.env[key] ?? fallback).trim();

export const config = {
  dbUrl: str('NEON_DATABASE_URL') || str('DATABASE_URL'),
  localDb: str('LOCAL_DB'),

  openrouterKey: str('OPENROUTER_API_KEY'),
  openrouterModel: str('OPENROUTER_MODEL', 'google/gemini-2.5-flash-lite'),
  openrouterFallback: str('OPENROUTER_FALLBACK_MODEL', 'nvidia/nemotron-3.5-super-vl:free'),
  openrouterTimeoutMs: int('OPENROUTER_TIMEOUT_MS', 20000),
  openrouterRetries: int('OPENROUTER_MAX_RETRIES', 2),

  maxProjects: int('MAX_PROJECTS_PER_OWNER', 5),
  maxResources: int('MAX_RESOURCES_PER_PROJECT', 10),
  maxRecords: int('MAX_RECORDS_PER_RESOURCE', 100),
  maxRequestsPerDay: int('MAX_REQUESTS_PER_DAY', 1000),
  maxDelayMs: int('MAX_DELAY_MS', 5000),
  aiDailyLimit: int('AI_DAILY_LIMIT', 20),

  rateIpPerMin: int('RATE_LIMIT_IP_PER_MIN', 120),
  rateManagePerMin: int('RATE_LIMIT_MANAGE_PER_MIN', 90),
  projectCreatesPerIpDay: int('MAX_PROJECT_CREATES_PER_IP_PER_DAY', 10),
  maxBodyBytes: int('MAX_BODY_BYTES', 16384),
  manageMaxBodyBytes: int('MANAGE_MAX_BODY_BYTES', 262144),

  inactiveDays: int('INACTIVE_PROJECT_DAYS', 30),
  cronSecret: str('CRON_SECRET'),
  ipSalt: str('IP_HASH_SALT', 'frugal-mock-api'),

  allowedOrigins: str('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  publicBaseUrl: str('PUBLIC_BASE_URL').replace(/\/+$/, ''),
};

/** Limits that are safe (and useful) to show in the UI. */
export function publicLimits() {
  return {
    max_projects: config.maxProjects,
    max_resources: config.maxResources,
    max_records: config.maxRecords,
    max_requests_per_day: config.maxRequestsPerDay,
    max_delay_ms: config.maxDelayMs,
    max_body_bytes: config.maxBodyBytes,
    ai_daily_limit: config.aiDailyLimit,
    ai_enabled: Boolean(config.openrouterKey),
  };
}
