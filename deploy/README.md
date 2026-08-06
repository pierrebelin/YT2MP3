# Déploiement

VPS IONOS `217.160.62.104`, Debian 13 (trixie). Service systemd sur `127.0.0.1:3000`, déployé
par GitHub Actions en rsync SSH. Nginx + certbot : gérés à part.

Tout vit sous le compte `yt2mp3` :

```
/home/yt2mp3/
├── app/                 code déployé par la CI
├── data/{files,tmp}     stockage éphémère
└── env                  variables d'environnement
```

## 1. Préparation du serveur

En root sur le VPS, une seule fois :

```bash
# trixie fournit Node 20, suffisant pour ce projet (engines: node >=20).
apt update && apt install -y ffmpeg rsync curl sudo nodejs
node --version   # doit afficher v20 ou plus

# yt-dlp : binaire officiel (apt est trop vieux, et `yt-dlp -U` n'agit que sur ce binaire)
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod 755 /usr/local/bin/yt-dlp

# Utilisateur du service, également cible SSH de la CI
useradd -m -d /home/yt2mp3 -s /bin/bash yt2mp3
sudo -u yt2mp3 mkdir -p /home/yt2mp3/app /home/yt2mp3/data/files /home/yt2mp3/data/tmp

# Redémarrage du service depuis la CI, et rien d'autre en root
echo 'yt2mp3 ALL=(root) NOPASSWD: /usr/bin/systemctl restart yt2mp3' > /etc/sudoers.d/yt2mp3
chmod 440 /etc/sudoers.d/yt2mp3 && visudo -c -f /etc/sudoers.d/yt2mp3

# yt-dlp à jour : YouTube casse l'extraction régulièrement
echo '0 4 * * * root /usr/local/bin/yt-dlp -U -q && systemctl try-restart yt2mp3' \
  > /etc/cron.d/yt-dlp-update
```

Puis, depuis le poste local, envoyer les deux fichiers de config :

```bash
scp deploy/env.example root@217.160.62.104:/home/yt2mp3/env
scp deploy/yt2mp3.service root@217.160.62.104:/etc/systemd/system/yt2mp3.service
```

Et activer :

```bash
ssh root@217.160.62.104 'chown root:yt2mp3 /home/yt2mp3/env && chmod 640 /home/yt2mp3/env
systemctl daemon-reload && systemctl enable yt2mp3'
```

Le service ne démarrera qu'après le premier déploiement (`/home/yt2mp3/app` encore vide).

## 2. Clé SSH pour la CI

En local, sans passphrase — un runner ne peut pas la saisir :

```bash
ssh-keygen -t ed25519 -C "github-actions-yt2mp3" -N "" -f ~/.ssh/yt2mp3_deploy
ssh-copy-id -i ~/.ssh/yt2mp3_deploy.pub yt2mp3@217.160.62.104
```

Si `yt2mp3` n'a pas de mot de passe, passer par root :

```bash
ssh root@217.160.62.104 'install -d -m 700 -o yt2mp3 -g yt2mp3 /home/yt2mp3/.ssh'
cat ~/.ssh/yt2mp3_deploy.pub | ssh root@217.160.62.104 \
  'cat >> /home/yt2mp3/.ssh/authorized_keys
   chown yt2mp3:yt2mp3 /home/yt2mp3/.ssh/authorized_keys
   chmod 600 /home/yt2mp3/.ssh/authorized_keys'
```

Test :

```bash
ssh -i ~/.ssh/yt2mp3_deploy yt2mp3@217.160.62.104 'sudo -n systemctl restart yt2mp3; echo ok'
```

## 3. Secrets GitHub

Dépôt → Settings → Secrets and variables → Actions → *New repository secret*.

| Secret | Contenu |
|---|---|
| `DEPLOY_SSH_KEY` | `~/.ssh/yt2mp3_deploy` — la clé **privée**, en entier |
| `DEPLOY_KNOWN_HOSTS` | sortie de `ssh-keyscan -t ed25519 217.160.62.104` |

```bash
pbcopy < ~/.ssh/yt2mp3_deploy
ssh-keyscan -t ed25519 217.160.62.104 | grep -v '^#' | pbcopy
```

`-t ed25519` suffit : c'est la clé qu'OpenSSH négocie en priorité, et une seule ligne est plus
simple à vérifier qu'un mélange rsa/ecdsa/ed25519.

`DEPLOY_KNOWN_HOSTS` évite `StrictHostKeyChecking=no` : sans lui, la CI se connecterait à
n'importe quel serveur répondant à cette adresse.

L'IP et l'utilisateur sont en clair dans [deploy.yml](../.github/workflows/deploy.yml) — rien
de secret, seule la clé privée l'est.

## 4. Déployer

`git push origin main` déclenche le workflow : rsync vers `/home/yt2mp3/app`, `systemctl
restart`, vérification de `/healthz`. Relance manuelle via *Actions → Déploiement → Run
workflow*.

## 5. Nginx (à ta main)

Le service écoute sur `127.0.0.1:3000`. Deux points spécifiques à cette app dans le vhost :

```nginx
# SSE (/api/jobs/:id/events) et téléchargement du MP3 : sans ceci la progression arrive
# d'un bloc en fin de job et les gros fichiers transitent par un temporaire sur disque.
location /api/jobs/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 1h;
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

`X-Forwarded-For` est indispensable : le serveur limite le débit par IP, et avec `TRUST_PROXY=1`
il lit cet en-tête. Sans lui, tout le trafic compte sur `127.0.0.1` et les 20 analyses / 10 min
sont partagées par l'ensemble des visiteurs.

## Exploitation

```bash
systemctl status yt2mp3
journalctl -u yt2mp3 -f
```

`yt-dlp` renvoie `Sign in to confirm you're not a bot` : les IP de datacenter sont souvent
challengées par YouTube. D'abord vérifier que `yt-dlp -U` est passé ; sinon, déposer des
cookies en `/home/yt2mp3/cookies.txt` et ajouter
`YTDLP_COOKIES_PATH=/home/yt2mp3/cookies.txt` dans `/home/yt2mp3/env`.
