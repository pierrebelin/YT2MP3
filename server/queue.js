// File de jobs en mémoire (§10.2) et machine à états (§12).
import crypto from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';
import { convert } from './converter.js';
import { removeJobFiles } from './storage.js';

const jobs = new Map(); // jobId -> job
const waiting = []; // jobIds en attente d'un créneau
let running = 0;

const TERMINAL = new Set(['ready', 'failed', 'cancelled', 'expired']);

function newJobId() {
  return `j_${crypto.randomBytes(12).toString('hex')}`;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function queuePosition(jobId) {
  const index = waiting.indexOf(jobId);
  return index === -1 ? null : index + 1;
}

/** Vue publique d'un job (§11.3). */
export function jobView(job) {
  const position = queuePosition(job.jobId);
  return {
    jobId: job.jobId,
    state: job.state,
    phase: TERMINAL.has(job.state) ? null : job.phase,
    progress: job.progress,
    queuePosition: position,
    queueLength: waiting.length,
    filename: job.filename,
    outputFormat: job.outputFormat,
    resolvedFormat: job.resolvedFormat,
    sizeBytes: job.sizeBytes,
    bitrateKbps: job.bitrateKbps,
    durationSeconds: job.durationSeconds,
    downloadUrl: job.state === 'ready' ? `/api/jobs/${job.jobId}/file?t=${job.token}` : null,
    expiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
    createdAt: new Date(job.createdAt).toISOString(),
    error: job.error,
  };
}

// --- Diffusion SSE ------------------------------------------------------------------------

export function subscribe(job, send) {
  job.subscribers.add(send);
  return () => job.subscribers.delete(send);
}

function emit(job, event) {
  const payload = jobView(job);
  for (const send of job.subscribers) {
    try {
      send(event, payload);
    } catch {
      job.subscribers.delete(send);
    }
  }
}

function setState(job, state, extra = {}) {
  job.state = state;
  Object.assign(job, extra);
  const event = state === 'ready' ? 'ready' : state === 'failed' ? 'error' : state === 'cancelled' ? 'cancelled' : 'progress';
  emit(job, event);
}

// --- Création -----------------------------------------------------------------------------

export function createJob(input) {
  if (waiting.length >= config.maxQueueLength) throw new AppError('QUEUE_FULL');

  const jobId = newJobId();
  const job = {
    jobId,
    videoId: input.videoId,
    filename: input.filename,
    extension: input.extension,
    outputFormat: input.outputFormat,
    resolvedFormat: input.resolvedFormat,
    itag: input.itag,
    durationSeconds: input.durationSeconds,
    bitrateKbps: input.bitrateKbps ?? null,
    tags: input.tags,
    embedCover: input.embedCover,
    state: 'queued',
    phase: null,
    progress: 0,
    sizeBytes: null,
    token: crypto.randomBytes(24).toString('hex'),
    expiresAt: null,
    error: null,
    createdAt: Date.now(),
    subscribers: new Set(),
    abort: null,
    children: new Set(),
    lastEmit: 0,
  };

  jobs.set(jobId, job);
  waiting.push(jobId);
  schedule();
  return job;
}

// --- Ordonnancement ------------------------------------------------------------------------

function schedule() {
  while (running < config.maxConcurrentJobs && waiting.length > 0) {
    const jobId = waiting.shift();
    const job = jobs.get(jobId);
    if (!job || job.state !== 'queued') continue;
    running += 1;
    void execute(job).finally(() => {
      running -= 1;
      schedule();
    });
  }
  // Les positions d'attente ont bougé : on prévient les abonnés restants.
  for (const jobId of waiting) {
    const job = jobs.get(jobId);
    if (job) emit(job, 'progress');
  }
}

async function execute(job) {
  const controller = new AbortController();
  job.abort = controller;

  let stallTimer = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort('stalled'), config.timeouts.stall);
  };
  const totalTimer = setTimeout(() => controller.abort('timeout'), config.timeouts.total);

  const onProgress = (value) => {
    // Progression monotone croissante (§12.1).
    if (value <= job.progress) return;
    job.progress = value;
    resetStall();
    const now = Date.now();
    if (now - job.lastEmit >= 250) {
      job.lastEmit = now;
      emit(job, 'progress');
    }
  };

  try {
    resetStall();
    setState(job, 'downloading', { phase: 'downloading' });

    const result = await convert(job, {
      signal: controller.signal,
      onPhase: (phase) => {
        if (job.state === 'cancelled') return;
        setState(job, phase, { phase });
      },
      onProgress,
      onSpawn: (child) => {
        job.children.add(child);
        child.on('close', () => job.children.delete(child));
      },
    });

    if (job.state === 'cancelled') {
      await removeJobFiles(job.jobId);
      return;
    }

    setState(job, 'ready', {
      phase: null,
      progress: 100,
      sizeBytes: result.sizeBytes,
      expiresAt: Date.now() + config.fileTtlMinutes * 60_000,
    });
  } catch (error) {
    if (job.state === 'cancelled') {
      await removeJobFiles(job.jobId);
      return;
    }
    const appError =
      error instanceof AppError
        ? error
        : new AppError(controller.signal.aborted ? 'DOWNLOAD_TIMEOUT' : 'CONVERSION_FAILED');
    console.error(`[job ${job.jobId}] ${appError.code}: ${error.message}`);
    await removeJobFiles(job.jobId);
    setState(job, 'failed', {
      phase: null,
      error: { code: appError.code, message: appError.toPayload('fr').error.message, retryable: appError.retryable },
    });
  } finally {
    clearTimeout(totalTimer);
    if (stallTimer) clearTimeout(stallTimer);
    job.abort = null;
    closeSubscribers(job);
  }
}

function closeSubscribers(job) {
  if (!TERMINAL.has(job.state)) return;
  for (const send of job.subscribers) {
    try {
      send('close', null);
    } catch {
      /* le client est déjà parti */
    }
  }
  job.subscribers.clear();
}

// --- Annulation ---------------------------------------------------------------------------

export async function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new AppError('JOB_NOT_FOUND');
  if (TERMINAL.has(job.state)) throw new AppError('JOB_NOT_CANCELLABLE');

  const index = waiting.indexOf(jobId);
  if (index !== -1) waiting.splice(index, 1);

  setState(job, 'cancelled', { phase: null });
  job.abort?.abort('cancelled');
  for (const child of job.children) child.kill('SIGKILL');
  await removeJobFiles(jobId);
  closeSubscribers(job);
  return job;
}

// --- Purge TTL (§17.1) ---------------------------------------------------------------------

export function startReaper() {
  const timer = setInterval(async () => {
    const now = Date.now();
    for (const [jobId, job] of jobs) {
      if (job.state === 'ready' && job.expiresAt && job.expiresAt <= now) {
        job.state = 'expired';
        await removeJobFiles(jobId);
      }
      // Un job terminal est oublié une heure après son expiration.
      const reference = job.expiresAt || job.createdAt;
      if (TERMINAL.has(job.state) && now - reference > 60 * 60_000) {
        jobs.delete(jobId);
      }
    }
  }, 60_000);
  timer.unref();
  return timer;
}

export function stats() {
  const counts = {};
  for (const job of jobs.values()) counts[job.state] = (counts[job.state] || 0) + 1;
  return { total: jobs.size, running, waiting: waiting.length, counts };
}
