// Publication de la vidéo du jour : Instagram (Reel, via API) + Telegram (copie pour TikTok).
// Variables : IG_TOKEN, IG_USER_ID, [IG_HOST], VIDEO_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WAIT_UNTIL_PUBLISH=1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out');
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const post = JSON.parse(fs.readFileSync(path.join(OUT, 'post.json'), 'utf8'));
const env = process.env;
const log = (...a) => console.log('[publish]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (post.skip) { log('Rien à publier.'); process.exit(0); }

// ---------- attendre l'heure de publication (heure de Paris) ----------
function parisNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  return (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second);
}
if (env.WAIT_UNTIL_PUBLISH === '1') {
  const [h, m] = cfg.heurePublication.split(':').map(Number);
  const wait = h * 3600 + m * 60 - parisNow();
  if (wait > 0 && wait < 6 * 3600) { log(`Attente ${Math.round(wait / 60)} min jusqu'à ${cfg.heurePublication}…`); await sleep(wait * 1000); }
}

const results = {};

// ---------- Instagram ----------
async function instagram() {
  if (!env.IG_TOKEN || !env.IG_USER_ID) return 'non configuré';
  if (!env.VIDEO_URL) throw new Error('VIDEO_URL manquant');
  const host = env.IG_HOST || 'graph.instagram.com';
  const v = 'v21.0';
  const call = async (method, p, params = {}) => {
    const u = new URL(`https://${host}/${v}/${p}`);
    const body = new URLSearchParams({ ...params, access_token: env.IG_TOKEN });
    const r = method === 'GET'
      ? await fetch(u + '?' + body)
      : await fetch(u, { method, body });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`Instagram ${p} : ${JSON.stringify(j.error || j)}`);
    return j;
  };
  const c = await call('POST', `${env.IG_USER_ID}/media`, {
    media_type: 'REELS', video_url: env.VIDEO_URL, caption: post.caption, share_to_feed: 'true',
  });
  log('Conteneur Instagram', c.id);
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const s = await call('GET', c.id, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('Instagram traitement : ' + (s.status || s.status_code));
    if (i === 59) throw new Error('Instagram : traitement trop long');
  }
  const pub = await call('POST', `${env.IG_USER_ID}/media_publish`, { creation_id: c.id });
  return 'publié (id ' + pub.id + ')';
}

// ---------- Telegram (vidéo prête pour TikTok + compte rendu) ----------
async function telegram(text, withVideo) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return 'non configuré';
  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  if (withVideo) {
    const fd = new FormData();
    fd.append('chat_id', env.TELEGRAM_CHAT_ID);
    fd.append('caption', text.slice(0, 1024));
    fd.append('supports_streaming', 'true');
    fd.append('video', new Blob([fs.readFileSync(path.join(OUT, 'video.mp4'))], { type: 'video/mp4' }), 'noor.mp4');
    const r = await fetch(api + '/sendVideo', { method: 'POST', body: fd });
    const j = await r.json(); if (!j.ok) throw new Error('Telegram : ' + j.description);
  } else {
    const r = await fetch(api + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }) });
    const j = await r.json(); if (!j.ok) throw new Error('Telegram : ' + j.description);
  }
  return 'envoyé';
}

try { results.instagram = await instagram(); } catch (e) { results.instagram = 'ÉCHEC — ' + e.message; }
log('Instagram :', results.instagram);

const resume = `🎬 Vidéo du jour — sourate ${post.sourate}, v.${post.de}→${post.a} (${post.recitateur}, ${Math.round(post.duree)} s)
Instagram : ${results.instagram}
TikTok : vidéo ci-dessus, légende ci-dessous ⬇️

${post.caption}`;
try { results.telegram = await telegram(resume, true); } catch (e) { results.telegram = 'ÉCHEC — ' + e.message; }
log('Telegram :', results.telegram);

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
// Échec = Instagram configuré mais pas publié → le workflow ne fait pas avancer la série
if (/^ÉCHEC/.test(results.instagram)) process.exitCode = 1;
// Aucun canal configuré → on ne fait pas avancer la série
if (results.instagram === 'non configuré' && results.telegram === 'non configuré') {
  console.error('Aucun canal de publication configuré (secrets IG_* ou TELEGRAM_*).'); process.exitCode = 1;
}
