// Analyse : yt-dlp --dump-single-json, sans télécharger le moindre octet de média (F-11).
import fs from 'node:fs/promises';
import { config } from './config.js';
import { AppError, mapYtdlpError } from './errors.js';
import { run } from './proc.js';
import { detectArtistTrack } from '../public/shared/artist-detect.js';
import { buildFormats } from '../public/shared/formats.js';
import { buildPresets, defaultPresetKey } from '../public/shared/filename.js';

const cache = new Map(); // videoId -> { expiresAt, info }

// --- Liste de blocage rechargeable à chaud (DEP-2) --------------------------------------

let blocklist = new Set();
let blocklistMtime = 0;

async function refreshBlocklist() {
  if (!config.blocklistPath) return;
  const stat = await fs.stat(config.blocklistPath).catch(() => null);
  if (!stat || stat.mtimeMs === blocklistMtime) return;
  const raw = await fs.readFile(config.blocklistPath, 'utf8').catch(() => '');
  blocklist = new Set(
    raw
      .split('\n')
      .map((line) => line.split('#')[0].trim())
      .filter(Boolean),
  );
  blocklistMtime = stat.mtimeMs;
}

// --- Appel yt-dlp -----------------------------------------------------------------------

function ytdlpBaseArgs() {
  const args = ['--no-playlist', '--no-warnings', '--no-progress'];
  if (config.ytdlpCookiesPath) args.push('--cookies', config.ytdlpCookiesPath);
  return args;
}

async function dumpJson(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  let stdout = '';
  try {
    await run(config.ytdlpPath, [...ytdlpBaseArgs(), '--dump-single-json', '--skip-download', '--', url], {
      onStdout: (line) => {
        stdout += line;
      },
      timeoutMs: 60_000,
    });
  } catch (error) {
    if (error.exitCode === null) throw new AppError('TOOL_MISSING');
    if (error.timedOut) throw new AppError('UPSTREAM_ERROR');
    throw new AppError(mapYtdlpError(error.stderr || ''));
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new AppError('UPSTREAM_ERROR');
  }
}

// --- Normalisation ----------------------------------------------------------------------

function audioStreams(info) {
  return (info.formats || [])
    .filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    .map((f) => ({
      itag: String(f.format_id),
      codec: f.acodec,
      ext: f.ext,
      bitrateKbps: Number(f.abr || f.tbr || 0),
      sampleRateHz: f.asr ?? null,
      channels: f.audio_channels ?? null,
    }))
    .filter((f) => f.bitrateKbps > 0);
}

const isAac = (codec = '') => /^(mp4a|aac)/i.test(codec);

function pickBest(streams, predicate = () => true) {
  return streams.filter(predicate).sort((a, b) => b.bitrateKbps - a.bitrateKbps)[0] || null;
}

function formatDuration(seconds) {
  const total = Math.round(seconds || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function uploadDate(info) {
  const raw = info.upload_date || info.release_date;
  if (!raw || raw.length !== 8) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** Analyse complète, avec cache mémoire (F-12). */
export async function analyze(videoId, { lang = 'fr' } = {}) {
  await refreshBlocklist();

  const cached = cache.get(videoId);
  const info = cached && cached.expiresAt > Date.now() ? cached.info : await dumpJson(videoId);
  if (!cached || cached.expiresAt <= Date.now()) {
    cache.set(videoId, { info, expiresAt: Date.now() + config.metadataCacheTtlMinutes * 60_000 });
  }

  const channelId = info.channel_id || info.uploader_id || null;
  if (blocklist.has(videoId) || (channelId && blocklist.has(channelId))) {
    throw new AppError('VIDEO_BLOCKED');
  }

  if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
    throw new AppError('VIDEO_IS_LIVE');
  }
  if ((info.age_limit || 0) >= 18) throw new AppError('VIDEO_AGE_RESTRICTED');

  const durationSeconds = Math.round(info.duration || 0);
  if (!durationSeconds) throw new AppError('NO_AUDIO_STREAM');
  if (durationSeconds > config.maxDurationSeconds) {
    throw new AppError('VIDEO_TOO_LONG', {
      details: { durationSeconds, maxDurationSeconds: config.maxDurationSeconds },
      message:
        lang === 'en'
          ? `This video runs ${formatDuration(durationSeconds)}. The limit is ${formatDuration(config.maxDurationSeconds)}.`
          : `Cette vidéo dure ${formatDuration(durationSeconds)}. La limite est de ${formatDuration(config.maxDurationSeconds)}.`,
    });
  }

  const streams = audioStreams(info);
  const best = pickBest(streams);
  const bestAac = pickBest(streams, (s) => isAac(s.codec));
  if (!best) throw new AppError('NO_AUDIO_STREAM');

  const title = info.title || '';
  const channel = info.channel || info.uploader || '';
  const year = info.release_year || (uploadDate(info) ? Number(uploadDate(info).slice(0, 4)) : null);

  const detection = detectArtistTrack({ title, channel, artist: info.artist, track: info.track });

  const namingMeta = {
    title,
    channel,
    year,
    videoId,
    artistGuess: detection.artist,
    titleGuess: detection.track,
    confidence: detection.confidence,
  };

  const formats = buildFormats({
    best,
    bestAac,
    durationSeconds,
    targetBitrateKbps: config.targetBitrateKbps,
    enabled: config.enabledOutputFormats,
  });

  return {
    videoId,
    title,
    channel,
    channelId,
    durationSeconds,
    durationLabel: formatDuration(durationSeconds),
    uploadDate: uploadDate(info),
    year,
    thumbnailUrl: `/api/thumb/${videoId}`,
    source: {
      codec: best.codec,
      bitrateKbps: Math.round(best.bitrateKbps),
      sampleRateHz: best.sampleRateHz,
      channels: best.channels,
    },
    streams: { best, bestAac },
    formats,
    defaultFormat: config.defaultOutputFormat,
    embedCoverDefault: config.embedCoverDefault,
    tags: {
      title: detection.track || title,
      artist: detection.artist || channel,
      album: info.album || '',
      year: year ? String(year) : '',
      genre: info.genre || '',
    },
    naming: {
      artistGuess: detection.artist,
      titleGuess: detection.track,
      confidence: detection.confidence,
      // Les libellés sont localisés côté client à partir de la clé (shared/filename.js).
      presets: buildPresets(namingMeta).map(({ key, value }) => ({ key, value })),
      defaultPreset: defaultPresetKey(namingMeta),
    },
  };
}
