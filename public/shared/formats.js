// Catalogue des formats de sortie (§6.3).
// Module isomorphe : le front affiche, le serveur décide — même code, pas de dérive.

export const FORMAT_DEFS = [
  {
    key: 'mp3-320',
    extension: '.mp3',
    container: 'mp3',
    label: { fr: 'MP3 320 kbps', en: 'MP3 320 kbps' },
    description: {
      fr: "Le format le plus universel. Lisible sur absolument tout le matériel, y compris ancien. Réencodage systématique, fichiers plus lourds.",
      en: 'The most universal format. Readable on absolutely any gear, including old ones. Always re-encoded, heavier files.',
    },
  },
  {
    key: 'm4a-copy',
    extension: '.m4a',
    container: 'm4a',
    label: { fr: 'M4A — copie sans réencodage', en: 'M4A — stream copy' },
    description: {
      fr: "Le flux YouTube est recopié tel quel, sans aucune perte ajoutée, en fichiers 2 à 3× plus légers. Lisible sur rekordbox, CDJ-2000NXS2 et CDJ-3000. Indisponible si YouTube ne propose pas d'AAC pour cette vidéo.",
      en: 'The YouTube stream is copied as-is, with no added loss, in files 2 to 3× lighter. Readable on rekordbox, CDJ-2000NXS2 and CDJ-3000. Unavailable when YouTube offers no AAC for this video.',
    },
  },
  {
    key: 'mp3-v0',
    extension: '.mp3',
    container: 'mp3',
    label: { fr: 'MP3 V0 (VBR, ~245 kbps)', en: 'MP3 V0 (VBR, ~245 kbps)' },
    description: {
      fr: "Qualité indiscernable du 320 kbps pour 25 % de place en moins. Débit variable : à éviter si votre matériel est ancien.",
      en: 'Quality indistinguishable from 320 kbps for 25 % less space. Variable bitrate: avoid on older gear.',
    },
  },
];

export const FORMAT_KEYS = FORMAT_DEFS.map((f) => f.key);

export const UNAVAILABLE_REASONS = {
  NO_AAC_STREAM: {
    fr: "Indisponible : YouTube ne propose pas d'AAC pour cette vidéo.",
    en: 'Unavailable: YouTube offers no AAC for this video.',
  },
  AAC_BELOW_THRESHOLD: {
    fr: "Indisponible : le flux AAC disponible est de trop faible débit.",
    en: 'Unavailable: the available AAC stream has too low a bitrate.',
  },
};

const V0_BITRATE_KBPS = 245;

function estimateSize(bitrateKbps, durationSeconds) {
  if (!bitrateKbps || !durationSeconds) return null;
  return Math.round((bitrateKbps * 1000 * durationSeconds) / 8);
}

export function codecLabel(codec = '') {
  const c = String(codec).toLowerCase();
  if (c.startsWith('opus')) return 'Opus';
  if (c.startsWith('mp4a') || c.startsWith('aac')) return 'AAC';
  if (c.startsWith('vorbis')) return 'Vorbis';
  if (c.startsWith('mp3')) return 'MP3';
  return codec || 'inconnu';
}

/**
 * Construit la liste `formats` de /api/analyze (§11.1).
 * @param {{ best: object|null, bestAac: object|null, durationSeconds: number,
 *           targetBitrateKbps: number, enabled: string[] }} input
 */
export function buildFormats({ best, bestAac, durationSeconds, targetBitrateKbps = 320, enabled = FORMAT_KEYS }) {
  const aacAvailable = Boolean(bestAac);

  return FORMAT_DEFS.filter((def) => enabled.includes(def.key)).map((def) => {
    const base = {
      key: def.key,
      label: def.label,
      description: def.description,
      container: def.container,
      extension: def.extension,
    };

    if (def.key === 'm4a-copy') {
      if (!aacAvailable) {
        return { ...base, available: false, unavailableReason: 'NO_AAC_STREAM' };
      }
      return {
        ...base,
        available: true,
        bitrateKbps: Math.round(bestAac.bitrateKbps),
        sampleRateHz: bestAac.sampleRateHz,
        channels: bestAac.channels,
        reencoded: false,
        estimatedSizeBytes: estimateSize(bestAac.bitrateKbps, durationSeconds),
      };
    }

    const bitrate = def.key === 'mp3-320' ? targetBitrateKbps : V0_BITRATE_KBPS;
    return {
      ...base,
      available: Boolean(best),
      unavailableReason: best ? undefined : 'NO_AAC_STREAM',
      bitrateKbps: bitrate,
      sampleRateHz: best?.sampleRateHz ?? null,
      channels: best?.channels ?? null,
      reencoded: true,
      estimatedSizeBytes: estimateSize(bitrate, durationSeconds),
    };
  });
}

/** Résout la clé demandée en format concret, ou null si indisponible (§11.2). */
export function resolveRequestedFormat(key, formats) {
  const entry = formats.find((f) => f.key === key);
  if (!entry || !entry.available) return null;
  return entry.key;
}
