# Noor Studio — publication automatique

Chaque jour à 17h (Paris), GitHub Actions :
1. ouvre `noor_studio.html` (Noor Studio 2.4) dans Chromium, format Story 9:16 ;
2. prend la sourate et le verset suivants (`state.json`), du récitateur en cours, et enregistre la plage de versets la plus longue qui tient en ≤ 170 s ;
3. convertit en MP4 H.264/AAC, attend 19h, publie le Reel sur Instagram et envoie la vidéo + légende sur Telegram (pour TikTok) ;
4. avance la série dans `state.json`. Le récitateur change à la fin de chaque sourate.

Si la publication échoue, la série n'avance pas : la même vidéo est refaite le lendemain, et tu reçois une alerte Telegram.

## Réglages
- `config.json` : ordre des sourates, rotation des récitateurs, durée max, heure, hashtags.
- `state.json` : où en est la série (modifiable à la main pour sauter / reprendre).
- `style.json` (optionnel) : ton style Noor Studio. Dans Noor Studio, enregistre ton style (★), puis dans la console du navigateur : `copy(JSON.parse(localStorage.noorPresets).at(-1).data)` et colle le résultat dans ce fichier.

## Secrets (Settings → Secrets and variables → Actions)
| Secret | Rôle |
|---|---|
| `IG_TOKEN` | jeton Instagram (API Instagram avec connexion Instagram) |
| `IG_USER_ID` | identifiant du compte Instagram professionnel |
| `TELEGRAM_BOT_TOKEN` | jeton du bot Telegram (@BotFather) |
| `TELEGRAM_CHAT_ID` | ton identifiant de chat Telegram |
| `GH_PAT` (optionnel) | jeton GitHub (droit « Secrets ») pour renouveler `IG_TOKEN` chaque lundi |

## Test manuel
Actions → « Noor Studio — vidéo du jour » → Run workflow.
