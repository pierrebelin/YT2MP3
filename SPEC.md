# YT2MP3 — Spécification fonctionnelle et technique

> **Statut** : v1.0 — spécification de référence
> **Objectif du document** : décrire de façon exhaustive le produit à construire, de sorte
> qu'aucune question fonctionnelle, technique ou d'expérience utilisateur ne reste ouverte
> au moment de passer à l'implémentation.

---

## Table des matières

1. [Vision et périmètre](#1-vision-et-périmètre)
2. [Contexte de déploiement](#2-contexte-de-déploiement)
3. [Personas et cas d'usage](#3-personas-et-cas-dusage)
4. [Parcours utilisateur de référence](#4-parcours-utilisateur-de-référence)
5. [Exigences fonctionnelles](#5-exigences-fonctionnelles)
6. [Qualité audio : cible Pioneer / rekordbox](#6-qualité-audio--cible-pioneer--rekordbox)
7. [Absence de publicité](#7-absence-de-publicité)
8. [Nommage du fichier : sélecteur de modèle + champ libre](#8-nommage-du-fichier--sélecteur-de-modèle--champ-libre)
9. [Métadonnées et pochette](#9-métadonnées-et-pochette)
10. [Architecture technique](#10-architecture-technique)
11. [Contrats d'API](#11-contrats-dapi)
12. [Machine à états d'un job](#12-machine-à-états-dun-job)
13. [Spécification d'interface (UI/UX)](#13-spécification-dinterface-uiux)
14. [Gestion des erreurs](#14-gestion-des-erreurs)
15. [Exigences non fonctionnelles](#15-exigences-non-fonctionnelles)
16. [Sécurité](#16-sécurité)
17. [Cycle de vie des fichiers et vie privée](#17-cycle-de-vie-des-fichiers-et-vie-privée)
18. [Observabilité](#18-observabilité)
19. [Stratégie de test](#19-stratégie-de-test)
20. [Déploiement et exploitation](#20-déploiement-et-exploitation)
21. [Hors périmètre v1 et évolutions](#21-hors-périmètre-v1-et-évolutions)
22. [Critères d'acceptation](#22-critères-dacceptation)
23. [Glossaire](#23-glossaire)
24. [Décisions actées (ADR condensés)](#24-décisions-actées-adr-condensés)

---

## 1. Vision et périmètre

### 1.1 Énoncé produit

**YT2MP3** est une application web mono-page permettant à un utilisateur de coller l'URL
d'une vidéo YouTube, de récupérer la piste audio, de la convertir au meilleur format
exploitable en cabine DJ — importable dans rekordbox et lisible sur CDJ — de choisir le nom
du fichier à partir du titre de la vidéo et du nom de la chaîne, puis de le télécharger.

### 1.2 Principes directeurs

| # | Principe | Conséquence concrète |
|---|----------|----------------------|
| P1 | **Meilleure qualité lisible par défaut** | Sélection systématique du meilleur flux audio source, puis production du meilleur format que rekordbox et les CDJ savent lire : copie sans réencodage quand c'est possible, MP3 320 kbps sinon. Fréquence et canaux de la source conservés. |
| P2 | **Zéro publicité** | Aucune régie, aucun tracker tiers, aucun script externe, aucune redirection, aucun interstitiel, aucun faux bouton. |
| P3 | **Zéro friction** | Pas de compte, pas d'inscription, pas de captcha en usage nominal. Un champ, un bouton. |
| P4 | **Contrôle du nommage** | L'utilisateur choisit un modèle de nom parmi plusieurs propositions, et peut toujours l'éditer librement. |
| P5 | **Éphémère par défaut** | Les fichiers produits sont supprimés du serveur après un TTL court. Aucune conservation d'historique nominatif. |
| P6 | **Honnêteté technique** | L'interface indique la qualité réelle de la source, sans prétendre à une qualité que le média d'origine ne possède pas. |

### 1.3 Périmètre v1

**Inclus :**

- URL d'une vidéo YouTube unique (formats `youtube.com/watch`, `youtu.be`, `youtube.com/shorts`, `music.youtube.com`, `youtube.com/live` de VOD terminée, avec ou sans paramètres).
- Extraction des métadonnées (titre, chaîne, durée, miniature, date, identifiant).
- Conversion vers un format compatible rekordbox / CDJ, au choix de l'utilisateur (§6.3) :
  copie AAC sans réencodage, MP3 320 kbps CBR, ou MP3 V0.
- Composition du nom de fichier (modèles prédéfinis + champ éditable).
- Écriture des tags (ID3v2.3 ou atomes MP4) et de la pochette.
- Téléchargement direct depuis le navigateur.
- Interface responsive, français/anglais, thème clair/sombre.

**Exclus de la v1** (voir §21) : playlists, chaînes entières, lots, formats autres que MP3,
découpe/rognage, normalisation de volume, comptes utilisateurs, historique persistant.

### 1.4 Contraintes fortes

- **C1** — Le MP3 produit doit être encodé à 320 kbps CBR, sauf impossibilité technique documentée (voir §6.4).
- **C2** — Aucune publicité ni tracker tiers (voir §7).
- **C3** — Le nom de fichier doit être proposé sous forme de choix mutuellement exclusifs, chacun mettant à jour une zone de texte qui reste éditable (voir §8).
- **C4** — Un téléchargement complet (vidéo de 5 min) ne doit pas dépasser 30 s de bout en bout en conditions nominales (voir §15).

---

## 2. Contexte de déploiement

### 2.1 Cible de déploiement

Le produit est conçu pour un déploiement **auto-hébergé**, mono-instance, à destination d'un
utilisateur ou d'un petit groupe. Cette hypothèse dimensionne l'ensemble des choix
techniques : file de jobs en mémoire (§10.2), quota disque unique (§17.1), limites de débit
par IP calibrées pour un usage humain (§10.4). Le passage à une exploitation multi-instance
est traité en §21 (v1.1) et n'impose aucune réécriture, l'abstraction de file étant prévue
dès la v1.

### 2.2 Exigences dérivées

| ID | Exigence |
|----|----------|
| DEP-1 | Le service fonctionne sans dépendance externe autre que YouTube lui-même : ni base de données, ni service tiers, ni compte à créer. |
| DEP-2 | Un mécanisme de blocage par liste (`BLOCKLIST_PATH`, identifiants de vidéo ou de chaîne) est disponible pour l'opérateur, rechargeable à chaud. |
| DEP-3 | Une page **Confidentialité** décrit les données traitées (§17.3), puisque le service applique une politique sans cookie ni traceur qu'il est utile de rendre vérifiable. |
| DEP-4 | Le service n'expose ni recherche, ni catalogue, ni bibliothèque partagée : il traite une URL fournie et rien d'autre. Cela garde la surface fonctionnelle — et donc la surface d'attaque et le coût d'exploitation — minimales. |

---

## 3. Personas et cas d'usage

### 3.1 Personas

- **Léa, créatrice de podcast.** Publie ses épisodes sur YouTube, veut récupérer la version audio de son propre épisode pour la rediffuser. Attend un fichier propre, correctement tagué, nommé `Nom du podcast - Épisode 42`.
- **Marc, musicien amateur.** Récupère ses propres captations de répétition postées en non-répertorié. Sensible à la qualité audio, veut du 320.
- **Sofia, enseignante.** Récupère une conférence sous licence CC-BY pour l'écouter hors-ligne en déplacement. Veut que ça marche en deux clics, sans pub ni piège.

### 3.2 Cas d'usage

| ID | Cas d'usage | Acteur | Priorité |
|----|-------------|--------|----------|
| UC-01 | Convertir une vidéo et la télécharger | Utilisateur | Must |
| UC-02 | Prévisualiser les métadonnées avant conversion | Utilisateur | Must |
| UC-03 | Choisir un modèle de nom de fichier | Utilisateur | Must |
| UC-04 | Éditer librement le nom de fichier | Utilisateur | Must |
| UC-05 | Suivre l'avancement de la conversion | Utilisateur | Must |
| UC-06 | Annuler une conversion en cours | Utilisateur | Should |
| UC-07 | Retélécharger un fichier encore présent (durée du TTL) | Utilisateur | Should |
| UC-08 | Recommencer avec une nouvelle URL sans recharger la page | Utilisateur | Must |
| UC-09 | Bloquer un identifiant de vidéo ou une chaîne via la liste de blocage | Opérateur | Should |
| UC-10 | Consulter les métriques d'exploitation | Opérateur | Should |

---

## 4. Parcours utilisateur de référence

### 4.1 Chemin nominal

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Étape 1 — SAISIE                                                        │
│ L'utilisateur colle une URL YouTube dans le champ unique.               │
│ Validation client immédiate (format d'URL, extraction de l'ID vidéo).   │
│ → Le bouton « Analyser » s'active.                                      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Étape 2 — ANALYSE (POST /api/analyze)                                   │
│ Le serveur récupère les métadonnées SANS télécharger le média.          │
│ Durée cible < 3 s. Affichage d'un squelette de chargement.              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Étape 3 — APERÇU + NOMMAGE                                              │
│ Carte : miniature, titre, chaîne, durée, date, qualité audio source.    │
│ Sélecteur de modèle de nom (choix exclusif) + champ texte éditable.     │
│ Sélecteur de format de sortie (4 options décrites, `auto` par défaut).  │
│ Aperçu du nom final : « Ma Chaîne - Mon Titre.mp3 »                     │
│ → Bouton « Convertir en MP3 320 kbps » (libellé suit le format choisi)  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Étape 4 — CONVERSION (POST /api/jobs → SSE /api/jobs/:id/events)        │
│ Barre de progression en 3 phases : téléchargement, encodage, tags.      │
│ Bouton « Annuler » disponible.                                          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Étape 5 — TÉLÉCHARGEMENT                                                │
│ Déclenchement automatique du téléchargement navigateur.                 │
│ Récapitulatif : nom, taille, débit, durée. Bouton « Retélécharger ».    │
│ Bouton « Convertir une autre vidéo » (réinitialise l'état).             │
│ Mention : « Ce fichier sera supprimé de nos serveurs dans 30 minutes. » │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Chemins alternatifs

| Situation | Comportement |
|-----------|--------------|
| URL invalide | Message inline sous le champ, bouton désactivé, aucun appel réseau. |
| Vidéo privée / supprimée / géo-bloquée | Erreur explicite à l'étape 2, avec le motif exact (voir §14.2). |
| Vidéo trop longue (> seuil) | Refus à l'étape 2 avec indication du seuil. |
| Direct (*live*) en cours | Refus : « Les diffusions en direct ne sont pas prises en charge tant qu'elles ne sont pas terminées. » |
| Contenu réservé aux adultes / aux membres | Refus explicite, sauf si l'option cookies de §16.6 est activée et couvre le contenu. |
| Annulation utilisateur | Job passé en `cancelled`, processus enfants tués, fichiers temporaires supprimés. |
| Échec de conversion | Erreur avec code, bouton « Réessayer » qui relance le job avec les mêmes paramètres. |
| Onglet fermé pendant la conversion | Le job continue côté serveur ; à la réouverture avec le même `jobId` en URL (`/#/job/:id`), l'état est restauré. |

---

## 5. Exigences fonctionnelles

Notation : **M** = Must, **S** = Should, **C** = Could.

### 5.1 Saisie et validation d'URL

| ID | Exigence | Prio |
|----|----------|------|
| F-01 | Le champ accepte les formes : `https://www.youtube.com/watch?v=ID`, `https://youtu.be/ID`, `https://youtube.com/shorts/ID`, `https://m.youtube.com/watch?v=ID`, `https://music.youtube.com/watch?v=ID`, `https://www.youtube.com/live/ID`, `https://www.youtube.com/embed/ID`, avec ou sans paramètres additionnels (`&t=`, `&list=`, `&si=`…). | M |
| F-02 | Un identifiant de vidéo nu (11 caractères `[A-Za-z0-9_-]`) est accepté. | S |
| F-03 | L'ID vidéo est extrait côté client pour un retour immédiat, puis **revalidé côté serveur** (le client n'est jamais la source de vérité). | M |
| F-04 | Si l'URL contient un paramètre `list=`, seule la vidéo pointée par `v=` est traitée ; un message informe que les playlists ne sont pas prises en charge en v1. | M |
| F-05 | Le collage (`Ctrl/Cmd+V`) dans le champ déclenche automatiquement l'analyse si l'URL est valide. | S |
| F-06 | Le champ propose un bouton « Coller » utilisant l'API presse-papiers quand elle est disponible et autorisée. | C |
| F-07 | Les URL non-YouTube sont rejetées côté client avec un message clair, sans appel réseau. | M |

### 5.2 Analyse

| ID | Exigence | Prio |
|----|----------|------|
| F-10 | L'analyse retourne : `videoId`, `title`, `channel`, `channelId`, `durationSeconds`, `uploadDate`, `thumbnailUrl`, `isLive`, `isAgeRestricted`, `bestAudioBitrateKbps`, `bestAudioCodec`. | M |
| F-11 | L'analyse ne télécharge **aucun** flux média. | M |
| F-12 | Les résultats d'analyse sont mis en cache serveur 15 minutes, clé = `videoId`. | S |
| F-13 | Une vidéo de durée > `MAX_DURATION_SECONDS` (défaut : 5 400 s / 1 h 30) est refusée. Le seuil est configurable. | M |
| F-14 | Une vidéo en direct (`isLive = true`) est refusée. | M |
| F-15 | Une vidéo dont l'accès requiert une authentification (âge, membres, privée) est refusée avec un code explicite, **sauf** si l'option cookies de §16.6 est activée et que la session y donne accès. | M |
| F-16 | La miniature affichée est servie via un **proxy serveur** (`/api/thumb/:videoId`), jamais directement depuis un domaine tiers, pour éviter toute fuite de requête vers Google depuis le navigateur. | M |

### 5.3 Conversion

| ID | Exigence | Prio |
|----|----------|------|
| F-20 | La conversion produit un fichier lisible par rekordbox et les CDJ visés, dans le format choisi par l'utilisateur (voir §6). | M |
| F-20a | La fréquence d'échantillonnage et le nombre de canaux de la source sont conservés ; aucun rééchantillonnage ni forçage stéréo par défaut. | M |
| F-21 | Le job expose une progression numérique 0–100 et une phase courante (`downloading`, `encoding`, `tagging`). | M |
| F-22 | Le job est annulable tant qu'il n'est pas en état terminal. | S |
| F-23 | Un job échoué est rejouable à l'identique via un bouton « Réessayer ». | S |
| F-24 | Deux demandes simultanées pour le même `videoId` **et** le même nom de fichier sont dédupliquées vers un seul job. | C |
| F-25 | Le nombre de conversions concurrentes est plafonné globalement (`MAX_CONCURRENT_JOBS`, défaut 4) ; au-delà, le job est mis en file (`queued`) et la position dans la file est affichée. | M |

### 5.4 Nommage

Voir §8 pour le détail complet. Résumé des exigences :

| ID | Exigence | Prio |
|----|----------|------|
| F-30 | Au moins 5 modèles de nom prédéfinis sont proposés. | M |
| F-31 | Les modèles sont **mutuellement exclusifs** : un seul est sélectionné à la fois. | M |
| F-32 | Sélectionner un modèle remplace immédiatement le contenu de la zone de texte. | M |
| F-33 | La zone de texte reste éditable en permanence. | M |
| F-34 | Une édition manuelle bascule la sélection sur un mode « Personnalisé ». | M |
| F-35 | Le nom est assaini (caractères interdits, longueur) avant écriture disque et avant en-tête HTTP. | M |
| F-36 | L'extension (`.mp3` ou `.m4a`) découle du format de sortie retenu, est ajoutée automatiquement et n'est pas éditable par l'utilisateur. | M |
| F-37 | Le dernier modèle choisi est mémorisé en `localStorage` et présélectionné à la visite suivante. | S |

### 5.5 Format de sortie

Voir §6.3 pour le détail complet. Résumé des exigences :

| ID | Exigence | Prio |
|----|----------|------|
| F-40 | Quatre formats de sortie sont proposés : `auto`, `mp3-320`, `m4a-copy`, `mp3-v0`. | M |
| F-41 | Chaque option affiche une description de son compromis (qualité, taille, compatibilité) sans survol. | M |
| F-42 | `auto` est présélectionné et arbitre selon les flux réellement disponibles. | M |
| F-43 | `m4a-copy` est désactivé et motivé lorsque la source n'expose aucun flux AAC ; une sélection mémorisée devenue indisponible retombe sur `auto`. | M |
| F-44 | Le format retenu et le flux source réel sont affichés avant et après conversion. | M |
| F-45 | Le dernier format choisi est mémorisé en `localStorage`. | S |

### 5.6 Téléchargement

| ID | Exigence | Prio |
|----|----------|------|
| F-40 | Le téléchargement démarre automatiquement dès la fin du job. | M |
| F-41 | L'en-tête `Content-Disposition` transporte le nom choisi, encodé RFC 5987 (`filename*=UTF-8''…`) avec repli ASCII (`filename="…"`). | M |
| F-42 | `Content-Length` est renseigné pour permettre une barre de progression navigateur. | M |
| F-43 | Le lien de téléchargement reste valide pendant le TTL du fichier (défaut 30 min) et est retéléchargeable. | M |
| F-44 | L'URL de téléchargement contient un jeton non devinable (voir §16.4). | M |
| F-45 | Le serveur supporte les requêtes `Range` (reprise de téléchargement). | S |

---

## 6. Qualité audio : cible Pioneer / rekordbox

### 6.1 Réalité technique à assumer

YouTube ne distribue **jamais** de MP3. Les flux audio disponibles sont typiquement :

| itag | Codec | Conteneur | Débit approx. | Fréquence |
|------|-------|-----------|---------------|-----------|
| 251 | Opus | WebM | ~130–160 kbps VBR | 48 kHz |
| 250 | Opus | WebM | ~64–80 kbps VBR | 48 kHz |
| 249 | Opus | WebM | ~48–50 kbps VBR | 48 kHz |
| 140 | AAC-LC | M4A | 128 kbps CBR | 44,1 kHz |
| 141 | AAC | M4A | 256 kbps (rare, contenus musicaux) | 44,1 kHz |
| 774 | Opus | WebM | ~256 kbps (rare, *high quality audio*) | 48 kHz |

Conséquence : **un MP3 320 kbps issu de YouTube est un transcodage d'une source déjà
compressée**. Le 320 kbps garantit que l'étape d'encodage MP3 n'ajoute pas de perte
perceptible par-dessus la perte d'origine — c'est un **plafond de transparence**, pas une
promesse de qualité studio.

### 6.2 Contrainte de compatibilité : Pioneer / rekordbox

Le fichier produit doit être exploitable en **contexte DJ** : import rekordbox, analyse,
export USB, lecture sur CDJ. Cela contraint fortement le choix de format.

| Format | rekordbox | CDJ-2000NXS2 | CDJ-3000 | Verdict |
|--------|-----------|--------------|----------|---------|
| MP3 | ✅ | ✅ 32–320 kbps @ 44,1/48 kHz | ✅ @ 44,1/48 kHz | Retenu |
| AAC (.m4a) | ✅ | ✅ 16–320 kbps @ 44,1/48 kHz | ✅ @ 44,1/48 kHz | Retenu |
| FLAC / ALAC | ✅ | ✅ | ✅ | Sans objet (source lossy) |
| WAV / AIFF | ✅ | ✅ | ✅ | Sans objet (source lossy) |
| **Opus** | ❌ | ❌ | ❌ | **Exclu** |

Deux conséquences structurantes :

1. **L'Opus est éliminé.** C'est pourtant le meilleur flux que YouTube expose dans le cas
   général (itag 251). La recopie sans réencodage n'est donc *pas* toujours possible :
   quand la source est en Opus, le transcodage devient obligatoire, pas seulement
   souhaitable.
2. **Le 48 kHz est sûr.** Il est supporté en MP3 comme en AAC sur toute la gamme visée.
   Le rééchantillonnage 48 → 44,1 kHz n'est donc plus justifié par la compatibilité, et
   n'était de toute façon qu'une perte gratuite.

### 6.3 Sélecteur de format de sortie (F-40)

Le format n'est pas imposé : l'utilisateur choisit parmi **quatre options**, présentées avec
leurs compromis réels. Le mode `auto` est présélectionné et couvre le cas courant.

| Clé | Libellé | Sortie | Réencodage | Taille / min | Défaut |
|-----|---------|--------|-----------|--------------|--------|
| `auto` | Meilleure qualité (recommandé) | `.m4a` ou `.mp3` | Selon source | 1 – 2,4 Mo | ✅ |
| `mp3-320` | MP3 320 kbps | `.mp3` | Toujours | ~2,4 Mo | |
| `m4a-copy` | M4A — copie sans réencodage | `.m4a` | Jamais | ~1 – 1,9 Mo | |
| `mp3-v0` | MP3 V0 (VBR, ~245 kbps) | `.mp3` | Toujours | ~1,8 Mo | |

#### Description affichée à l'utilisateur

Chaque option porte une phrase d'explication, visible sans survol :

- **Meilleure qualité (recommandé)** — « On analyse la source et on choisit
  automatiquement : copie sans réencodage si YouTube propose un AAC haut débit, MP3
  320 kbps sinon. Toujours lisible sur rekordbox et CDJ. »
- **MP3 320 kbps** — « Le format le plus universel. Lisible sur absolument tout le
  matériel, y compris ancien. Réencodage systématique, fichiers plus lourds. »
- **M4A — copie sans réencodage** — « Le flux YouTube est recopié tel quel, sans aucune
  perte ajoutée, en fichiers 2 à 3× plus légers. Lisible sur rekordbox, CDJ-2000NXS2 et
  CDJ-3000. Indisponible si YouTube ne propose pas d'AAC pour cette vidéo. »
- **MP3 V0 (VBR)** — « Qualité indiscernable du 320 kbps pour 25 % de place en moins.
  Débit variable : à éviter si votre matériel est ancien. »

#### Mode `auto` — algorithme

```
soit aac  = meilleur flux AAC disponible (par débit)
soit best = meilleur flux audio disponible, tous codecs (par débit)

si aac existe et aac.abr >= AAC_PASSTHROUGH_MIN_ABR :
    → RECOPIE : aac vers .m4a, sans réencodage        (chemin A)
sinon :
    → TRANSCODAGE : best vers .mp3 320 kbps CBR       (chemin B)
```

Justification du seuil à 192 kbps. Le choix se joue presque toujours entre deux options :

- recopier l'AAC 128 kbps (itag 140) sans perte de génération ;
- transcoder l'Opus ~160 kbps (itag 251), qui subit alors une génération de perte.

À ces débits, l'Opus 160 reste perceptuellement supérieur à l'AAC 128, et un réencodage en
320 kbps n'ajoute pas de dégradation audible. **Le transcodage gagne.** Le seuil bascule en
faveur de la recopie uniquement quand un AAC haut débit existe (itag 141 à 256 kbps,
fréquent sur les contenus musicaux officiels), cas où la recopie est strictement meilleure
que n'importe quel transcodage.

Seuil configurable (`AAC_PASSTHROUGH_MIN_ABR`, défaut `192`).

#### Disponibilité conditionnelle

`m4a-copy` **dépend de la source** : si l'analyse ne remonte aucun flux AAC, l'option est
désactivée (`disabled`, non sélectionnable) et porte la mention « Indisponible : YouTube ne
propose pas d'AAC pour cette vidéo ». Elle n'est jamais masquée — un choix qui disparaît
est plus déroutant qu'un choix grisé et expliqué.

Si `m4a-copy` était sélectionné et que l'utilisateur change d'URL vers une vidéo sans AAC,
la sélection **retombe sur `auto`** avec une notification discrète, plutôt que d'échouer au
lancement de la conversion.

#### Règles d'interface

- Groupe de `<input type="radio">` (navigation clavier native), `fieldset` +
  `legend` « Format de sortie ».
- Placé **sous** le sélecteur de nom (§8), avant le bouton de conversion.
- Le choix est mémorisé en `localStorage` (clé `yt2mp3.outputFormat`) et restauré à la
  visite suivante. Une valeur mémorisée devenue indisponible retombe sur `auto`.
- L'extension du fichier n'est **jamais** saisie par l'utilisateur (§8.5) : elle découle du
  format retenu et est ajoutée à l'envoi. Changer de format ne modifie donc pas le nom
  choisi.
- Un tableau comparatif repliable (`<details>`, fermé par défaut) reprend la matrice de
  compatibilité de §6.2, pour l'utilisateur qui veut vérifier avant de choisir.

#### Formats volontairement absents

À documenter dans le repli comparatif, car ce sont des demandes récurrentes en contexte DJ :

- **WAV / AIFF / FLAC / ALAC** — rekordbox et les CDJ les lisent parfaitement, mais la
  source YouTube est **déjà compressée en lossy**. Les proposer produirait des fichiers 10×
  plus lourds sans une once de qualité supplémentaire, tout en laissant croire à du
  « qualité CD ». C'est une fausse promesse, on ne l'offre pas.
- **Opus** — meilleur codec du lot à débit égal, et souvent le flux source, mais **aucun
  matériel Pioneer ne le lit** (§6.2). Inutilisable ici.

### 6.4 Chemin A — recopie AAC (`.m4a`)

Déclenché par `m4a-copy`, ou par `auto` quand un AAC ≥ 192 kbps est disponible.

```bash
ffmpeg -hide_banner -nostdin \
  -i "<source>" \
  -vn \
  -map_metadata -1 \
  -c:a copy \
  -movflags +faststart \
  -progress pipe:1 \
  "<sortie>.m4a"
```

Le flux est transféré **bit pour bit** dans un conteneur MP4. Aucune perte de génération,
durée de traitement négligeable (pas de décodage/réencodage), fichier ~3× plus petit qu'un
MP3 320. Les métadonnées sont ensuite écrites en atomes MP4, pas en ID3 (§9.1).

### 6.5 Chemin B — transcodage MP3 320 kbps CBR

Déclenché par `mp3-320`, ou par `auto` dans tous les autres cas.

```bash
ffmpeg -hide_banner -nostdin \
  -i "<source>" \
  -vn \
  -map_metadata -1 \
  -c:a libmp3lame \
  -b:a 320k \
  -compression_level 0 \
  -write_xing 1 \
  -id3v2_version 3 \
  -progress pipe:1 \
  "<sortie>.mp3"
```

Points à respecter :

- **Aucun `-ar`.** La fréquence de la source est conservée (48 kHz pour l'Opus). Le MP3
  supporte nativement 32 / 44,1 / 48 kHz, et les CDJ visés lisent le 48 kHz. Rééchantillonner
  vers 44,1 kHz ajouterait une étape destructrice — avec un rapport non entier (160/147), le
  cas le plus coûteux — sans aucun bénéfice.
- **Aucun `-ac`.** Le nombre de canaux de la source est conservé. Forcer une source mono en
  stéréo dupliqué gaspillerait la moitié du débit à encoder deux fois le même signal.
- `-vn` : aucune piste vidéo dans la sortie.
- `-map_metadata -1` : les métadonnées de la source sont effacées puis réécrites proprement
  (§9), ce qui évite de propager des tags parasites.
- `-b:a 320k` : CBR strict. Ne **pas** utiliser `-q:a` (VBR) qui ne garantit pas le débit.
- `-compression_level 0` : chez libmp3lame, **0 = meilleure qualité algorithmique** (et non
  l'inverse). C'est le réglage le plus lent et le plus soigneux.
- `-id3v2_version 3` : voir §9.1, choix d'interopérabilité DJ.
- `-progress pipe:1` : sortie machine pour alimenter la barre de progression.

**Option gear ancien** : si `FORCE_44100` est activé par l'opérateur (défaut : désactivé),
un rééchantillonnage `-af aresample=resampler=soxr:precision=28 -ar 44100` est appliqué,
pour du matériel hors gamme CDJ qui ne lirait pas le 48 kHz. À laisser désactivé sur du
Pioneer.

### 6.6 Chemin C — transcodage MP3 V0 (VBR)

Déclenché par `mp3-v0` uniquement. Jamais choisi par `auto`.

Identique au chemin B, en remplaçant `-b:a 320k` par :

```
  -q:a 0
```

`-q:a 0` correspond au preset LAME **V0**, qui vise ~245 kbps en moyenne. Sur une source
déjà compressée, il est perceptuellement indiscernable du 320 kbps CBR pour ~25 % de place
en moins.

`-write_xing 1` (déjà présent au chemin B) devient ici **critique** : l'en-tête Xing porte
la table de seek et la durée réelle. Sans elle, un MP3 VBR se positionne de travers — ce qui
en contexte DJ signifie une forme d'onde et une beatgrid décalées. C'est la raison pour
laquelle `auto` ne sélectionne jamais ce chemin : le gain est en octets, le risque est sur
la piste.

### 6.7 Affichage de la qualité (honnêteté produit — P6)

L'interface affiche systématiquement, dans la carte d'aperçu, **le flux réellement retenu**
et non une valeur générique :

```
Source YouTube    : Opus ~160 kbps, 48 kHz  ⓘ
Fichier produit   : MP3 320 kbps, 48 kHz — compatible rekordbox / CDJ
```

et dans le cas de la recopie :

```
Source YouTube    : AAC 256 kbps, 44,1 kHz  ⓘ
Fichier produit   : M4A 256 kbps — copie sans réencodage, compatible rekordbox / CDJ
```

L'infobulle ⓘ : « YouTube ne fournit pas de MP3. Nous partons du meilleur flux audio
disponible et produisons le meilleur format lisible par votre matériel Pioneer — une copie
sans réencodage quand c'est possible, un MP3 320 kbps sinon. La qualité finale reste
limitée par celle de la source. »

En mode `auto`, la ligne « Fichier produit » est complétée par la **raison** de l'arbitrage,
pour que le choix automatique reste lisible :

- `— copie sans réencodage (AAC 256 kbps disponible)`
- `— AAC limité à 128 kbps, transcodage depuis l'Opus 160 kbps`

Cette transparence est une exigence, pas une option : elle évite une promesse trompeuse.

---

## 7. Absence de publicité

### 7.1 Portée de l'exigence

« Il ne doit pas y avoir de pub » se décline en cinq interdits :

| ID | Interdit |
|----|----------|
| PUB-1 | **Aucune régie publicitaire** : pas d'AdSense, pas de bannière, pas de native ad, pas d'annonce textuelle. |
| PUB-2 | **Aucun tracker tiers** : pas de Google Analytics, pas de pixel Meta, pas de Hotjar, pas de balise de retargeting. Analytique auto-hébergée et anonyme uniquement (§18.3). |
| PUB-3 | **Aucun script ni ressource externe** : polices, CSS, JS, images sont servis depuis le domaine du service. Vérifié par une CSP stricte (§16.2). |
| PUB-4 | **Aucun *dark pattern*** : pas de faux bouton de téléchargement, pas de compte à rebours artificiel, pas de pop-under, pas d'ouverture d'onglet non sollicitée, pas de demande de notification push, pas de bandeau cookie (parce qu'il n'y a pas de cookie à consentir). |
| PUB-5 | **Aucune monétisation déguisée** : pas de minage crypto, pas d'extension proposée, pas d'installeur, pas de « logiciel recommandé ». |

### 7.2 Vérification automatisée

Un test d'intégration bloque la CI si l'une des conditions suivantes est violée :

1. Le HTML servi ne contient **aucune** balise `<script src>` ou `<link href>` pointant vers un hôte différent de l'origine.
2. La page chargée dans un navigateur headless n'émet **aucune** requête réseau sortante vers un domaine tiers (liste des requêtes interceptées via Playwright).
3. L'en-tête `Content-Security-Policy` contient `default-src 'self'` et ne contient ni `unsafe-inline` en `script-src`, ni de wildcard d'hôte.
4. Le fichier `package.json` ne contient aucune dépendance figurant sur une liste noire de SDK publicitaires/analytiques.

### 7.3 Lecture alternative : segments sponsorisés dans l'audio

Une seconde lecture de l'exigence concerne les **passages sponsorisés lus par le créateur**
à l'intérieur de la vidéo. Ce n'est pas l'interprétation retenue pour la v1 (l'interdit
porte sur l'application), mais une option est prévue en §21 : intégration facultative de
l'API **SponsorBlock** pour découper les segments catégorisés `sponsor` / `selfpromo` /
`interaction`. Cette option serait **désactivée par défaut** et signalée explicitement, car
elle modifie l'œuvre.

---

## 8. Nommage du fichier : sélecteur de modèle + champ libre

C'est la fonctionnalité différenciante du produit. Elle est spécifiée exhaustivement.

### 8.1 Données d'entrée

À l'issue de l'analyse, on dispose de :

| Variable | Source | Exemple |
|----------|--------|---------|
| `title` | Titre de la vidéo | `Bohemian Rhapsody (Official Video Remastered)` |
| `channel` | Nom de la chaîne | `Queen Official` |
| `year` | Année de publication | `2008` |
| `artistGuess` | Artiste déduit (§8.4) | `Queen` |
| `titleGuess` | Titre déduit (§8.4) | `Bohemian Rhapsody` |
| `duration` | Durée formatée | `5:59` |

### 8.2 Modèles proposés

Le sélecteur affiche **six options mutuellement exclusives**, sous forme de liste de cartes
radio. Chaque carte affiche le **nom du modèle** et un **aperçu du résultat réel** calculé
avec les données de la vidéo courante.

| # | Clé | Modèle | Aperçu (exemple ci-dessus) |
|---|-----|--------|----------------------------|
| 1 | `title` | `{title}` | `Bohemian Rhapsody (Official Video Remastered)` |
| 2 | `channel-title` | `{channel} - {title}` | `Queen Official - Bohemian Rhapsody (Official Video Remastered)` |
| 3 | `title-channel` | `{title} - {channel}` | `Bohemian Rhapsody (Official Video Remastered) - Queen Official` |
| 4 | `artist-track` | `{artistGuess} - {titleGuess}` | `Queen - Bohemian Rhapsody` |
| 5 | `title-year` | `{title} ({year})` | `Bohemian Rhapsody (Official Video Remastered) (2008)` |
| 6 | `custom` | *(libre)* | *(contenu courant de la zone de texte)* |

Règles :

- **R1** — Le modèle par défaut à l'ouverture est `artist-track` **si** la détection §8.4 a
  réussi avec une confiance suffisante ; sinon `channel-title`.
- **R2** — Si `localStorage` contient un modèle précédemment choisi (F-37), il prime sur R1,
  sauf s'il s'agit de `custom` (on ne restaure jamais un nom personnalisé d'une autre vidéo).
- **R3** — Le modèle `artist-track` n'est proposé que si la détection a réussi. Sinon la
  carte est masquée (et non pas grisée : une carte inutile est du bruit).
- **R4** — Le modèle `title-year` n'est proposé que si `year` est connu.
- **R5** — La carte `custom` n'est pas sélectionnable directement par clic : elle devient
  active automatiquement dès que l'utilisateur modifie la zone de texte. Elle sert de
  **témoin d'état**, pas de bouton.

### 8.3 Comportement du couple sélecteur ↔ zone de texte

C'est le cœur de l'exigence C3.

```
┌───────────────────────────────────────────────────────────────┐
│  Nom du fichier                                               │
│                                                               │
│  ○ Titre seul                                                 │
│    Bohemian Rhapsody (Official Video Remastered)              │
│                                                               │
│  ● Chaîne + Titre                                             │
│    Queen Official - Bohemian Rhapsody (Official Video R…      │
│                                                               │
│  ○ Titre + Chaîne                                             │
│    Bohemian Rhapsody (Official Video R… - Queen Official      │
│                                                               │
│  ○ Artiste - Morceau                                          │
│    Queen - Bohemian Rhapsody                                  │
│                                                               │
│  ○ Titre (Année)                                              │
│    Bohemian Rhapsody (Official Video Remastered) (2008)       │
│                                                               │
│  ┌─────────────────────────────────────────────────┐          │
│  │ Queen Official - Bohemian Rhapsody (Officia…    │  .mp3    │
│  └─────────────────────────────────────────────────┘          │
│  ⟲ Réinitialiser        58 / 180 caractères                   │
└───────────────────────────────────────────────────────────────┘
```

Contrat d'interaction :

| Action utilisateur | Effet |
|--------------------|-------|
| Clic sur une carte modèle | La zone de texte est **écrasée** par le rendu du modèle. Aucune confirmation. La sélection radio bascule sur cette carte. |
| Frappe dans la zone de texte | La sélection radio bascule sur `custom`. Les cartes restent affichées avec leurs aperçus. |
| Clic sur une carte après édition manuelle | La zone est écrasée sans avertissement (§8.3.1). |
| Clic sur « Réinitialiser » | Retour au modèle par défaut (R1/R2), zone de texte régénérée. Le bouton n'est visible que si l'état courant est `custom`. |
| Zone de texte vidée | Le bouton « Convertir » est désactivé ; message inline « Le nom ne peut pas être vide ». |
| Champ `.mp3` | Suffixe affiché en **texte statique non éditable**, adjacent au champ. |

#### 8.3.1 Perte d'une saisie manuelle

Si l'utilisateur a personnalisé le nom puis clique sur un modèle, sa saisie est perdue. Deux
mitigations, sans boîte de dialogue (qui casserait la fluidité) :

1. La saisie personnalisée précédente est conservée en mémoire ; un lien discret
   « Annuler — revenir à mon nom » apparaît pendant 8 secondes sous le champ.
2. `Ctrl/Cmd+Z` dans la zone de texte restaure la saisie précédente (historique natif du
   champ préservé en n'utilisant pas de remplacement destructif du DOM).

### 8.4 Détection « Artiste - Morceau »

Beaucoup de titres YouTube musicaux suivent le motif `Artiste - Titre (qualificatifs)`.
Algorithme de détection, appliqué côté serveur lors de l'analyse :

```
1. Si les métadonnées YouTube Music exposent `artist` et `track`
   (champs `artist`, `track`, `album` de yt-dlp), les utiliser. Confiance = HAUTE. STOP.

2. Sinon, chercher dans `title` un séparateur parmi : " - ", " – ", " — ", " | ", " ~ ".
   Retenir la PREMIÈRE occurrence.
   - Partie gauche → artistGuess, partie droite → titleGuess.
   - Rejeter si : partie gauche vide, > 60 caractères, ou entièrement numérique.
   - Confiance = MOYENNE.

3. Nettoyer titleGuess des qualificatifs entre parenthèses/crochets si leur contenu
   correspond (insensible à la casse, avec ou sans accents) à :
   official video, official music video, official audio, official lyric video,
   lyrics, lyric video, audio, hd, hq, 4k, remastered, remaster, full album,
   visualizer, m/v, mv, clip officiel, video oficial, live, explicit, clean,
   free download, out now, prod. by <x>
   → Ne PAS supprimer un qualificatif porteur de sens : (Remix), (Acoustic),
     (feat. X), (ft. X), (Radio Edit), (Extended Mix), (Cover), (Instrumental),
     (Demo), (Deluxe), (Part 2), toute mention d'année seule.

4. Nettoyer artistGuess du suffixe de chaîne : " - Topic", "VEVO", "Official",
   "Music", "Records", "TV" en fin de chaîne.

5. Si artistGuess n'a pas été trouvé au titre mais que `channel` se termine par
   " - Topic" (chaînes auto-générées YouTube Music), alors
   artistGuess = channel sans " - Topic", titleGuess = title. Confiance = HAUTE.

6. Normaliser les espaces multiples, retirer les espaces de bord.
   Si artistGuess ou titleGuess est vide après nettoyage → détection ÉCHOUÉE.
```

La détection retourne `{ artist, track, confidence: "high" | "medium" | null }`. Le modèle
`artist-track` n'est proposé que si `confidence` vaut `high` ou `medium` (R3), et n'est
choisi par défaut (R1) que si `confidence` vaut `high`.

**Cas de test obligatoires :**

| Titre / chaîne d'entrée | `artistGuess` attendu | `titleGuess` attendu |
|--------------------------|----------------------|----------------------|
| `Queen - Bohemian Rhapsody (Official Video Remastered)` | `Queen` | `Bohemian Rhapsody` |
| `Daft Punk - Around the World [HQ]` | `Daft Punk` | `Around the World` |
| `Stromae - Alors on danse (Radio Edit)` | `Stromae` | `Alors on danse (Radio Edit)` |
| `Comment faire un gâteau - Recette facile` | `Comment faire un gâteau` | `Recette facile` |
| `Bohemian Rhapsody` (chaîne `Queen - Topic`) | `Queen` | `Bohemian Rhapsody` |
| `LOFI BEATS 24/7` | *(échec)* | *(échec)* |
| `A - B - C` | `A` | `B - C` |
| `Artist – Track (feat. Guest) [Official Audio]` | `Artist` | `Track (feat. Guest)` |

### 8.5 Assainissement du nom (F-35)

Appliqué **côté serveur**, systématiquement, avant toute écriture disque et avant l'en-tête
HTTP. Le client applique la même transformation pour l'aperçu, mais ne fait jamais autorité.

```
1. Normalisation Unicode NFC.
2. Suppression des caractères de contrôle (U+0000–U+001F, U+007F–U+009F)
   et des marques de direction bidirectionnelle (U+202A–U+202E, U+2066–U+2069).
3. Remplacement des caractères interdits par un espace :  / \ : * ? " < > |
   (union des interdits Windows, macOS et Linux)
4. Remplacement de tout séparateur de chemin restant, y compris "..".
5. Réduction des espaces consécutifs à un seul ; trim.
6. Suppression des points et espaces en fin de nom (contrainte Windows).
7. Rejet des noms réservés Windows (CON, PRN, AUX, NUL, COM1–9, LPT1–9),
   insensible à la casse, avec ou sans extension → préfixage par "_".
8. Troncature à 180 caractères (sans l'extension), en coupant sur une frontière
   de grappe de graphèmes (pas au milieu d'un emoji ou d'un caractère composé).
9. Si le résultat est vide → repli sur "audio-{videoId}".
10. Ajout de l'extension ".mp3".
```

Le compteur de caractères de l'interface reflète la limite de l'étape 8 (180) et passe en
état d'alerte au-delà de 170.

### 8.6 Collision de noms

Deux fichiers différents peuvent porter le même nom. Le stockage serveur utilise le `jobId`
comme nom réel sur disque ; le nom choisi n'apparaît que dans `Content-Disposition`. Il n'y
a donc **aucune collision côté serveur**. Côté navigateur, la gestion des doublons dans le
dossier de téléchargements relève du système d'exploitation.

---

## 9. Métadonnées et pochette

### 9.1 Tags écrits

Le MP3 produit porte des tags **ID3v2.3**, encodés en UTF-16 (l'UTF-8 n'est pas un encodage
valide en ID3v2.3 ; les bibliothèques de tagging s'en chargent).

> **Pourquoi v2.3 et non v2.4.** rekordbox lit correctement les deux, et écrit lui-même en
> v2.4 sur les nouveaux morceaux. Mais la v2.3 reste le dénominateur commun de tout
> l'écosystème DJ (Serato, Traktor, Explorateur Windows, vieux firmwares), et les fichiers
> produits ici sont destinés à circuler entre outils. C'est une assurance
> d'interopérabilité, pas le contournement d'un bug Pioneer.

Conséquence sur le mapping : la v2.3 ne connaît pas `TDRC`. L'année est écrite dans `TYER`.

| Frame | Contenu | Règle |
|-------|---------|-------|
| `TIT2` (Title) | `titleGuess` si détection réussie, sinon `title` | Toujours |
| `TPE1` (Artist) | `artistGuess` si détection réussie, sinon `channel` | Toujours |
| `TALB` (Album) | `album` YouTube Music si disponible, sinon vide | Si disponible |
| `TYER` (Year) | Année de publication | Si disponible |
| `TCON` (Genre) | Genre YouTube Music si disponible | Si disponible |
| `COMM` (Comment) | `Source: https://youtu.be/{videoId}` | Toujours |
| `TENC` (Encoded by) | `YT2MP3` | Toujours |
| `APIC` (Cover) | Pochette (§9.2) | Si disponible |

Les tags sont dérivés des **métadonnées de la vidéo**, pas du nom de fichier choisi : un
utilisateur qui renomme son fichier ne dégrade pas ses tags.

**Cas du `.m4a` (chemin A).** Un conteneur MP4 ne porte pas d'ID3 : les métadonnées sont
écrites en **atomes MP4**, avec la correspondance suivante. Le contenu est identique, seul
le véhicule change — l'écriture des atomes ne touche pas au flux audio et ne remet donc pas
en cause l'absence de réencodage.

| Frame ID3 | Atome MP4 |
|-----------|-----------|
| `TIT2` | `©nam` |
| `TPE1` | `©ART` |
| `TALB` | `©alb` |
| `TYER` | `©day` |
| `TCON` | `©gen` |
| `COMM` | `©cmt` |
| `TENC` | `©too` |
| `APIC` | `covr` |

### 9.2 Pochette

- Source : miniature `maxresdefault` si disponible, repli `hqdefault`.
- Traitement : recadrage **carré centré** (les miniatures YouTube sont en 16:9), redimensionnement à 600×600, encodage JPEG qualité 90.
- Alternative : si les métadonnées YouTube Music exposent une pochette d'album carrée, elle est préférée à la miniature.
- Taille cible < 200 Ko pour ne pas alourdir inutilement le fichier.
- Une case à cocher « Intégrer la pochette » est proposée dans l'interface, **cochée par défaut**.

---

## 10. Architecture technique

### 10.1 Vue d'ensemble

```
                         ┌──────────────────────────┐
                         │   Navigateur (SPA)       │
                         │   React + TypeScript     │
                         └────────────┬─────────────┘
                                      │ HTTPS (même origine)
                                      │ REST + SSE
                         ┌────────────▼─────────────┐
                         │   Serveur applicatif     │
                         │   Node.js + Fastify      │
                         │   ├─ /api/analyze        │
                         │   ├─ /api/jobs           │
                         │   ├─ /api/jobs/:id/events│
                         │   ├─ /api/jobs/:id/file  │
                         │   └─ /api/thumb/:id      │
                         └──────┬────────────┬──────┘
                                │            │
                ┌───────────────▼──┐   ┌─────▼──────────────┐
                │  File de jobs    │   │  Cache métadonnées │
                │  (in-memory v1 / │   │  (LRU, TTL 15 min) │
                │   Redis v1.1)    │   └────────────────────┘
                └───────┬──────────┘
                        │ spawn (processus isolés)
        ┌───────────────▼────────────────────┐
        │  Worker de conversion              │
        │  ├─ yt-dlp   (extraction du flux)  │
        │  └─ ffmpeg   (encodage MP3 320)    │
        └───────────────┬────────────────────┘
                        │
        ┌───────────────▼────────────────────┐
        │  Stockage éphémère                 │
        │  /var/lib/yt2mp3/files/{jobId}.mp3 │
        │  Purge automatique après TTL       │
        └────────────────────────────────────┘
```

### 10.2 Choix technologiques

| Couche | Choix | Justification |
|--------|-------|---------------|
| Frontend | **React 19 + TypeScript + Vite** | Écosystème mature, typage fort sur les contrats d'API, build sans dépendance runtime externe. |
| Styles | **CSS modules / Tailwind auto-hébergé** | Pas de CDN (PUB-3). Tailwind compilé localement si retenu. |
| Backend | **Node.js 22 LTS + Fastify** | Streaming HTTP performant, SSE natif, faible surcoût, même langage que le front. |
| Extraction | **yt-dlp** (binaire, épinglé par version) | Référence du domaine, maintenu, gère les évolutions de YouTube. |
| Encodage | **ffmpeg + libmp3lame** | Standard, `-b:a 320k` garantit le CBR. |
| File de jobs | **In-memory (v1)**, interface abstraite | Simplicité ; l'abstraction permet de passer à Redis/BullMQ sans réécrire les appelants. |
| Tests | **Vitest** (unitaires), **Playwright** (e2e) | Playwright sert aussi à vérifier l'absence de requêtes tierces (PUB-2). |
| Conteneur | **Docker multi-stage** | `yt-dlp` et `ffmpeg` intégrés à l'image, versions figées et reproductibles. |

### 10.3 Structure du dépôt

```
yt2mp3/
├── SPEC.md                        ← ce document
├── README.md
├── docker-compose.yml
├── Dockerfile
├── package.json                   ← workspaces
├── packages/
│   ├── shared/                    ← types partagés front/back
│   │   └── src/
│   │       ├── contracts.ts       ← DTO d'API
│   │       ├── filename.ts        ← modèles + assainissement (isomorphe)
│   │       ├── formats.ts         ← catalogue des formats + arbitrage `auto` (isomorphe)
│   │       └── errors.ts          ← codes d'erreur
│   ├── server/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── routes/
│   │       │   ├── analyze.ts
│   │       │   ├── jobs.ts
│   │       │   ├── download.ts
│   │       │   └── thumb.ts
│   │       ├── services/
│   │       │   ├── metadata.ts    ← appel yt-dlp --dump-json
│   │       │   ├── converter.ts   ← pipeline yt-dlp | ffmpeg, chemins A/B/C (§6.4–6.6)
│   │       │   ├── formatSelect.ts← résolution du format + revalidation serveur
│   │       │   ├── tagger.ts      ← ID3v2.3 / atomes MP4 + pochette
│   │       │   ├── artistDetect.ts← algorithme §8.4
│   │       │   └── queue.ts
│   │       ├── storage/
│   │       │   ├── files.ts
│   │       │   └── reaper.ts      ← purge TTL
│   │       └── config.ts
│   └── web/
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── UrlInput.tsx
│           │   ├── VideoPreview.tsx
│           │   ├── FilenamePicker.tsx  ← §8, composant central
│           │   ├── OutputFormatPicker.tsx ← §6.3 / §13.3
│           │   ├── ProgressPanel.tsx
│           │   └── ResultPanel.tsx
│           ├── hooks/
│           │   ├── useAnalyze.ts
│           │   └── useJobStream.ts
│           └── i18n/
└── tests/
    ├── unit/
    └── e2e/
```

**Point d'architecture important** : `packages/shared/src/filename.ts` et
`packages/shared/src/formats.ts` sont consommés par le front (aperçu temps réel) **et** par
le back (autorité). Une seule implémentation du nommage et de l'arbitrage `auto`, donc pas
de dérive entre ce que l'interface annonce et le fichier réellement produit — ce qui compte
d'autant plus que l'interface affiche désormais une estimation de taille et un format
résolu avant lancement.

### 10.4 Configuration

Toutes les valeurs suivantes sont des variables d'environnement, avec les défauts indiqués :

| Variable | Défaut | Rôle |
|----------|--------|------|
| `PORT` | `3000` | Port d'écoute |
| `MAX_DURATION_SECONDS` | `5400` | Durée maximale acceptée |
| `MAX_CONCURRENT_JOBS` | `4` | Conversions simultanées |
| `MAX_QUEUE_LENGTH` | `50` | Taille de la file d'attente |
| `FILE_TTL_MINUTES` | `30` | Durée de vie d'un fichier produit |
| `METADATA_CACHE_TTL_MINUTES` | `15` | Cache d'analyse |
| `RATE_LIMIT_ANALYZE` | `20/10min/IP` | Limite sur `/api/analyze` |
| `RATE_LIMIT_JOBS` | `10/10min/IP` | Limite sur `/api/jobs` |
| `STORAGE_PATH` | `/var/lib/yt2mp3/files` | Répertoire des fichiers |
| `STORAGE_QUOTA_MB` | `10240` | Quota disque total |
| `TARGET_BITRATE_KBPS` | `320` | Débit cible du chemin B (§6.5) |
| `DEFAULT_OUTPUT_FORMAT` | `auto` | Format présélectionné (§6.3) |
| `ENABLED_OUTPUT_FORMATS` | `auto,mp3-320,m4a-copy,mp3-v0` | Sous-ensemble des formats exposés |
| `AAC_PASSTHROUGH_MIN_ABR` | `192` | Seuil d'arbitrage du mode `auto` (§6.3) |
| `FORCE_44100` | `false` | Rééchantillonnage 44,1 kHz pour matériel ancien (§6.5) |
| `EMBED_COVER_DEFAULT` | `true` | Pochette cochée par défaut |
| `BLOCKLIST_PATH` | *(vide)* | Fichier d'IDs bloqués (DEP-2) |
| `YTDLP_PATH` / `FFMPEG_PATH` | *(auto)* | Chemins des binaires |
| `YTDLP_COOKIES_PATH` | *(vide)* | Fichier de cookies YouTube, option auto-hébergée — voir §16.6 |

---

## 11. Contrats d'API

Toutes les réponses sont en `application/json; charset=utf-8`, sauf le téléchargement, le
proxy de miniature et le flux SSE.

### 11.1 `POST /api/analyze`

**Requête**

```json
{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
```

**Réponse 200**

```json
{
  "videoId": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up (Official Video)",
  "channel": "Rick Astley",
  "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw",
  "durationSeconds": 213,
  "durationLabel": "3:33",
  "uploadDate": "2009-10-25",
  "year": 2009,
  "thumbnailUrl": "/api/thumb/dQw4w9WgXcQ",
  "source": {
    "codec": "opus",
    "bitrateKbps": 160,
    "sampleRateHz": 48000,
    "channels": 2
  },
  "formats": [
    {
      "key": "auto",
      "label": "Meilleure qualité (recommandé)",
      "available": true,
      "resolvesTo": "mp3-320",
      "reason": "AAC limité à 128 kbps, transcodage depuis l'Opus 160 kbps",
      "container": "mp3",
      "extension": ".mp3",
      "bitrateKbps": 320,
      "sampleRateHz": 48000,
      "channels": 2,
      "reencoded": true,
      "estimatedSizeBytes": 8520000
    },
    {
      "key": "mp3-320",
      "label": "MP3 320 kbps",
      "available": true,
      "container": "mp3",
      "extension": ".mp3",
      "bitrateKbps": 320,
      "sampleRateHz": 48000,
      "channels": 2,
      "reencoded": true,
      "estimatedSizeBytes": 8520000
    },
    {
      "key": "m4a-copy",
      "label": "M4A — copie sans réencodage",
      "available": false,
      "unavailableReason": "NO_AAC_STREAM",
      "container": "m4a",
      "extension": ".m4a"
    },
    {
      "key": "mp3-v0",
      "label": "MP3 V0 (VBR, ~245 kbps)",
      "available": true,
      "container": "mp3",
      "extension": ".mp3",
      "bitrateKbps": 245,
      "sampleRateHz": 48000,
      "channels": 2,
      "reencoded": true,
      "estimatedSizeBytes": 6520000
    }
  ],
  "defaultFormat": "auto",
  "naming": {
    "artistGuess": "Rick Astley",
    "titleGuess": "Never Gonna Give You Up",
    "confidence": "medium",
    "presets": [
      { "key": "title",         "label": "Titre seul",       "value": "Rick Astley - Never Gonna Give You Up (Official Video)" },
      { "key": "channel-title", "label": "Chaîne + Titre",   "value": "Rick Astley - Rick Astley - Never Gonna Give You Up (Official Video)" },
      { "key": "title-channel", "label": "Titre + Chaîne",   "value": "Rick Astley - Never Gonna Give You Up (Official Video) - Rick Astley" },
      { "key": "artist-track",  "label": "Artiste - Morceau","value": "Rick Astley - Never Gonna Give You Up" },
      { "key": "title-year",    "label": "Titre (Année)",    "value": "Rick Astley - Never Gonna Give You Up (Official Video) (2009)" }
    ],
    "defaultPreset": "artist-track"
  }
}
```

Notes :

- Les valeurs de `presets` sont **déjà assainies** (§8.5) et **sans extension**.
- `formats` est toujours renvoyé **au complet**, options indisponibles comprises : le client
  les affiche grisées avec leur motif (§6.3) plutôt que de les masquer. Valeurs possibles de
  `unavailableReason` : `NO_AAC_STREAM`, `AAC_BELOW_THRESHOLD`.
- `formats[].estimatedSizeBytes` est une estimation dérivée du débit et de la durée, destinée
  à l'affichage comparatif. Elle n'engage pas la taille finale exacte.

**Erreurs** : `400 INVALID_URL`, `404 VIDEO_NOT_FOUND`, `403 VIDEO_PRIVATE`,
`403 VIDEO_AGE_RESTRICTED`, `403 VIDEO_GEO_BLOCKED`, `409 VIDEO_IS_LIVE`,
`413 VIDEO_TOO_LONG`, `403 VIDEO_BLOCKED`, `429 RATE_LIMITED`, `502 UPSTREAM_ERROR`.

### 11.2 `POST /api/jobs`

**Requête**

```json
{
  "videoId": "dQw4w9WgXcQ",
  "filename": "Rick Astley - Never Gonna Give You Up",
  "outputFormat": "auto",
  "embedCover": true
}
```

`filename` est fourni **sans extension**. Le serveur le réassainit (§8.5) et peut donc
retourner un `filename` différent de celui envoyé — le client doit utiliser la valeur
retournée pour son affichage.

`outputFormat` accepte `auto` | `mp3-320` | `m4a-copy` | `mp3-v0`. Champ optionnel, défaut
`auto`. **Le serveur revalide la disponibilité** : le client n'est pas une source de vérité,
et l'analyse a pu être faite plusieurs minutes plus tôt.

**Réponse 202**

```json
{
  "jobId": "j_01JQ8ZK3M4N5P6Q7R8S9T0",
  "state": "queued",
  "queuePosition": 2,
  "filename": "Rick Astley - Never Gonna Give You Up.mp3",
  "outputFormat": "auto",
  "resolvedFormat": "mp3-320",
  "createdAt": "2026-08-05T10:12:00.000Z"
}
```

`resolvedFormat` est le format effectivement retenu après arbitrage de `auto` et
revalidation. C'est lui qui détermine l'extension du `filename` retourné.

**Erreurs** : `400 INVALID_FILENAME`, `400 INVALID_VIDEO_ID`, `400 INVALID_OUTPUT_FORMAT`
(clé inconnue), `409 FORMAT_UNAVAILABLE` (format valide mais indisponible pour cette source
— le client doit re-analyser et proposer un repli), `429 RATE_LIMITED`, `503 QUEUE_FULL`,
`507 STORAGE_FULL`, plus les erreurs de §11.1.

### 11.3 `GET /api/jobs/:jobId`

Consultation ponctuelle (repli si SSE indisponible).

```json
{
  "jobId": "j_01JQ8ZK3M4N5P6Q7R8S9T0",
  "state": "encoding",
  "phase": "encoding",
  "progress": 62,
  "queuePosition": null,
  "filename": "Rick Astley - Never Gonna Give You Up.mp3",
  "sizeBytes": null,
  "downloadUrl": null,
  "expiresAt": null,
  "error": null
}
```

À l'état `ready` :

```json
{
  "jobId": "j_01JQ8ZK3M4N5P6Q7R8S9T0",
  "state": "ready",
  "phase": null,
  "progress": 100,
  "filename": "Rick Astley - Never Gonna Give You Up.mp3",
  "sizeBytes": 8534912,
  "bitrateKbps": 320,
  "durationSeconds": 213,
  "downloadUrl": "/api/jobs/j_01JQ8ZK3M4N5P6Q7R8S9T0/file?t=9f3c…",
  "expiresAt": "2026-08-05T10:45:00.000Z",
  "error": null
}
```

### 11.4 `GET /api/jobs/:jobId/events` (SSE)

`Content-Type: text/event-stream`. Un événement par changement d'état ou par palier de
progression (au maximum un message par 250 ms).

```
event: progress
data: {"state":"downloading","phase":"downloading","progress":34}

event: progress
data: {"state":"encoding","phase":"encoding","progress":71}

event: ready
data: {"state":"ready","progress":100,"downloadUrl":"/api/jobs/j_01…/file?t=9f3c…","sizeBytes":8534912,"expiresAt":"2026-08-05T10:45:00.000Z"}
```

En cas d'échec :

```
event: error
data: {"state":"failed","code":"CONVERSION_FAILED","message":"L'encodage a échoué.","retryable":true}
```

Le flux est fermé par le serveur après un événement terminal (`ready`, `error`,
`cancelled`). Un commentaire `:keepalive` est émis toutes les 15 s pour traverser les
proxys.

### 11.5 `DELETE /api/jobs/:jobId`

Annule un job non terminal. Réponse `200 { "state": "cancelled" }` ou `409 JOB_NOT_CANCELLABLE`.

### 11.6 `GET /api/jobs/:jobId/file?t=<token>`

Réponse `200` avec :

```
Content-Type: audio/mpeg
Content-Length: 8534912
Content-Disposition: attachment; filename="Rick Astley - Never Gonna Give You Up.mp3"; filename*=UTF-8''Rick%20Astley%20-%20Never%20Gonna%20Give%20You%20Up.mp3
Accept-Ranges: bytes
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

Le repli `filename=` est la translittération ASCII du nom (les caractères non représentables
sont remplacés par `_`). Erreurs : `403 INVALID_TOKEN`, `404 FILE_EXPIRED`, `409 JOB_NOT_READY`.

### 11.7 `GET /api/thumb/:videoId`

Proxy de miniature (F-16). Réponse `image/jpeg`, `Cache-Control: public, max-age=3600`.
Le serveur ne relaie **que** les domaines de miniatures YouTube connus, et impose une
taille de réponse maximale de 2 Mo.

### 11.8 Format d'erreur unifié

```json
{
  "error": {
    "code": "VIDEO_TOO_LONG",
    "message": "Cette vidéo dure 2 h 14. La limite est de 1 h 30.",
    "retryable": false,
    "details": { "durationSeconds": 8040, "maxDurationSeconds": 5400 }
  }
}
```

`message` est déjà localisé selon l'en-tête `Accept-Language` (fr/en). `code` est stable et
sert de clé de traduction côté client si celui-ci préfère gérer lui-même l'affichage.

---

## 12. Machine à états d'un job

```
                    POST /api/jobs
                          │
                          ▼
                     ┌─────────┐
              ┌──────│ queued  │──────┐
              │      └────┬────┘      │
              │           │ slot libre│ DELETE
              │           ▼           ▼
              │    ┌─────────────┐  ┌───────────┐
              │    │ downloading │─▶│ cancelled │◀─┐
              │    └──────┬──────┘  └───────────┘  │
              │           │ flux récupéré           │
              │           ▼                         │
              │    ┌─────────────┐                  │
              │    │  encoding   │──────────────────┤ DELETE
              │    └──────┬──────┘                  │
              │           │ MP3 écrit                │
              │           ▼                         │
              │    ┌─────────────┐                  │
              │    │   tagging   │──────────────────┘
              │    └──────┬──────┘
              │           │ tags + pochette écrits
              │           ▼
              │      ┌─────────┐   TTL écoulé   ┌─────────┐
              │      │  ready  │───────────────▶│ expired │
              │      └─────────┘                └─────────┘
              │
              │ erreur à n'importe quelle étape
              ▼
         ┌─────────┐
         │ failed  │──── « Réessayer » ──▶ nouveau job
         └─────────┘
```

### 12.1 Progression pondérée

La valeur `progress` (0–100) agrège les phases :

| Phase | Plage | Source de la mesure |
|-------|-------|---------------------|
| `queued` | 0 | — |
| `downloading` | 0 → 60 | Sortie `--newline --progress-template` de yt-dlp (octets reçus / total) |
| `encoding` | 60 → 95 | `out_time_us` de `ffmpeg -progress` rapporté à la durée connue |
| `tagging` | 95 → 100 | Palier fixe |

La progression est **monotone croissante** : une valeur inférieure à la précédente est
ignorée, pour éviter les reculs visuels dus au multi-fragment de yt-dlp.

### 12.2 Délais de garde

| Phase | Délai max | Action au dépassement |
|-------|-----------|------------------------|
| `downloading` | 10 min | `failed` / `DOWNLOAD_TIMEOUT`, processus tué |
| `encoding` | 10 min | `failed` / `ENCODING_TIMEOUT`, processus tué |
| `tagging` | 1 min | `failed` / `TAGGING_FAILED` |
| Total | 20 min | Garde absolue |

Un job qui n'émet aucune progression pendant 90 s est également tué (détection de blocage).

---

## 13. Spécification d'interface (UI/UX)

### 13.1 Structure de page

Application mono-page, une seule colonne centrée (largeur max 720 px), quatre zones qui
apparaissent séquentiellement sans jamais faire disparaître les précédentes (l'utilisateur
garde le contexte de ce qu'il a saisi).

```
┌──────────────────────────────────────────────────────┐
│  YT2MP3                              [FR ▾]  [🌙]    │  ← en-tête minimal
├──────────────────────────────────────────────────────┤
│                                                      │
│   Convertissez une vidéo YouTube pour vos platines   │
│   Sans publicité. Sans compte. Sans traceur.         │
│                                                      │
│   ┌────────────────────────────────┐  ┌───────────┐  │
│   │ Collez l'URL de la vidéo…      │  │ Analyser  │  │
│   └────────────────────────────────┘  └───────────┘  │
│                                                      │
├──────────────────────────────────────────────────────┤  ← zone 2 (après analyse)
│   ┌────────┐  Rick Astley - Never Gonna Give You Up  │
│   │ [img]  │  Rick Astley · 3:33 · 2009              │
│   │  16:9  │  Source : Opus ~160 kbps, 48 kHz ⓘ      │
│   └────────┘                                         │
├──────────────────────────────────────────────────────┤  ← zone 3
│   Nom du fichier                                     │
│   [ sélecteur de modèles — voir §8.3 ]               │
│   [ zone de texte éditable ]              .mp3       │
│                                                      │
│   Format de sortie                                   │
│   ◉ Meilleure qualité (recommandé)         ~8,5 Mo   │
│     Copie sans réencodage si possible,               │
│     MP3 320 kbps sinon. → MP3 320 kbps               │
│   ○ MP3 320 kbps                           ~8,5 Mo   │
│     Le plus universel, lisible partout.              │
│   ○ M4A — copie sans réencodage         indisponible │
│     YouTube ne propose pas d'AAC ici.                │
│   ○ MP3 V0 (VBR, ~245 kbps)                ~6,5 Mo   │
│     Indiscernable du 320, 25 % plus léger.           │
│     Débit variable : à éviter si matériel ancien.    │
│   ▸ Comparer les formats et la compatibilité         │
│                                                      │
│   ☑ Intégrer la pochette                             │
│                                                      │
│   ┌────────────────────────────────────────────────┐ │
│   │        Convertir en MP3 320 kbps               │ │
│   └────────────────────────────────────────────────┘ │
│   Compatible rekordbox · CDJ-2000NXS2 · CDJ-3000     │
├──────────────────────────────────────────────────────┤  ← zone 4 (pendant/après)
│   ████████████████████░░░░░░░░  71 %                 │
│   Encodage en cours…                    [ Annuler ]  │
├──────────────────────────────────────────────────────┤
│   Sans pub · sans traceur · sans compte  ·  Vie…     │  ← pied de page (DEP-3)
└──────────────────────────────────────────────────────┘
```

### 13.2 Composant `FilenamePicker` — spécification détaillée

C'est le composant central du produit. Son API interne :

```ts
type PresetKey = 'title' | 'channel-title' | 'title-channel'
               | 'artist-track' | 'title-year' | 'custom';

interface Preset {
  key: PresetKey;
  label: string;   // libellé i18n, ex. « Chaîne + Titre »
  value: string;   // rendu assaini, sans extension
}

interface FilenamePickerProps {
  presets: Preset[];          // fournis par /api/analyze, hors 'custom'
  defaultPreset: PresetKey;
  value: string;              // état contrôlé : contenu du champ
  selected: PresetKey;        // état contrôlé : modèle actif
  onChange: (value: string, selected: PresetKey) => void;
}
```

Règles de rendu :

- Chaque modèle est un `<label>` contenant un `<input type="radio" name="filename-preset">`,
  ce qui donne gratuitement l'exclusivité mutuelle et la navigation clavier par flèches.
- L'aperçu de chaque modèle est tronqué visuellement par `text-overflow: ellipsis` sur une
  ligne, avec le nom complet en `title` (infobulle) et dans un `aria-describedby`.
- La zone de texte est un `<input type="text">` (pas un `<textarea>` : un nom de fichier
  est mono-ligne), avec `spellcheck="false"` et `autocomplete="off"`.
- Le suffixe `.mp3` est un `<span aria-hidden="true">` visuellement accolé au champ ; le
  champ porte `aria-label="Nom du fichier, sans l'extension .mp3"`.
- Le compteur de caractères est en `aria-live="polite"` et n'annonce que les franchissements
  de seuil (170, 180), pas chaque frappe.

Comportements :

| Événement | Traitement |
|-----------|------------|
| `onChange` d'un radio | `onChange(preset.value, preset.key)` |
| `onInput` du champ | `onChange(e.target.value, 'custom')` |
| Champ vide | Bouton « Convertir » désactivé, message d'erreur inline `role="alert"` |
| > 180 caractères | Saisie tronquée en douceur (pas de blocage brutal), compteur en rouge |
| Clic « Réinitialiser » | `onChange(presetByKey(defaultPreset).value, defaultPreset)` |

### 13.3 Composant `OutputFormatPicker`

```ts
type OutputFormatKey = 'auto' | 'mp3-320' | 'm4a-copy' | 'mp3-v0'

interface FormatOption {
  key: OutputFormatKey
  label: string
  description: string          // §6.3, affichée en permanence
  available: boolean
  unavailableReason?: 'NO_AAC_STREAM' | 'AAC_BELOW_THRESHOLD'
  resolvesTo?: OutputFormatKey // renseigné pour `auto` uniquement
  reason?: string              // motif d'arbitrage de `auto`
  extension: '.mp3' | '.m4a'
  estimatedSizeBytes?: number
}

interface OutputFormatPickerProps {
  options: FormatOption[]      // `formats` de §11.1, ordre préservé
  value: OutputFormatKey
  onChange: (key: OutputFormatKey) => void
}
```

Structure DOM : un `fieldset` + `legend` « Format de sortie », un `input[type=radio]` par
option partageant le même `name`. Chaque description est liée à son radio par
`aria-describedby` — elle est donc lue par les lecteurs d'écran, pas seulement visible.

| Événement / état | Traitement |
|------------------|------------|
| `onChange` d'un radio | `onChange(key)`, persistance `localStorage` |
| Option `available: false` | `disabled`, motif rendu en texte à côté du libellé |
| Sélection courante devenue indisponible | Bascule sur `auto` + `role="status"` : « M4A indisponible pour cette vidéo, format repassé sur Meilleure qualité. » |
| Changement de format | Libellé du bouton de conversion et suffixe d'extension du `FilenamePicker` mis à jour ; **le nom saisi n'est pas touché** |
| Repli « Comparer les formats » | `<details>` fermé par défaut, contenant la matrice de §6.2 |

Le composant est **stateless** sur le nom de fichier : il n'expose que la clé de format.
C'est la page qui recompose `filename + extension` à l'envoi, ce qui garantit qu'aucun
changement de format ne peut corrompre une saisie utilisateur.

### 13.4 États d'interface

| État | Rendu |
|------|-------|
| `idle` | Champ URL seul, focus automatique au chargement. |
| `analyzing` | Squelette animé à la place de la carte vidéo. Bouton en état de chargement, désactivé. |
| `analyzed` | Carte vidéo + sélecteur de nom + bouton « Convertir ». |
| `queued` | Barre indéterminée + « En file d'attente — position 2 sur 5 ». |
| `converting` | Barre déterminée + libellé de phase + bouton « Annuler ». |
| `ready` | Panneau de résultat, téléchargement déclenché, décompte du TTL. |
| `failed` | Panneau d'erreur avec `message`, bouton « Réessayer » si `retryable`. |
| `cancelled` | Retour à l'état `analyzed`, avec une notification discrète. |

### 13.5 Accessibilité (WCAG 2.2 AA)

| ID | Exigence |
|----|----------|
| A11Y-1 | Tout est utilisable au clavier seul, dans un ordre de tabulation logique. |
| A11Y-2 | Contraste minimum 4,5:1 pour le texte, 3:1 pour les composants d'interface, dans les deux thèmes. |
| A11Y-3 | Les changements d'état de job sont annoncés via une région `aria-live="polite"` (`assertive` pour les erreurs). |
| A11Y-4 | La progression utilise `role="progressbar"` avec `aria-valuenow` / `aria-valuemin` / `aria-valuemax`. |
| A11Y-5 | Le focus est déplacé sur le panneau de résultat à la fin de la conversion. |
| A11Y-6 | Aucune information n'est portée par la couleur seule (les erreurs ont une icône et un texte). |
| A11Y-7 | `prefers-reduced-motion` supprime les animations non essentielles. |
| A11Y-8 | Cibles tactiles ≥ 24×24 px (WCAG 2.2 *Target Size Minimum*), 44×44 px visés sur mobile. |
| A11Y-9 | La page a un `<h1>` unique et une hiérarchie de titres cohérente. |

### 13.6 Responsive

| Palier | Largeur | Adaptations |
|--------|---------|-------------|
| Mobile | < 640 px | Colonne unique, miniature pleine largeur au-dessus du texte, cartes de modèles empilées, bouton « Convertir » collant en bas de l'écran. |
| Tablette | 640–1024 px | Mise en page de référence. |
| Bureau | > 1024 px | Idem, largeur de contenu plafonnée à 720 px, centrée. |

### 13.7 Internationalisation

- Langues v1 : **français** (défaut) et **anglais**.
- Détection via `navigator.language`, surchargeable par un sélecteur en en-tête, mémorisé en `localStorage`.
- Aucun texte en dur dans les composants : tous les libellés passent par le dictionnaire i18n.
- Les messages d'erreur serveur sont localisés côté serveur d'après `Accept-Language`, avec le `code` toujours présent pour permettre une localisation côté client.
- Formats de date et de taille localisés via `Intl`.

---

## 14. Gestion des erreurs

### 14.1 Principes

1. Un code d'erreur stable et machine-lisible, plus un message humain déjà localisé.
2. Toujours indiquer **ce que l'utilisateur peut faire** (réessayer, changer d'URL, attendre).
3. Ne jamais afficher de trace technique, de chemin de fichier serveur ni de sortie brute de `yt-dlp` (fuite d'information — §16.5).
4. Un drapeau `retryable` qui pilote l'affichage du bouton « Réessayer ».

### 14.2 Catalogue

| Code | HTTP | Message utilisateur (fr) | Retryable |
|------|------|--------------------------|-----------|
| `INVALID_URL` | 400 | Cette URL n'est pas une adresse de vidéo YouTube valide. | non |
| `INVALID_VIDEO_ID` | 400 | Identifiant de vidéo invalide. | non |
| `INVALID_FILENAME` | 400 | Le nom de fichier est vide ou invalide. | non |
| `INVALID_OUTPUT_FORMAT` | 400 | Format de sortie inconnu. | non |
| `FORMAT_UNAVAILABLE` | 409 | Ce format n'est pas disponible pour cette vidéo. Nous avons resélectionné « Meilleure qualité ». | non |
| `VIDEO_NOT_FOUND` | 404 | Cette vidéo n'existe pas ou a été supprimée. | non |
| `VIDEO_PRIVATE` | 403 | Cette vidéo est privée. | non |
| `VIDEO_AGE_RESTRICTED` | 403 | Cette vidéo est soumise à une restriction d'âge et ne peut pas être convertie. | non |
| `VIDEO_GEO_BLOCKED` | 403 | Cette vidéo n'est pas disponible depuis la zone géographique du serveur. | non |
| `VIDEO_MEMBERS_ONLY` | 403 | Cette vidéo est réservée aux membres de la chaîne. | non |
| `VIDEO_BLOCKED` | 403 | Cette vidéo n'est pas disponible sur ce service. | non |
| `VIDEO_IS_LIVE` | 409 | Les diffusions en direct ne peuvent pas être converties tant qu'elles ne sont pas terminées. | non |
| `VIDEO_TOO_LONG` | 413 | Cette vidéo dure {durée}. La limite est de {limite}. | non |
| `NO_AUDIO_STREAM` | 422 | Aucune piste audio exploitable n'a été trouvée pour cette vidéo. | non |
| `RATE_LIMITED` | 429 | Trop de demandes. Réessayez dans {délai}. | oui |
| `QUEUE_FULL` | 503 | Le service est saturé. Réessayez dans quelques minutes. | oui |
| `STORAGE_FULL` | 507 | Le service manque d'espace disque. Réessayez plus tard. | oui |
| `DOWNLOAD_FAILED` | 502 | Le téléchargement du flux audio a échoué. | oui |
| `DOWNLOAD_TIMEOUT` | 504 | Le téléchargement a pris trop de temps. | oui |
| `CONVERSION_FAILED` | 500 | La conversion a échoué. | oui |
| `ENCODING_TIMEOUT` | 504 | L'encodage a pris trop de temps. | oui |
| `TAGGING_FAILED` | 500 | L'écriture des métadonnées a échoué. | oui |
| `JOB_NOT_FOUND` | 404 | Cette conversion est introuvable ou a expiré. | non |
| `JOB_NOT_READY` | 409 | Le fichier n'est pas encore prêt. | oui |
| `JOB_NOT_CANCELLABLE` | 409 | Cette conversion ne peut plus être annulée. | non |
| `FILE_EXPIRED` | 404 | Ce fichier a expiré. Relancez la conversion. | non |
| `INVALID_TOKEN` | 403 | Lien de téléchargement invalide. | non |
| `UPSTREAM_ERROR` | 502 | YouTube est momentanément inaccessible. Réessayez. | oui |

### 14.3 Traduction des erreurs `yt-dlp`

Le service `metadata.ts` mappe la sortie d'erreur de `yt-dlp` vers les codes ci-dessus par
motifs, **avec repli sur `UPSTREAM_ERROR`** pour tout motif inconnu. La sortie brute est
journalisée côté serveur mais jamais renvoyée au client.

| Motif dans stderr | Code |
|-------------------|------|
| `Video unavailable` | `VIDEO_NOT_FOUND` |
| `Private video` | `VIDEO_PRIVATE` |
| `Sign in to confirm your age` / `age-restricted` | `VIDEO_AGE_RESTRICTED` |
| `not available in your country` / `blocked it on copyright grounds` | `VIDEO_GEO_BLOCKED` |
| `members-only` / `join this channel` | `VIDEO_MEMBERS_ONLY` |
| `This live event will begin` / `is live` | `VIDEO_IS_LIVE` |
| `Sign in to confirm you're not a bot` | `UPSTREAM_ERROR` (voir §16.6) |
| `Requested format is not available` | `NO_AUDIO_STREAM` |
| *(autre)* | `UPSTREAM_ERROR` |

### 14.4 Résilience

- **Reprises** : `yt-dlp` est invoqué avec `--retries 3 --fragment-retries 5`. Une reprise applicative supplémentaire (1 seule) est tentée sur `DOWNLOAD_FAILED`.
- **Dégradation** : si SSE échoue (proxy non compatible), le client bascule automatiquement sur un sondage `GET /api/jobs/:id` toutes les 2 s.
- **Nettoyage** : tout job qui quitte un état non terminal supprime ses fichiers temporaires, y compris en cas de `SIGTERM` du serveur (gestionnaire d'arrêt propre).

---

## 15. Exigences non fonctionnelles

| ID | Exigence | Cible | Mesure |
|----|----------|-------|--------|
| NFR-01 | Latence de l'analyse | p95 < 3 s | Métrique serveur |
| NFR-02 | Durée totale (vidéo 5 min, serveur non chargé) | p95 < 30 s | Test e2e chronométré |
| NFR-03 | Débit de conversion | ≥ 10× temps réel | Bench ffmpeg |
| NFR-04 | Première peinture utile (LCP) | < 1,5 s en 4G simulée | Lighthouse CI |
| NFR-05 | Poids du bundle JS initial | < 150 Ko gzip | Build report |
| NFR-06 | Score Lighthouse (Perf / A11y / Best practices) | ≥ 95 chacun | Lighthouse CI |
| NFR-07 | Empreinte mémoire serveur au repos | < 200 Mo | Métrique |
| NFR-08 | Empreinte mémoire par job actif | < 150 Mo | Métrique |
| NFR-09 | Disponibilité | 99 % mensuel (déploiement public) | Sonde externe |
| NFR-10 | Navigateurs pris en charge | 2 dernières versions de Chrome, Firefox, Safari, Edge ; Safari iOS 16+ ; Chrome Android | Matrice e2e |
| NFR-11 | Fonctionnement sans JavaScript | Message explicite « JavaScript est nécessaire » via `<noscript>` | Manuel |
| NFR-12 | Taille d'image Docker | < 500 Mo | CI |

---

## 16. Sécurité

### 16.1 Surface d'attaque et mesures

| Menace | Mesure |
|--------|--------|
| **Injection de commande** via l'URL ou le nom de fichier | Aucun appel shell. `spawn()` avec tableau d'arguments exclusivement, `shell: false`. Le nom de fichier n'est **jamais** passé à un processus externe : le fichier sur disque est nommé `{jobId}.mp3`. |
| **Traversée de chemin** via le nom de fichier | Le nom utilisateur n'atteint jamais le système de fichiers (voir ci-dessus). L'assainissement §8.5 s'applique en plus. |
| **SSRF** via l'URL fournie | L'URL n'est jamais récupérée telle quelle : seul le `videoId` extrait et validé (`^[A-Za-z0-9_-]{11}$`) est transmis à `yt-dlp`, sous la forme canonique `https://www.youtube.com/watch?v={id}`. |
| **SSRF** via le proxy de miniature | Liste blanche stricte de domaines (`i.ytimg.com`, `img.youtube.com`), chemin reconstruit à partir du `videoId`, jamais d'URL fournie par le client. |
| **Injection d'en-tête HTTP** via `Content-Disposition` | Encodage RFC 5987 + suppression des CR/LF (déjà couverte par l'étape 2 de §8.5). |
| **XSS** | React échappe par défaut ; aucun `dangerouslySetInnerHTML` ; CSP stricte (§16.2). |
| **Épuisement de ressources** | Limites de débit, plafond de concurrence, quota disque, délais de garde, limite de durée de vidéo. |
| **Énumération de jobs** | `jobId` = ULID (26 caractères, non séquentiel) ; jeton de téléchargement supplémentaire (§16.4). |
| **Exécution de code via ffmpeg/yt-dlp** | Binaires épinglés par version et somme de contrôle dans l'image Docker ; processus lancés sans privilège. |
| **Fichier malveillant en sortie** | `Content-Type: audio/mpeg` fixe + `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`. |

### 16.2 En-têtes de sécurité

```
Content-Security-Policy: default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  media-src 'self';
  connect-src 'self';
  font-src 'self';
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

La CSP sert directement l'exigence PUB-3 : elle rend techniquement impossible le chargement
d'un script publicitaire, même par erreur.

### 16.3 Isolation d'exécution

- Le conteneur tourne en utilisateur non-root (`uid 10001`).
- Système de fichiers racine en lecture seule, sauf `STORAGE_PATH` et `/tmp` (montés `noexec,nosuid,nodev`).
- Capacités Linux toutes retirées (`cap_drop: ALL`).
- `no-new-privileges: true`.
- Limites `ulimit` sur le nombre de processus et de descripteurs de fichiers.
- Chaque conversion est un processus enfant tué par groupe (`process.kill(-pid)`) à l'annulation ou au délai de garde, pour ne pas laisser d'orphelin `ffmpeg`.

### 16.4 Jeton de téléchargement

`token = base64url(HMAC-SHA256(secret, jobId + "|" + expiresAt))`, tronqué à 32 caractères.
Vérifié en temps constant. Le secret est généré au démarrage (ou fourni par
`DOWNLOAD_TOKEN_SECRET` si l'on veut que les liens survivent à un redémarrage).

### 16.5 Journalisation

- Aucune donnée personnelle dans les journaux applicatifs.
- L'adresse IP n'est journalisée que sous forme **hachée et salée** (sel tournant quotidiennement), et uniquement pour la limitation de débit.
- Les sorties brutes de `yt-dlp` / `ffmpeg` sont journalisées au niveau `debug` uniquement, jamais renvoyées au client.

### 16.6 Cookies de session YouTube (option auto-hébergée)

Certaines vidéos (restriction d'âge, contenu réservé aux membres, vidéos privées de
l'opérateur, vérification anti-robot) ne sont accessibles qu'avec une session authentifiée.
`yt-dlp` sait consommer un fichier de cookies pour ces cas.

**Comportement par défaut : désactivé.** Un fichier de cookies est un secret de niveau
« mot de passe » : quiconque le lit obtient l'accès au compte Google associé. Le stocker sur
un serveur est un risque à assumer sciemment, pas un défaut de configuration.

Si `YTDLP_COOKIES_PATH` est renseigné, le service :

| Règle | Détail |
|-------|--------|
| CK-1 | Vérifie au démarrage que le fichier a des permissions `0600` et appartient à l'utilisateur du service ; refuse de démarrer sinon. |
| CK-2 | Monte le fichier en **lecture seule** dans le conteneur, hors de `STORAGE_PATH`. |
| CK-3 | Passe `--cookies` à `yt-dlp` **sans jamais journaliser** le chemin ni le contenu. |
| CK-4 | N'expose aucun indicateur d'authentification côté client : l'interface ne dit pas « connecté ». |
| CK-5 | Expose sur `/ready` un booléen `cookiesConfigured` (jamais le chemin), pour diagnostic. |
| CK-6 | Recommande un **compte Google dédié**, sans données personnelles, distinct du compte principal de l'opérateur. |

Quand l'option est active, les codes `VIDEO_AGE_RESTRICTED` et `VIDEO_MEMBERS_ONLY` ne sont
plus émis pour les contenus que la session couvre : la conversion se déroule normalement.
Quand elle est inactive (défaut), ces codes sont retournés tels que décrits en §14.2, et une
demande de vérification anti-robot de YouTube produit `UPSTREAM_ERROR`.

---

## 17. Cycle de vie des fichiers et vie privée

### 17.1 Cycle de vie

| Objet | Durée de vie | Purge |
|-------|--------------|-------|
| Fichier temporaire de téléchargement (`{jobId}.tmp`) | Le temps du job | Supprimé dès l'encodage terminé, et à l'échec/annulation |
| MP3 produit (`{jobId}.mp3`) | `FILE_TTL_MINUTES` (30 min) | Tâche de purge toutes les 60 s |
| Enregistrement de job en mémoire | TTL + 10 min | Purge en même temps |
| Cache de métadonnées | 15 min | LRU + TTL |
| Miniature en cache | 60 min | LRU |

Si `STORAGE_QUOTA_MB` est atteint, la purge devient agressive : suppression des fichiers
`ready` par ordre d'ancienneté jusqu'à repasser sous 80 % du quota, et les nouveaux jobs
sont refusés avec `STORAGE_FULL` tant que le seuil n'est pas respecté.

### 17.2 Ce qui n'est pas fait

- Aucun compte, aucun mot de passe.
- Aucun cookie applicatif (ni de session, ni de préférence — les préférences sont en `localStorage`, qui ne transite pas par le réseau et ne requiert pas de bandeau de consentement au sens de la directive ePrivacy pour un usage strictement fonctionnel).
- Aucun stockage de l'historique des conversions d'un utilisateur.
- Aucun partage de données avec un tiers.

### 17.3 Données traitées

| Donnée | Finalité | Conservation | Base |
|--------|----------|--------------|------|
| IP hachée + salée | Limitation de débit, protection anti-abus | 24 h (rotation du sel) | Intérêt légitime |
| `videoId` demandé | Exécution de la conversion | Durée du job + TTL | Exécution du service |
| Compteurs agrégés (nombre de conversions, taux d'erreur) | Exploitation | 90 j | Intérêt légitime |
| Fichier MP3 produit | Livraison à l'utilisateur | 30 min | Exécution du service |

Aucune de ces données ne permet, seule, de réidentifier un utilisateur. La page
**Confidentialité** (DEP-3) reprend ce tableau en clair.

---

## 18. Observabilité

### 18.1 Journaux structurés

Format JSON ligne, champs communs : `ts`, `level`, `msg`, `requestId`, `jobId`.
Événements notables : `job.created`, `job.started`, `job.phase`, `job.completed`,
`job.failed`, `job.cancelled`, `job.expired`, `storage.purged`, `ratelimit.hit`.

### 18.2 Métriques (format Prometheus, `/metrics`, protégé)

| Métrique | Type | Étiquettes |
|----------|------|------------|
| `yt2mp3_analyze_duration_seconds` | histogram | `outcome` |
| `yt2mp3_job_duration_seconds` | histogram | `phase`, `outcome` |
| `yt2mp3_jobs_total` | counter | `state` |
| `yt2mp3_jobs_active` | gauge | — |
| `yt2mp3_queue_length` | gauge | — |
| `yt2mp3_errors_total` | counter | `code` |
| `yt2mp3_storage_bytes` | gauge | — |
| `yt2mp3_output_size_bytes` | histogram | — |
| `yt2mp3_source_bitrate_kbps` | histogram | `codec` |

### 18.3 Analytique produit

Si une analytique est souhaitée, elle est **auto-hébergée, sans cookie, sans identifiant
d'utilisateur** (compteurs agrégés serveur uniquement). Aucun service tiers, conformément à
PUB-2. En pratique, les métriques du §18.2 suffisent : aucune brique d'analytique
supplémentaire n'est prévue en v1.

### 18.4 Sondes

- `GET /health` — vivacité (200 si le processus répond).
- `GET /ready` — disponibilité : vérifie la présence et la version de `yt-dlp` et `ffmpeg`, l'accessibilité en écriture de `STORAGE_PATH`, et le niveau de remplissage du quota.

---

## 19. Stratégie de test

### 19.1 Tests unitaires (Vitest)

| Module | Ce qui est couvert |
|--------|--------------------|
| `filename.ts` — modèles | Rendu de chaque modèle avec titres/chaînes variés, y compris caractères non latins et emoji |
| `filename.ts` — assainissement | Chaque règle de §8.5, plus : noms réservés Windows, traversée `../`, CRLF injecté, chaîne de 500 caractères, emoji en position de troncature, chaîne vide, chaîne d'espaces |
| `artistDetect.ts` | Les 8 cas de §8.4 + fuzzing sur 500 titres réels échantillonnés |
| `urlParser.ts` | Toutes les formes de F-01/F-02 + URL malveillantes (`javascript:`, `data:`, hôte homographe) |
| `queue.ts` | Concurrence, ordre FIFO, file pleine, annulation en attente et en cours |
| `errors.ts` | Mapping de §14.3, y compris le repli sur motif inconnu |

### 19.2 Tests d'intégration

| Scénario |
|----------|
| `/api/analyze` avec un `yt-dlp` bouchonné : réponse conforme au contrat §11.1 |
| Job complet sur un fichier audio local bouchonné, **une fois par format** : `ffprobe` vérifie que `mp3-320` donne 320 kbps CBR, que `mp3-v0` est VBR avec en-tête Xing valide, que `m4a-copy` a un flux **identique bit pour bit** à la source, et que dans les trois cas la fréquence et le nombre de canaux de la source sont **inchangés** |
| Vérification des tags ID3 écrits (via `ffprobe -show_format`) |
| Vérification de la présence et des dimensions de la pochette intégrée |
| `Content-Disposition` correct pour un nom contenant accents, cyrillique, emoji, guillemets |
| Annulation en cours de job : aucun processus orphelin (vérification `ps`), aucun fichier résiduel |
| Purge TTL : fichier absent et `FILE_EXPIRED` retourné après expiration |
| Jeton de téléchargement invalide ou falsifié → 403 |
| Quota disque atteint → `STORAGE_FULL` |

### 19.3 Tests end-to-end (Playwright)

| Scénario |
|----------|
| Parcours nominal complet jusqu'au téléchargement (fichier récupéré et vérifié) |
| Changement de modèle de nom → la zone de texte est bien écrasée |
| Édition manuelle → la sélection bascule sur `custom` |
| Édition manuelle puis clic sur un modèle → lien « Annuler » présent et fonctionnel |
| Champ de nom vidé → bouton « Convertir » désactivé |
| URL invalide → message inline, aucun appel réseau (interception) |
| Navigation clavier complète du sélecteur de modèles (flèches, Tab, Espace) |
| **Aucune requête réseau vers un domaine tiers** sur l'ensemble du parcours (PUB-2/PUB-3) |
| Rechargement de page pendant une conversion → état restauré depuis `/#/job/:id` |
| Repli SSE → sondage lorsque `EventSource` est indisponible |
| Rendu correct en 375 px et 1440 px de large |
| Thèmes clair et sombre : contrastes vérifiés automatiquement (axe-core) |

### 19.4 Tests d'accessibilité

`axe-core` exécuté sur chaque état d'interface de §13.3, seuil : **zéro violation de niveau
`serious` ou `critical`**. Vérification manuelle avec VoiceOver et NVDA sur le parcours
nominal avant chaque version majeure.

### 19.5 Tests de charge

`k6`, profil : montée à 20 utilisateurs simultanés sur 5 min. Critères : aucune erreur 5xx
hors `QUEUE_FULL`, p95 de `/api/analyze` < 3 s, mémoire serveur stable (pas de fuite
observable sur 30 min).

### 19.6 Portail de qualité (CI)

Un commit est refusé si : couverture < 80 % sur `packages/shared` et `packages/server/src/services`,
un test échoue, le linter ou le vérificateur de types échoue, une violation a11y `serious`+
est détectée, une dépendance tierce publicitaire est introduite, ou une requête réseau
tierce est observée pendant les tests e2e.

---

## 20. Déploiement et exploitation

### 20.1 Image Docker

Multi-stage :

1. **build-web** — compile le frontend.
2. **build-server** — compile le backend TypeScript.
3. **runtime** — `node:22-alpine`, installe `ffmpeg` depuis les paquets, télécharge `yt-dlp` à une **version épinglée** avec vérification de somme de contrôle, copie les artefacts, crée l'utilisateur non-root, définit `HEALTHCHECK`.

Les versions de `yt-dlp` et `ffmpeg` sont inscrites dans le `Dockerfile` sous forme
d'arguments de build, et exposées par `/ready` pour être vérifiables en production.

### 20.2 Mise à jour de `yt-dlp`

YouTube change régulièrement ; `yt-dlp` publie fréquemment. Procédure :

- Une tâche CI hebdomadaire vérifie la dernière version de `yt-dlp`, ouvre une pull request qui met à jour l'argument de build, et exécute la suite de tests d'intégration contre un jeu de vidéos de référence sous licence libre.
- L'échec de la sonde `/ready` ou une hausse du taux de `UPSTREAM_ERROR` au-delà de 10 % sur 15 min déclenche une alerte.

### 20.3 Déploiement

`docker compose up` avec un volume nommé pour `STORAGE_PATH`, derrière un reverse proxy
terminant TLS. Le reverse proxy doit :

- désactiver la mise en tampon de la réponse sur `/api/jobs/*/events` (SSE),
- autoriser un délai de lecture d'au moins 60 s,
- ne pas ajouter d'en-tête `Server` ni de page d'erreur tierce.

Arrêt propre : sur `SIGTERM`, le serveur cesse d'accepter de nouveaux jobs, laisse les jobs
en cours se terminer (limite 30 s), puis tue les processus restants et nettoie les fichiers
temporaires.

---

## 21. Hors périmètre v1 et évolutions

| Version | Fonctionnalité | Note |
|---------|----------------|------|
| v1.1 | **Playlists** (sélection des pistes, conversion en lot, archive ZIP) | Impact fort sur la file et le quota disque |
| v1.1 | **Redis + BullMQ** pour la file | Nécessaire dès qu'il y a plusieurs instances |
| v1.2 | **Autres formats** : Opus (copie sans réencodage — qualité réellement supérieure), M4A, WAV, FLAC | Le format « copie du flux source » mérite d'être proposé : c'est objectivement meilleur que le MP3 320 |
| v1.2 | **Découpe** : début/fin, extraction d'un passage | Interface de sélection sur la forme d'onde |
| v1.2 | **Normalisation de volume** (EBU R128 / ReplayGain) | Optionnelle, désactivée par défaut |
| v1.3 | **SponsorBlock** : découpe des segments sponsorisés | Voir §7.3, désactivé par défaut |
| v1.3 | **Édition manuelle des tags ID3** avant conversion | Champs artiste/album/année éditables |
| v1.3 | **Découpe par chapitres** YouTube en pistes séparées | Utile pour les albums complets |
| v2 | **PWA / téléchargement hors-ligne** | |
| v2 | **API publique documentée** avec clés | Suppose un modèle d'authentification et de quota |
| — | **Recherche de vidéos dans l'application** | **Hors périmètre** (DEP-4) : élargit la surface fonctionnelle sans servir le cas d'usage |
| — | **Bibliothèque publique des fichiers convertis** | **Hors périmètre** (DEP-4) : incompatible avec le stockage éphémère (§17) |

---

## 22. Critères d'acceptation

La v1 est considérée comme livrée lorsque **tous** les points suivants sont vérifiés :

### Fonctionnel

- [ ] Coller une URL YouTube valide affiche les métadonnées en moins de 3 s (p95).
- [ ] Toutes les formes d'URL de F-01 sont acceptées ; les autres sont rejetées côté client.
- [ ] Au moins 5 modèles de nom sont proposés, chacun affichant un aperçu réel.
- [ ] Les modèles sont mutuellement exclusifs (un seul sélectionné à la fois).
- [ ] Sélectionner un modèle met immédiatement à jour la zone de texte.
- [ ] La zone de texte est éditable, et l'éditer bascule la sélection sur « Personnalisé ».
- [ ] Un lien « Annuler » permet de récupérer une saisie manuelle écrasée par un modèle.
- [ ] Le fichier téléchargé porte exactement le nom saisi, suivi de `.mp3`.
- [ ] Les quatre formats de sortie sont proposés, décrits, et `m4a-copy` est grisé et motivé quand la source n'a pas d'AAC.
- [ ] `ffprobe` confirme sur `mp3-320` : `bit_rate = 320000`, CBR, `sample_rate` et `channels` identiques à la source.
- [ ] `ffprobe` confirme sur `m4a-copy` : flux AAC identique bit pour bit à la source.
- [ ] Les fichiers produits s'importent dans rekordbox et s'analysent sans erreur.
- [ ] Les tags (ID3v2.3 / atomes MP4) et la pochette sont présents et corrects.
- [ ] La progression est affichée, monotone, et l'annulation fonctionne.
- [ ] Un job échoué et *retryable* propose un bouton « Réessayer » fonctionnel.
- [ ] Le fichier est supprimé du serveur après le TTL, et l'URL retourne alors `FILE_EXPIRED`.

### Absence de publicité

- [ ] Aucune requête réseau vers un domaine tiers sur l'ensemble du parcours (vérifié en e2e).
- [ ] La CSP est en place et ne contient ni wildcard d'hôte ni `unsafe-inline` en `script-src`.
- [ ] Aucune dépendance publicitaire ou de tracking dans l'arbre de dépendances.
- [ ] Aucun *dark pattern* : un seul bouton de téléchargement, aucun compte à rebours, aucun onglet non sollicité.

### Qualité et robustesse

- [ ] Score Lighthouse ≥ 95 sur Performance, Accessibilité et Bonnes pratiques.
- [ ] Zéro violation axe-core de niveau `serious` ou `critical` sur chaque état d'interface.
- [ ] Parcours complet réalisable au clavier seul.
- [ ] Couverture de tests ≥ 80 % sur `shared` et `server/services`.
- [ ] Les 8 cas de détection artiste/morceau de §8.4 passent.
- [ ] Les tests d'assainissement de nom passent, y compris traversée de chemin, CRLF, noms réservés Windows et emoji en frontière de troncature.
- [ ] Aucun processus orphelin après annulation ou délai de garde.
- [ ] Test de charge à 20 utilisateurs simultanés sans 5xx inattendu ni fuite mémoire.

### Exploitation

- [ ] Page Confidentialité publiée, conforme au tableau de §17.3.
- [ ] Liste de blocage opérationnelle et testée (DEP-2), rechargeable à chaud.
- [ ] Le service démarre sans `YTDLP_COOKIES_PATH` ; s'il est renseigné avec des permissions trop larges, le démarrage échoue (CK-1).
- [ ] `/health` et `/ready` répondent correctement, `/ready` expose les versions de `yt-dlp` et `ffmpeg`.
- [ ] L'arrêt propre ne laisse ni processus ni fichier temporaire.

---

## 23. Glossaire

| Terme | Définition |
|-------|------------|
| **CBR** | *Constant Bit Rate* — débit constant. Garantit 320 kbps sur toute la durée du fichier. |
| **VBR** | *Variable Bit Rate* — débit variable. Meilleur rapport taille/qualité, mais ne garantit pas un débit fixe. |
| **Opus** | Codec audio moderne, très efficace à bas débit. Format audio principal de YouTube. |
| **AAC** | *Advanced Audio Coding* — codec du conteneur M4A, second format audio de YouTube. |
| **itag** | Identifiant numérique d'un format de flux chez YouTube. |
| **ID3** | Standard de métadonnées embarquées dans un fichier MP3. |
| **SSE** | *Server-Sent Events* — flux HTTP unidirectionnel serveur → client, utilisé pour la progression. |
| **TTL** | *Time To Live* — durée de vie avant suppression automatique. |
| **ULID** | Identifiant unique triable lexicographiquement, non séquentiel et non devinable. |
| **CSP** | *Content Security Policy* — en-tête HTTP restreignant les origines de ressources autorisées. |
| **SponsorBlock** | Base communautaire de segments sponsorisés horodatés dans les vidéos YouTube. |
| **Transcodage** | Réencodage d'un média déjà compressé vers un autre format compressé — génération de perte supplémentaire. |

---

## 24. Décisions actées (ADR condensés)

| # | Décision | Alternative écartée | Raison |
|---|----------|---------------------|--------|
| D-01 | Encodage systématique en 320 kbps CBR | Débit adaptatif selon la source | Exigence produit explicite ; constance et prévisibilité pour l'utilisateur. Le surcoût en taille est acceptable. |
| D-02 | Affichage honnête du débit source | Ne montrer que « 320 kbps » | P6. Ne pas laisser croire à une qualité que la source ne possède pas. |
| D-03 | MP3 seul en v1 | Proposer Opus/M4A dès la v1 | Simplicité du produit. Le format « copie sans réencodage » est reporté en v1.2 alors qu'il serait techniquement supérieur — c'est un compromis assumé face à la demande initiale. |
| D-04 | Fichier disque nommé `{jobId}.mp3`, nom utilisateur uniquement dans `Content-Disposition` | Écrire le nom choisi sur disque | Supprime en une décision les classes traversée de chemin, collision et injection de commande. |
| D-05 | Assainissement du nom dans `shared/`, exécuté côté client **et** serveur | Assainir seulement côté serveur | L'aperçu doit être fidèle au fichier réel ; une seule implémentation évite toute dérive. |
| D-06 | `custom` comme témoin d'état non cliquable | Bouton « Personnalisé » cliquable | Un bouton qui ne fait rien de plus que « rester où l'on est » est du bruit. Le basculement automatique est plus direct. |
| D-07 | Écrasement de la saisie sans dialogue de confirmation, mitigé par un lien « Annuler » | Boîte de dialogue de confirmation | Une modale sur chaque changement de modèle briserait complètement la fluidité de la sélection. |
| D-08 | File en mémoire en v1, derrière une interface | Redis dès la v1 | Une seule instance suffit à l'usage visé ; l'abstraction préserve la voie de migration. |
| D-09 | SSE plutôt que WebSocket | WebSocket | Flux unidirectionnel, plus simple, traverse mieux les proxys, repli par sondage trivial. |
| D-10 | Cookies YouTube en option désactivée par défaut | Activés d'office, ou absents du produit | Un fichier de cookies est un secret équivalent à un mot de passe de compte Google : le stocker doit rester un choix explicite de l'opérateur (§16.6). |
| D-11 | Miniatures servies par proxy | Chargement direct depuis `i.ytimg.com` | Aucune requête tierce depuis le navigateur (PUB-3), et la CSP reste stricte. |
| D-12 | Pas de recherche intégrée | Champ de recherche YouTube | DEP-4 : le produit répond à « j'ai une URL » ; une recherche doublerait la surface fonctionnelle sans améliorer ce parcours. |
| D-13 | Pas de bandeau cookie | Bandeau de consentement | Il n'y a aucun cookie ni traceur : un bandeau serait un dark pattern inversé. |
| D-14 | **Conserver la fréquence source (48 kHz)** | Rééchantillonner en 44,1 kHz | Décision inversée après vérification des specs Pioneer : le MP3 et l'AAC à 48 kHz sont supportés par rekordbox, le CDJ-2000NXS2 et le CDJ-3000. Le rééchantillonnage n'était donc justifié par aucune contrainte de compatibilité, et ajoutait une étape destructrice à rapport non entier. Reste disponible via `FORCE_44100` pour du matériel hors gamme. |
| D-15 | Exposer 4 formats plutôt qu'un seul | Imposer le MP3 320 | Les compromis (fidélité, taille, compatibilité du matériel ancien) dépendent du contexte de l'utilisateur, pas du nôtre. Le mode `auto` évite de reporter la charge de décision sur qui ne veut pas choisir. |
| D-16 | Exclure Opus de la sortie | Le proposer, c'est le meilleur codec | Aucun matériel Pioneer ne le lit (§6.2). Un fichier illisible en cabine n'a aucune valeur, quelle que soit sa qualité. |
| D-17 | Exclure WAV/FLAC de la sortie | Les proposer, le matériel les lit | La source YouTube est déjà lossy : ils produiraient des fichiers 10× plus lourds sans gain, en suggérant une qualité « CD » inexistante. |
