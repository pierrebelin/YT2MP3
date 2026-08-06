// Serveur HTTP : Node natif, zéro dépendance runtime (P2 — aucun script tiers, ici non plus).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { AppError } from './errors.js';
import { analyze } from './metadata.js';
import { checkBinary } from './proc.js';
import { initStorage, jobFilePath, hasFreeSpace } from './storage.js';
import { createJob, getJob, jobView, cancelJob, consumeJob, subscribe, startReaper, stats } from './queue.js';
import { parseYoutubeUrl, isValidVideoId } from '../public/shared/youtube-url.js';
import { sanitizeFilename, asciiFallback } from '../public/shared/filename.js';
import { resolveRequestedFormat, FORMAT_KEYS } from '../public/shared/formats.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// --- Utilitaires HTTP ----------------------------------------------------------------------

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function lang(req) {
  return /(^|,)\s*en\b/i.test(req.headers['accept-language'] || '') && !/(^|,)\s*fr\b/i.test(req.headers['accept-language'] || '')
    ? 'en'
    : 'fr';
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(req, res, error) {
  const appError = error instanceof AppError ? error : new AppError('UPSTREAM_ERROR');
  if (!(error instanceof AppError)) console.error('[unhandled]', error);
  sendJson(res, appError.status, appError.toPayload(lang(req)));
}

async function readJsonBody(req, limitBytes = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new AppError('INVALID_URL'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new AppError('INVALID_URL'));
      }
    });
    req.on('error', reject);
  });
}

// --- Limitation de débit par IP (§10.4) -----------------------------------------------------

const buckets = new Map();

// Derrière un reverse proxy, `remoteAddress` vaut toujours l'IP du proxy : sans cela, tous les
// visiteurs partageraient un unique compteur. On ne fait confiance à l'en-tête que si le
// déploiement l'annonce explicitement (§10.4).
function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(req, key, max) {
  const id = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const windowMs = config.rateLimitWindowMinutes * 60_000;
  const bucket = buckets.get(id);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) throw new AppError('RATE_LIMITED');
}

setInterval(() => {
  const now = Date.now();
  for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
}, 60_000).unref();

// --- Routes ----------------------------------------------------------------------------------

async function handleAnalyze(req, res) {
  rateLimit(req, 'analyze', config.rateLimitAnalyze);
  const body = await readJsonBody(req);
  const { videoId, hadPlaylist } = parseYoutubeUrl(body.url);
  if (!videoId) throw new AppError('INVALID_URL');

  const result = await analyze(videoId, { lang: lang(req) });
  const { streams, tags, ...publicResult } = result;
  sendJson(res, 200, { ...publicResult, hadPlaylist });
}

async function handleCreateJob(req, res) {
  rateLimit(req, 'jobs', config.rateLimitJobs);
  const body = await readJsonBody(req);

  if (!isValidVideoId(body.videoId)) throw new AppError('INVALID_VIDEO_ID');
  const requested = body.outputFormat || config.defaultOutputFormat;
  if (!FORMAT_KEYS.includes(requested)) throw new AppError('INVALID_OUTPUT_FORMAT');

  const rawName = String(body.filename ?? '').trim();
  if (!rawName) throw new AppError('INVALID_FILENAME');

  const analysis = await analyze(body.videoId, { lang: lang(req) });

  // Le client n'est pas source de vérité : on revalide la disponibilité du format (§11.2).
  const resolvedFormat = resolveRequestedFormat(requested, analysis.formats);
  if (!resolvedFormat) throw new AppError('FORMAT_UNAVAILABLE');

  const formatEntry = analysis.formats.find((f) => f.key === requested);
  const extension = resolvedFormat === 'm4a-copy' ? '.m4a' : '.mp3';
  const itag = resolvedFormat === 'm4a-copy' ? analysis.streams.bestAac?.itag : analysis.streams.best?.itag;

  const estimated = formatEntry?.estimatedSizeBytes || 0;
  if (!(await hasFreeSpace(estimated))) throw new AppError('STORAGE_FULL');

  const filename = `${sanitizeFilename(rawName, analysis.videoId)}${extension}`;

  const job = createJob({
    videoId: analysis.videoId,
    filename,
    extension,
    outputFormat: requested,
    resolvedFormat,
    itag,
    durationSeconds: analysis.durationSeconds,
    bitrateKbps: formatEntry?.bitrateKbps ?? null,
    tags: analysis.tags,
    embedCover: body.embedCover !== false,
  });

  sendJson(res, 202, jobView(job));
}

function handleJobEvents(req, res, job) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...SECURITY_HEADERS,
  });

  const send = (event, payload) => {
    if (event === 'close') {
      res.end();
      return;
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  send('progress', jobView(job));

  const unsubscribe = subscribe(job, send);
  const keepalive = setInterval(() => res.write(':keepalive\n\n'), 15_000);

  req.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
  });

  // Un job déjà terminal : on informe puis on ferme immédiatement.
  if (['ready', 'failed', 'cancelled', 'expired'].includes(job.state)) {
    send(job.state === 'ready' ? 'ready' : job.state === 'failed' ? 'error' : 'cancelled', jobView(job));
    clearInterval(keepalive);
    unsubscribe();
    res.end();
  }
}

function contentDisposition(filename) {
  const fallback = asciiFallback(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function handleDownload(req, res, job, url) {
  const token = url.searchParams.get('t') || '';
  const expected = Buffer.from(job.token);
  const provided = Buffer.from(token);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw new AppError('INVALID_TOKEN');
  }
  if (job.state === 'expired') throw new AppError('FILE_EXPIRED');
  if (job.state !== 'ready') throw new AppError('JOB_NOT_READY');

  const file = jobFilePath(job.jobId, job.extension);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) throw new AppError('FILE_EXPIRED');

  const headers = {
    'Content-Type': job.extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg',
    'Content-Disposition': contentDisposition(job.filename),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    ...SECURITY_HEADERS,
  };

  // Reprise de téléchargement (F-45).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    if (Number.isNaN(start) || start >= stat.size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, ...SECURITY_HEADERS });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  const stream = fs.createReadStream(file);
  stream.pipe(res);

  // Téléchargement unique : dès que le corps est parti en entier, le fichier disparaît du disque.
  res.on('close', () => {
    if (res.writableFinished) void consumeJob(job.jobId);
    else stream.destroy();
  });
}

// Proxy de miniature (F-16) : aucune requête du navigateur vers un domaine tiers.
const THUMB_HOSTS = ['i.ytimg.com', 'img.youtube.com'];
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

async function handleThumb(res, videoId) {
  if (!isValidVideoId(videoId)) throw new AppError('INVALID_VIDEO_ID');

  for (const host of THUMB_HOSTS) {
    for (const name of ['maxresdefault', 'hqdefault', 'mqdefault']) {
      const response = await fetch(`https://${host}/vi/${videoId}/${name}.jpg`).catch(() => null);
      if (!response || !response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1024 || buffer.length > MAX_THUMB_BYTES) continue;
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=3600',
        ...SECURITY_HEADERS,
      });
      res.end(buffer);
      return;
    }
  }
  throw new AppError('NOT_FOUND');
}

// --- Fichiers statiques -----------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(publicDir, relative);
  // Anti-traversée : la cible doit rester sous public/.
  if (!target.startsWith(publicDir + path.sep) && target !== path.join(publicDir, 'index.html')) {
    throw new AppError('NOT_FOUND');
  }

  const stat = await fsp.stat(target).catch(() => null);
  if (!stat || !stat.isFile()) throw new AppError('NOT_FOUND');

  const type = MIME[path.extname(target)] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    // `no-cache` = revalidation systématique : pas d'asset périmé après mise à jour.
    'Cache-Control': 'no-cache',
    ETag: `"${stat.size}-${Math.round(stat.mtimeMs)}"`,
    ...SECURITY_HEADERS,
  });
  fs.createReadStream(target).pipe(res);
}

// --- Routage --------------------------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/analyze' && method === 'POST') return handleAnalyze(req, res);
  if (pathname === '/api/jobs' && method === 'POST') return handleCreateJob(req, res);

  const jobMatch = /^\/api\/jobs\/([A-Za-z0-9_]+)(\/events|\/file)?$/.exec(pathname);
  if (jobMatch) {
    const job = getJob(jobMatch[1]);
    if (!job) throw new AppError('JOB_NOT_FOUND');
    if (jobMatch[2] === '/events' && method === 'GET') return handleJobEvents(req, res, job);
    if (jobMatch[2] === '/file' && method === 'GET') return handleDownload(req, res, job, url);
    if (!jobMatch[2] && method === 'GET') return sendJson(res, 200, jobView(job));
    if (!jobMatch[2] && method === 'DELETE') {
      const cancelled = await cancelJob(job.jobId);
      return sendJson(res, 200, jobView(cancelled));
    }
  }

  const thumbMatch = /^\/api\/thumb\/([A-Za-z0-9_-]{11})$/.exec(pathname);
  if (thumbMatch && method === 'GET') return handleThumb(res, thumbMatch[1]);

  if (pathname === '/api/config' && method === 'GET') {
    return sendJson(res, 200, {
      defaultOutputFormat: config.defaultOutputFormat,
      enabledOutputFormats: config.enabledOutputFormats,
      embedCoverDefault: config.embedCoverDefault,
      orphanTtlMinutes: config.orphanTtlMinutes,
      maxDurationSeconds: config.maxDurationSeconds,
    });
  }

  if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
  if (pathname === '/metrics') {
    const s = stats();
    const body = [
      `yt2mp3_jobs_total ${s.total}`,
      `yt2mp3_jobs_running ${s.running}`,
      `yt2mp3_jobs_waiting ${s.waiting}`,
      ...Object.entries(s.counts).map(([state, count]) => `yt2mp3_jobs_state{state="${state}"} ${count}`),
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    return res.end(`${body}\n`);
  }

  if (method === 'GET') return serveStatic(req, res, pathname);
  throw new AppError('NOT_FOUND');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendError(req, res, error);
  });
});

// --- Démarrage ---------------------------------------------------------------------------------

async function main() {
  await initStorage();
  startReaper();

  const [hasYtdlp, hasFfmpeg] = await Promise.all([
    checkBinary(config.ytdlpPath),
    checkBinary(config.ffmpegPath, ['-version']),
  ]);
  if (!hasYtdlp) console.warn(`⚠️  yt-dlp introuvable (${config.ytdlpPath}) — les conversions échoueront.`);
  if (!hasFfmpeg) console.warn(`⚠️  ffmpeg introuvable (${config.ffmpegPath}) — les conversions échoueront.`);

  server.listen(config.port, config.host, () => {
    console.log(`YT2MP3 écoute sur http://localhost:${config.port}`);
    console.log(
      `Fichiers : ${config.storagePath} — supprimés dès le téléchargement ` +
        `(purge des orphelins après ${config.orphanTtlMinutes} min)`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
