// Pipeline de conversion : yt-dlp (téléchargement) puis ffmpeg (encodage, tags, pochette).
// Chemins A / B / C de §6.4 à §6.6.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { AppError, mapYtdlpError } from './errors.js';
import { run } from './proc.js';
import { jobFilePath, jobTmpDir } from './storage.js';

const PHASE_RANGES = {
  downloading: [0, 60],
  encoding: [60, 95],
  tagging: [95, 100],
};

function scaled(phase, ratio) {
  const [from, to] = PHASE_RANGES[phase];
  return Math.round(from + Math.max(0, Math.min(1, ratio)) * (to - from));
}

function ytdlpBaseArgs() {
  const args = ['--no-playlist', '--no-warnings'];
  if (config.ytdlpCookiesPath) args.push('--cookies', config.ytdlpCookiesPath);
  return args;
}

// --- Étape 1 : téléchargement du flux audio ---------------------------------------------

async function downloadStream({ videoId, itag, dir, signal, onSpawn, onProgress }) {
  const output = path.join(dir, 'source.%(ext)s');
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const selector = itag ? `${itag}/bestaudio` : 'bestaudio';

  try {
    await run(
      config.ytdlpPath,
      [
        ...ytdlpBaseArgs(),
        '-f', selector,
        '-o', output,
        '--newline',
        '--progress-template',
        'download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
        '--', url,
      ],
      {
        signal,
        onSpawn,
        timeoutMs: config.timeouts.download,
        onStdout: (line) => {
          if (!line.startsWith('PROGRESS ')) return;
          const [, done, total] = line.split(' ');
          const doneBytes = Number(done);
          const totalBytes = Number(total);
          if (Number.isFinite(doneBytes) && totalBytes > 0) {
            onProgress(scaled('downloading', doneBytes / totalBytes));
          }
        },
      },
    );
  } catch (error) {
    if (error.aborted) throw error;
    if (error.timedOut) throw new AppError('DOWNLOAD_TIMEOUT');
    if (error.exitCode === null) throw new AppError('TOOL_MISSING');
    const code = mapYtdlpError(error.stderr || '');
    throw new AppError(code === 'UPSTREAM_ERROR' ? 'DOWNLOAD_FAILED' : code);
  }

  const entries = await fs.readdir(dir);
  const file = entries.find((name) => name.startsWith('source.'));
  if (!file) throw new AppError('DOWNLOAD_FAILED');
  return path.join(dir, file);
}

// --- Étape 2 : encodage ou recopie -------------------------------------------------------

function metadataArgs(tags, videoId, container) {
  const args = [];
  const push = (key, value) => {
    if (value) args.push('-metadata', `${key}=${value}`);
  };
  push('title', tags.title);
  push('artist', tags.artist);
  push('album', tags.album);
  push('date', tags.year);
  push('genre', tags.genre);
  push('comment', `Source: https://youtu.be/${videoId}`);
  // ID3 TENC ↔ atome MP4 ©too : ffmpeg n'expose pas la même clé selon le conteneur.
  if (container === 'm4a') push('encoder', 'YT2MP3');
  else push('encoded_by', 'YT2MP3');
  return args;
}

async function encode({ input, output, format, tags, videoId, durationSeconds, signal, onSpawn, onProgress }) {
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-vn', '-map_metadata', '-1'];
  const container = format === 'm4a-copy' ? 'm4a' : 'mp3';

  if (format === 'm4a-copy') {
    args.push('-c:a', 'copy', '-movflags', '+faststart');
  } else {
    args.push('-c:a', 'libmp3lame');
    if (format === 'mp3-v0') args.push('-q:a', '0');
    else args.push('-b:a', `${config.targetBitrateKbps}k`);
    args.push('-compression_level', '0', '-write_xing', '1', '-id3v2_version', '3');
    // Option matériel ancien : hors gamme CDJ uniquement (§6.5).
    if (config.force44100) args.push('-af', 'aresample=resampler=soxr:precision=28', '-ar', '44100');
  }

  args.push(...metadataArgs(tags, videoId, container), '-progress', 'pipe:1', '-nostats', output);

  try {
    await run(config.ffmpegPath, args, {
      signal,
      onSpawn,
      timeoutMs: config.timeouts.encoding,
      onStdout: (line) => {
        if (!line.startsWith('out_time_us=') || !durationSeconds) return;
        const micros = Number(line.slice('out_time_us='.length));
        if (Number.isFinite(micros)) onProgress(scaled('encoding', micros / 1e6 / durationSeconds));
      },
    });
  } catch (error) {
    if (error.aborted) throw error;
    if (error.timedOut) throw new AppError('ENCODING_TIMEOUT');
    if (error.exitCode === null) throw new AppError('TOOL_MISSING');
    throw new AppError('CONVERSION_FAILED');
  }
}

// --- Étape 3 : pochette (§9.2) -----------------------------------------------------------

async function fetchThumbnail(videoId, dir) {
  for (const name of ['maxresdefault', 'hqdefault']) {
    const response = await fetch(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`).catch(() => null);
    if (!response || !response.ok) continue;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) continue;
    const file = path.join(dir, 'thumb.jpg');
    await fs.writeFile(file, buffer);
    return file;
  }
  return null;
}

async function makeCover(videoId, dir, signal) {
  const thumb = await fetchThumbnail(videoId, dir);
  if (!thumb) return null;
  const cover = path.join(dir, 'cover.jpg');
  try {
    // Recadrage carré centré puis 600×600, qualité JPEG élevée.
    await run(
      config.ffmpegPath,
      ['-hide_banner', '-nostdin', '-y', '-i', thumb, '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=600:600", '-q:v', '3', cover],
      { signal, timeoutMs: 30_000 },
    );
    return cover;
  } catch {
    return null;
  }
}

async function attachCover({ input, output, cover, container, signal, onSpawn }) {
  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-i', input,
    '-i', cover,
    '-map', '0:a', '-map', '1:v',
    '-c', 'copy',
    '-disposition:v', 'attached_pic',
    '-metadata:s:v', 'title=Album cover',
    '-metadata:s:v', 'comment=Cover (front)',
  ];
  if (container === 'mp3') args.push('-id3v2_version', '3');
  else args.push('-movflags', '+faststart');
  args.push(output);

  await run(config.ffmpegPath, args, { signal, onSpawn, timeoutMs: config.timeouts.tagging });
}

// --- Pipeline ----------------------------------------------------------------------------

/**
 * @param {{ jobId: string, videoId: string, resolvedFormat: string, extension: string,
 *           itag: string|null, durationSeconds: number, tags: object, embedCover: boolean }} job
 * @param {{ signal: AbortSignal, onPhase: (phase: string) => void,
 *           onProgress: (value: number) => void, onSpawn: (child) => void }} hooks
 */
export async function convert(job, hooks) {
  const dir = jobTmpDir(job.jobId);
  await fs.mkdir(dir, { recursive: true });

  try {
    hooks.onPhase('downloading');
    const source = await downloadStream({
      videoId: job.videoId,
      itag: job.itag,
      dir,
      signal: hooks.signal,
      onSpawn: hooks.onSpawn,
      onProgress: hooks.onProgress,
    });

    hooks.onPhase('encoding');
    hooks.onProgress(PHASE_RANGES.encoding[0]);
    const container = job.extension === '.m4a' ? 'm4a' : 'mp3';
    const encoded = path.join(dir, `encoded${job.extension}`);
    await encode({
      input: source,
      output: encoded,
      format: job.resolvedFormat,
      tags: job.tags,
      videoId: job.videoId,
      durationSeconds: job.durationSeconds,
      signal: hooks.signal,
      onSpawn: hooks.onSpawn,
      onProgress: hooks.onProgress,
    });

    hooks.onPhase('tagging');
    hooks.onProgress(PHASE_RANGES.tagging[0]);
    const final = jobFilePath(job.jobId, job.extension);
    let produced = encoded;

    if (job.embedCover) {
      const cover = await makeCover(job.videoId, dir, hooks.signal);
      if (cover) {
        const tagged = path.join(dir, `tagged${job.extension}`);
        try {
          await attachCover({ input: encoded, output: tagged, cover, container, signal: hooks.signal, onSpawn: hooks.onSpawn });
          produced = tagged;
        } catch (error) {
          if (error.aborted) throw error;
          // Une pochette manquante ne doit pas faire échouer une conversion réussie.
        }
      }
    }

    await fs.rename(produced, final).catch(async () => {
      await fs.copyFile(produced, final);
    });
    const stat = await fs.stat(final);
    hooks.onProgress(100);
    return { path: final, sizeBytes: stat.size };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
