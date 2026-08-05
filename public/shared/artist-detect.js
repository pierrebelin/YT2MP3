// Détection « Artiste - Morceau » (§8.4).

const SEPARATORS = [' - ', ' – ', ' — ', ' | ', ' ~ '];

// Qualificatifs purement décoratifs : supprimés du titre déduit.
const NOISE_QUALIFIERS = [
  'official video', 'official music video', 'official audio', 'official lyric video',
  'lyrics', 'lyric video', 'audio', 'hd', 'hq', '4k', 'remastered', 'remaster',
  'full album', 'visualizer', 'm/v', 'mv', 'clip officiel', 'video oficial',
  'live', 'explicit', 'clean', 'free download', 'out now',
];

const CHANNEL_SUFFIXES = [' - topic', 'vevo', 'official', 'music', 'records', 'tv'];

const fold = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const NOISE_BY_LENGTH = [...NOISE_QUALIFIERS].sort((a, b) => b.length - a.length);

// Un qualificatif est du bruit si son contenu se réduit entièrement à des termes de la liste :
// « Official Video Remastered » est bruit, « Radio Edit » ne l'est pas.
function isNoise(inner) {
  let rest = fold(inner).replace(/^\d{4}$/, ''); // une année seule reste porteuse de sens
  if (!rest) return fold(inner) === '';
  if (/^prod\.?\s*by\b/.test(rest)) return true;

  let progress = true;
  while (rest && progress) {
    progress = false;
    for (const term of NOISE_BY_LENGTH) {
      if (rest === term || rest.startsWith(`${term} `)) {
        rest = rest.slice(term.length).trim();
        progress = true;
        break;
      }
    }
  }
  return rest === '';
}

// Étape 3 : ne retire que les qualificatifs sans valeur sémantique.
function stripNoiseQualifiers(text) {
  return text
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (match, inner) => (isNoise(inner) ? '' : match))
    .replace(/\s+/g, ' ')
    .trim();
}

// Étape 4 : nettoie le nom de chaîne de ses suffixes usuels.
function stripChannelSuffix(text) {
  let out = text.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of CHANNEL_SUFFIXES) {
      const folded = fold(out);
      // Le suffixe doit être un mot autonome : « MTV » ne devient pas « M ».
      const boundary = folded[folded.length - suffix.length - 1];
      const isWord = suffix.startsWith(' ') || boundary === undefined || /[\s\-–—|~]/.test(boundary);
      if (isWord && folded.endsWith(suffix) && folded.length > suffix.length) {
        out = out.slice(0, out.length - suffix.length).replace(/[\s\-–—|~]+$/, '').trim();
        changed = true;
      }
    }
  }
  return out;
}

/**
 * @param {{ title: string, channel: string, artist?: string|null, track?: string|null }} meta
 * @returns {{ artist: string|null, track: string|null, confidence: 'high'|'medium'|null }}
 */
export function detectArtistTrack(meta) {
  const title = String(meta.title || '').trim();
  const channel = String(meta.channel || '').trim();

  // 1. Métadonnées YouTube Music explicites.
  if (meta.artist && meta.track) {
    return { artist: String(meta.artist).trim(), track: String(meta.track).trim(), confidence: 'high' };
  }

  // 2. Séparateur dans le titre, première occurrence.
  let artist = null;
  let track = null;
  let confidence = null;

  let bestIndex = -1;
  let bestSeparator = null;
  for (const separator of SEPARATORS) {
    const index = title.indexOf(separator);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
      bestSeparator = separator;
    }
  }

  if (bestIndex > 0) {
    const left = title.slice(0, bestIndex).trim();
    const right = title.slice(bestIndex + bestSeparator.length).trim();
    const rejected = !left || left.length > 60 || /^\d+$/.test(left);
    if (!rejected && right) {
      artist = left;
      track = right;
      confidence = 'medium';
    }
  }

  if (artist) {
    track = stripNoiseQualifiers(track);
    artist = stripChannelSuffix(artist);
  } else if (/\s-\s*topic$/i.test(channel)) {
    // 5. Chaînes auto-générées YouTube Music.
    artist = channel.replace(/\s-\s*topic$/i, '').trim();
    track = stripNoiseQualifiers(title);
    confidence = 'high';
  }

  // 6. Normalisation finale.
  artist = artist ? artist.replace(/\s+/g, ' ').trim() : '';
  track = track ? track.replace(/\s+/g, ' ').trim() : '';

  if (!artist || !track) return { artist: null, track: null, confidence: null };
  return { artist, track, confidence };
}
