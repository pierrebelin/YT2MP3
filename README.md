# YT2MP3

Convertisseur YouTube → MP3 / M4A pensé pour la cabine DJ : fichiers importables dans
rekordbox et lisibles sur CDJ. Sans publicité, sans compte, sans traceur.

Implémentation de [SPEC.md](SPEC.md).

## Choix technique

- **Front** : HTML / CSS / JavaScript vanilla. Aucun framework, aucun build, aucun bundler.
- **Serveur** : Node.js natif (`node:http`). **Zéro dépendance npm** — pas de `npm install`.
- **Outils externes** : `yt-dlp` (extraction du flux) et `ffmpeg` (encodage, tags, pochette).

Pourquoi un serveur alors que le reste est front-only : le navigateur ne peut pas récupérer
l'audio YouTube. Les flux `googlevideo.com` n'envoient aucun en-tête CORS, l'URL du flux
demande un déchiffrement de signature effectué par le player YouTube, YouTube exige un jeton
anti-bot, et aucun navigateur n'embarque d'encodeur MP3. Le serveur sert d'intermédiaire —
il ne fait rien d'autre.

## Prérequis

```bash
brew install yt-dlp ffmpeg
```

(sur Debian/Ubuntu : `apt install ffmpeg` et `pipx install yt-dlp`)

Node.js 20 ou plus récent.

## Lancer

```bash
node server/index.js
```

Puis <http://localhost:3000>.

## Structure

```
public/                 front vanilla, servi tel quel
├── index.html
├── styles.css          thème clair/sombre, responsive
├── app.js              logique d'interface, SSE, machine à états
├── i18n.js             dictionnaire fr/en
└── shared/             modules isomorphes front + serveur
    ├── youtube-url.js  extraction de l'ID vidéo (§5.1)
    ├── filename.js     assainissement + modèles de nom (§8)
    ├── artist-detect.js détection « Artiste - Morceau » (§8.4)
    └── formats.js      catalogue de formats + arbitrage `auto` (§6.3)

server/
├── index.js            serveur HTTP, routes, statiques, sécurité
├── config.js           variables d'environnement (§10.4)
├── errors.js           catalogue d'erreurs + mapping yt-dlp (§14)
├── metadata.js         analyse via yt-dlp --dump-single-json (§11.1)
├── converter.js        pipeline yt-dlp → ffmpeg, chemins A/B/C (§6.4–6.6)
├── queue.js            file de jobs, SSE, TTL (§12)
├── storage.js          stockage éphémère + purge
└── proc.js             lancement de processus (jamais de shell)
```

Les modules de `public/shared/` sont importés à l'identique par le front et par le serveur :
une seule implémentation du nommage et de l'arbitrage de format, donc aucune dérive entre ce
que l'interface annonce et le fichier réellement produit.

## Configuration

Tout passe par des variables d'environnement (§10.4 de la spec). Les plus utiles :

| Variable | Défaut | Rôle |
|----------|--------|------|
| `PORT` | `3000` | Port d'écoute |
| `STORAGE_PATH` | `./data/files` | Répertoire des fichiers produits |
| `FILE_TTL_MINUTES` | `30` | Durée de vie d'un fichier |
| `MAX_DURATION_SECONDS` | `5400` | Durée maximale acceptée |
| `MAX_CONCURRENT_JOBS` | `4` | Conversions simultanées |
| `AAC_PASSTHROUGH_MIN_ABR` | `192` | Seuil d'arbitrage du mode `auto` |
| `FORCE_44100` | `false` | Rééchantillonnage 44,1 kHz (matériel ancien) |
| `BLOCKLIST_PATH` | *(vide)* | Fichier d'IDs de vidéos/chaînes bloqués |
| `YTDLP_COOKIES_PATH` | *(vide)* | Cookies YouTube pour instance auto-hébergée |

Exemple :

```bash
PORT=8080 FILE_TTL_MINUTES=60 node server/index.js
```

## API

| Route | Rôle |
|-------|------|
| `POST /api/analyze` | Métadonnées + formats disponibles, sans télécharger de média |
| `POST /api/jobs` | Crée une conversion, renvoie `202` et le `jobId` |
| `GET /api/jobs/:id` | État ponctuel (repli si SSE indisponible) |
| `GET /api/jobs/:id/events` | Flux SSE de progression |
| `DELETE /api/jobs/:id` | Annule un job non terminal |
| `GET /api/jobs/:id/file?t=…` | Téléchargement (jeton, `Range` supporté) |
| `GET /api/thumb/:videoId` | Proxy de miniature — le navigateur ne contacte jamais Google |
| `GET /healthz`, `GET /metrics` | Sonde et métriques |

## Vie privée

Aucun cookie, aucun traceur, aucun script tiers, aucune requête sortante depuis le
navigateur. Les fichiers produits sont supprimés du disque après le TTL.

## Licence et usage

Outil destiné à récupérer des contenus dont vous détenez les droits ou dont la licence le
permet. Le respect des conditions d'utilisation de YouTube et du droit d'auteur relève de
l'utilisateur.
