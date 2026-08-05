// Assainissement (§8.5) et modèles de nom (§8.2). Module isomorphe : le client s'en sert
// pour l'aperçu, le serveur pour l'autorité (F-35).

export const MAX_FILENAME_LENGTH = 180;
export const FILENAME_WARN_LENGTH = 170;

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const FORBIDDEN_CHARS = /[/\\:*?"<>|]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

// Troncature sur une frontière de grappe de graphèmes (étape 8).
function truncateGraphemes(text, max) {
  if (text.length <= max) return text;
  if (!segmenter) return text.slice(0, max);
  let out = '';
  for (const { segment } of segmenter.segment(text)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

/**
 * Nom de fichier assaini, sans extension.
 * @param {string} name
 * @param {string} [videoId] repli « audio-{videoId} » si le résultat est vide
 */
export function sanitizeFilename(name, videoId = '') {
  let value = String(name ?? '');

  value = value.normalize('NFC');
  value = value.replace(CONTROL_CHARS, '');
  value = value.replace(FORBIDDEN_CHARS, ' ');
  value = value.replace(/\.{2,}/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  value = value.replace(/[. ]+$/g, '').trim();

  if (WINDOWS_RESERVED.test(value.split('.')[0])) value = `_${value}`;

  value = truncateGraphemes(value, MAX_FILENAME_LENGTH).trim();
  value = value.replace(/[. ]+$/g, '').trim();

  if (!value) value = videoId ? `audio-${videoId}` : 'audio';
  return value;
}

/** Translittération ASCII pour le repli `filename=` de Content-Disposition (§11.6). */
export function asciiFallback(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
}

export const PRESET_KEYS = ['title', 'title-channel', 'artist-track'];

export const PRESET_LABELS = {
  title: { fr: 'Titre seul', en: 'Title only' },
  'title-channel': { fr: 'Titre + Chaîne', en: 'Title + Channel' },
  'artist-track': { fr: 'Artiste - Morceau', en: 'Artist - Track' },
  custom: { fr: 'Personnalisé', en: 'Custom' },
};

/**
 * Construit les modèles disponibles pour une vidéo (§8.2, règle R3).
 * @param {{ title: string, channel: string, videoId: string,
 *           artistGuess: string|null, titleGuess: string|null,
 *           confidence: 'high'|'medium'|null }} meta
 * @param {'fr'|'en'} [lang]
 */
export function buildPresets(meta, lang = 'fr') {
  const { title = '', channel = '', videoId = '' } = meta;
  const presets = [];
  const push = (key, value) => {
    presets.push({ key, label: PRESET_LABELS[key][lang] || PRESET_LABELS[key].fr, value: sanitizeFilename(value, videoId) });
  };

  push('title', title);
  push('title-channel', `${title} - ${channel}`);
  if (meta.confidence && meta.artistGuess && meta.titleGuess) {
    push('artist-track', `${meta.artistGuess} - ${meta.titleGuess}`); // R3
  }

  return presets;
}

/** Modèle présélectionné (§8.2 R1). */
export function defaultPresetKey(meta) {
  return meta.confidence === 'high' ? 'artist-track' : 'title-channel';
}
