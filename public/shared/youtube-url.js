// Extraction de l'ID vidéo (§5.1). Module isomorphe : le client s'en sert pour un retour
// immédiat, le serveur pour la revalidation — le client ne fait jamais autorité (F-03).

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const PATH_PREFIXES = ['/shorts/', '/live/', '/embed/', '/v/'];

/**
 * @returns {{ videoId: string|null, hadPlaylist: boolean }}
 */
export function parseYoutubeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return { videoId: null, hadPlaylist: false };

  // F-02 : identifiant nu accepté.
  if (VIDEO_ID.test(raw)) return { videoId: raw, hadPlaylist: false };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { videoId: null, hadPlaylist: false };
  }

  if (!HOSTS.has(url.hostname.toLowerCase())) return { videoId: null, hadPlaylist: false };

  const hadPlaylist = url.searchParams.has('list');
  let candidate = null;

  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    candidate = url.pathname.slice(1).split('/')[0];
  } else if (url.pathname === '/watch') {
    candidate = url.searchParams.get('v');
  } else {
    const prefix = PATH_PREFIXES.find((p) => url.pathname.startsWith(p));
    if (prefix) candidate = url.pathname.slice(prefix.length).split('/')[0];
  }

  if (candidate && VIDEO_ID.test(candidate)) return { videoId: candidate, hadPlaylist };
  return { videoId: null, hadPlaylist };
}

export function isValidVideoId(id) {
  return VIDEO_ID.test(String(id || ''));
}
