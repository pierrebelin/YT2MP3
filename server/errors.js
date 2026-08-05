// Catalogue d'erreurs unifié (§14.2) : code stable, statut HTTP, message localisé.

export const ERRORS = {
  INVALID_URL: { status: 400, retryable: false, fr: "Cette URL n'est pas une adresse de vidéo YouTube valide.", en: 'This URL is not a valid YouTube video address.' },
  INVALID_VIDEO_ID: { status: 400, retryable: false, fr: 'Identifiant de vidéo invalide.', en: 'Invalid video identifier.' },
  INVALID_FILENAME: { status: 400, retryable: false, fr: 'Le nom de fichier est vide ou invalide.', en: 'The filename is empty or invalid.' },
  INVALID_OUTPUT_FORMAT: { status: 400, retryable: false, fr: 'Format de sortie inconnu.', en: 'Unknown output format.' },
  FORMAT_UNAVAILABLE: { status: 409, retryable: false, fr: "Ce format n'est pas disponible pour cette vidéo. Nous avons resélectionné « Meilleure qualité ».", en: 'This format is unavailable for this video. We selected "Best quality" instead.' },
  VIDEO_NOT_FOUND: { status: 404, retryable: false, fr: "Cette vidéo n'existe pas ou a été supprimée.", en: 'This video does not exist or has been removed.' },
  VIDEO_PRIVATE: { status: 403, retryable: false, fr: 'Cette vidéo est privée.', en: 'This video is private.' },
  VIDEO_AGE_RESTRICTED: { status: 403, retryable: false, fr: "Cette vidéo est soumise à une restriction d'âge et ne peut pas être convertie.", en: 'This video is age-restricted and cannot be converted.' },
  VIDEO_GEO_BLOCKED: { status: 403, retryable: false, fr: "Cette vidéo n'est pas disponible depuis la zone géographique du serveur.", en: 'This video is not available from the server region.' },
  VIDEO_MEMBERS_ONLY: { status: 403, retryable: false, fr: 'Cette vidéo est réservée aux membres de la chaîne.', en: 'This video is reserved for channel members.' },
  VIDEO_BLOCKED: { status: 403, retryable: false, fr: "Cette vidéo n'est pas disponible sur ce service.", en: 'This video is not available on this service.' },
  VIDEO_IS_LIVE: { status: 409, retryable: false, fr: 'Les diffusions en direct ne peuvent pas être converties tant qu’elles ne sont pas terminées.', en: 'Live streams cannot be converted until they have ended.' },
  VIDEO_TOO_LONG: { status: 413, retryable: false, fr: 'Cette vidéo est trop longue.', en: 'This video is too long.' },
  NO_AUDIO_STREAM: { status: 422, retryable: false, fr: "Aucune piste audio exploitable n'a été trouvée pour cette vidéo.", en: 'No usable audio track was found for this video.' },
  RATE_LIMITED: { status: 429, retryable: true, fr: 'Trop de demandes. Réessayez dans quelques minutes.', en: 'Too many requests. Try again in a few minutes.' },
  QUEUE_FULL: { status: 503, retryable: true, fr: 'Le service est saturé. Réessayez dans quelques minutes.', en: 'The service is saturated. Try again in a few minutes.' },
  STORAGE_FULL: { status: 507, retryable: true, fr: "Le service manque d'espace disque. Réessayez plus tard.", en: 'The service is out of disk space. Try again later.' },
  DOWNLOAD_FAILED: { status: 502, retryable: true, fr: 'Le téléchargement du flux audio a échoué.', en: 'Downloading the audio stream failed.' },
  DOWNLOAD_TIMEOUT: { status: 504, retryable: true, fr: 'Le téléchargement a pris trop de temps.', en: 'Downloading took too long.' },
  CONVERSION_FAILED: { status: 500, retryable: true, fr: 'La conversion a échoué.', en: 'Conversion failed.' },
  ENCODING_TIMEOUT: { status: 504, retryable: true, fr: "L'encodage a pris trop de temps.", en: 'Encoding took too long.' },
  TAGGING_FAILED: { status: 500, retryable: true, fr: "L'écriture des métadonnées a échoué.", en: 'Writing metadata failed.' },
  JOB_NOT_FOUND: { status: 404, retryable: false, fr: 'Cette conversion est introuvable ou a expiré.', en: 'This conversion cannot be found or has expired.' },
  JOB_NOT_READY: { status: 409, retryable: true, fr: "Le fichier n'est pas encore prêt.", en: 'The file is not ready yet.' },
  JOB_NOT_CANCELLABLE: { status: 409, retryable: false, fr: 'Cette conversion ne peut plus être annulée.', en: 'This conversion can no longer be cancelled.' },
  FILE_EXPIRED: { status: 404, retryable: false, fr: 'Ce fichier a expiré. Relancez la conversion.', en: 'This file has expired. Start the conversion again.' },
  INVALID_TOKEN: { status: 403, retryable: false, fr: 'Lien de téléchargement invalide.', en: 'Invalid download link.' },
  UPSTREAM_ERROR: { status: 502, retryable: true, fr: 'YouTube est momentanément inaccessible. Réessayez.', en: 'YouTube is momentarily unreachable. Try again.' },
  TOOL_MISSING: { status: 500, retryable: false, fr: "Le serveur n'est pas correctement installé (yt-dlp ou ffmpeg manquant).", en: 'The server is not properly installed (yt-dlp or ffmpeg missing).' },
  NOT_FOUND: { status: 404, retryable: false, fr: 'Ressource introuvable.', en: 'Resource not found.' },
};

export class AppError extends Error {
  constructor(code, { details = null, message = null } = {}) {
    const entry = ERRORS[code] || ERRORS.UPSTREAM_ERROR;
    super(message || entry.fr);
    this.code = ERRORS[code] ? code : 'UPSTREAM_ERROR';
    this.status = entry.status;
    this.retryable = entry.retryable;
    this.details = details;
    this.overrideMessage = message;
  }

  toPayload(lang = 'fr') {
    const entry = ERRORS[this.code];
    return {
      error: {
        code: this.code,
        message: this.overrideMessage || entry[lang] || entry.fr,
        retryable: this.retryable,
        details: this.details,
      },
    };
  }
}

// Traduction des sorties d'erreur yt-dlp (§14.3). Repli systématique sur UPSTREAM_ERROR.
const YTDLP_PATTERNS = [
  [/private video/i, 'VIDEO_PRIVATE'],
  [/sign in to confirm your age|age-restricted|inappropriate for some users/i, 'VIDEO_AGE_RESTRICTED'],
  [/not available in your country|blocked it on copyright grounds|uploader has not made this video available/i, 'VIDEO_GEO_BLOCKED'],
  [/members-only|join this channel/i, 'VIDEO_MEMBERS_ONLY'],
  [/this live event will begin|is live|premieres in/i, 'VIDEO_IS_LIVE'],
  [/sign in to confirm you'?re not a bot/i, 'UPSTREAM_ERROR'],
  [/requested format is not available|no video formats found/i, 'NO_AUDIO_STREAM'],
  [/video unavailable|does not exist|has been removed|incomplete youtube id/i, 'VIDEO_NOT_FOUND'],
];

export function mapYtdlpError(stderr = '') {
  for (const [pattern, code] of YTDLP_PATTERNS) {
    if (pattern.test(stderr)) return code;
  }
  return 'UPSTREAM_ERROR';
}
