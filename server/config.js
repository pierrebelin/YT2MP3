// Configuration : tout est pilotable par variables d'environnement (§10.4).
import path from 'node:path';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const env = process.env;

export const config = {
  port: num(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',

  // À n'activer que si un reverse proxy de confiance réécrit `X-Forwarded-For`.
  trustProxy: bool(env.TRUST_PROXY, false),

  maxDurationSeconds: num(env.MAX_DURATION_SECONDS, 5400),
  maxConcurrentJobs: num(env.MAX_CONCURRENT_JOBS, 4),
  maxQueueLength: num(env.MAX_QUEUE_LENGTH, 50),

  // Le fichier est supprimé dès son unique téléchargement ; ce délai ne couvre que les jobs
  // abandonnés (onglet fermé avant la fin), pour éviter d'accumuler des orphelins sur le disque.
  orphanTtlMinutes: num(env.ORPHAN_TTL_MINUTES, 10),
  metadataCacheTtlMinutes: num(env.METADATA_CACHE_TTL_MINUTES, 15),

  rateLimitAnalyze: num(env.RATE_LIMIT_ANALYZE, 20),
  rateLimitJobs: num(env.RATE_LIMIT_JOBS, 10),
  rateLimitWindowMinutes: num(env.RATE_LIMIT_WINDOW_MINUTES, 10),

  storagePath: path.resolve(env.STORAGE_PATH || './data/files'),
  storageQuotaMb: num(env.STORAGE_QUOTA_MB, 10240),

  targetBitrateKbps: num(env.TARGET_BITRATE_KBPS, 320),
  defaultOutputFormat: env.DEFAULT_OUTPUT_FORMAT || 'mp3-320',
  enabledOutputFormats: (env.ENABLED_OUTPUT_FORMATS || 'mp3-320,m4a-copy,mp3-v0')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  force44100: bool(env.FORCE_44100, false),
  embedCoverDefault: bool(env.EMBED_COVER_DEFAULT, true),

  blocklistPath: env.BLOCKLIST_PATH || '',
  ytdlpPath: env.YTDLP_PATH || 'yt-dlp',
  ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
  ytdlpCookiesPath: env.YTDLP_COOKIES_PATH || '',

  // Délais de garde (§12.2), en millisecondes.
  timeouts: {
    download: num(env.TIMEOUT_DOWNLOAD_MS, 10 * 60_000),
    encoding: num(env.TIMEOUT_ENCODING_MS, 10 * 60_000),
    tagging: num(env.TIMEOUT_TAGGING_MS, 60_000),
    total: num(env.TIMEOUT_TOTAL_MS, 20 * 60_000),
    stall: num(env.TIMEOUT_STALL_MS, 90_000),
  },
};
