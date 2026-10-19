// Noor Studio — rendu automatique de la vidéo du jour.
// Ouvre Noor Studio dans Chromium, choisit sourate / récitateur / plage de versets
// (≤ dureeMaxSecondes), enregistre la vidéo 9:16, puis la convertit en MP4 H.264/AAC.
// Sorties : out/video.mp4 et out/post.json (légende + nouvel état).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json'), 'utf8'));
const log = (...a) => console.log('[noor]', ...a);

if (state.termine || state.sourateIndex >= cfg.sourates.length) {
  log('Série terminée, rien à faire.');
  fs.writeFileSync(path.join(OUT, 'post.json'), JSON.stringify({ skip: true }));
  process.exit(0);
}

const surah = cfg.sourates[state.sourateIndex];
const reciterId = cfg.recitateurs[state.recitateurIndex % cfg.recitateurs.length];
const fromVerse = state.versetSuivant;
const MAXS = +process.env.MAX_SECONDS || cfg.dureeMaxSecondes;

// ---------- mini serveur local (page + réception du fichier vidéo) ----------
let rawPath = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/upload')) {
    const ext = new URL(req.url, 'http://x').searchParams.get('ext') || 'webm';
    rawPath = path.join(OUT, 'raw.' + ext);
    const ws = fs.createWriteStream(rawPath);
    req.pipe(ws);
    ws.on('finish', () => { res.writeHead(200); res.end('ok'); });
    return;
  }
  const p = req.url === '/' ? '/noor_studio.html' : decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(DIR, path.normalize(p));
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.json') ? 'application/json' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
         '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });

// Style perso optionnel : automation/style.json = un style Noor Studio (« ★ Enregistrer le style actuel »)
const stylePath = path.join(DIR, 'style.json');
if (fs.existsSync(stylePath)) {
  const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
  const presets = [{ name: 'Auto', data: style.data || style }];
  await ctx.addInitScript(p => { try { localStorage.setItem('noorPresets', p); } catch (e) {} }, JSON.stringify(presets));
}
// Hook de test : permet de simuler le réseau (voir test/mock.mjs)
if (process.env.NOOR_MOCK) { const m = await import(path.resolve(process.env.NOOR_MOCK)); await m.default(ctx); }

const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') log('console:', m.text()); });
page.on('pageerror', e => log('pageerror:', e.message));

try {
  await page.goto(base + '/noor_studio.html', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready);

  // Format Story 9:16 puis mode Vidéo
  await page.evaluate(() => { const c = document.querySelector('#formatChips .chip[data-h="1920"]'); if (c) c.click(); });
  await page.evaluate(() => setMode('video'));
  await page.waitForFunction(() => surahLoaded === true, null, { timeout: 60000 });
  if (fs.existsSync(stylePath)) await page.evaluate(() => { const b = document.querySelector('#presetList button'); if (b) b.click(); });

  // Sourate
  const nAyahs = await page.evaluate(n => surahMeta.find(s => s.number === n).numberOfAyahs, surah);
  await page.evaluate(n => { const s = document.getElementById('surahSelect'); s.value = String(n); loadSurahVerses(n); }, surah);
  const expected = (surah !== 1 && surah !== 9) ? nAyahs + 1 : nAyahs;
  await page.waitForFunction(([n, e]) => S.surah === n && S.verses.length === e, [surah, expected], { timeout: 60000 });

  // Récitateur
  const reciterName = await page.evaluate(id => {
    S.reciter = id; const rs = document.getElementById('reciterSelect'); rs.value = id;
    return (RECITERS.find(r => r.id === id) || {}).name || id;
  }, reciterId);

  // Durées des versets (métadonnées audio) → plage la plus longue possible ≤ dureeMaxSecondes
  const OVERHEAD = 1.0; // fondu + chargement entre deux versets
  const items = await page.evaluate(async ([n, from]) => {
    const list = S.verses.filter(v => v.isBasmala ? from === 1 : v.n >= from);
    const dur = v => new Promise(res => {
      const a = new Audio(); a.preload = 'metadata'; a.crossOrigin = 'anonymous';
      const t = setTimeout(() => res(null), 20000);
      a.onloadedmetadata = () => { clearTimeout(t); res(isFinite(a.duration) ? a.duration : null); };
      a.onerror = () => { clearTimeout(t); res(null); };
      a.src = audioUrl(S.reciter, v.isBasmala ? 1 : n, v.isBasmala ? 1 : v.n, v.global);
    });
    const out = [];
    for (const v of list) { out.push({ n: v.n, basmala: v.isBasmala, d: await dur(v) }); if (out.length > 400) break; }
    return out;
  }, [surah, fromVerse]);

  let total = 0, toVerse = fromVerse;
  for (const it of items) {
    const d = (it.d ?? 8) + OVERHEAD;
    if (!it.basmala && total + d > MAXS && toVerse > fromVerse) break;
    if (!it.basmala && total + d > MAXS && toVerse === fromVerse) { total += d; toVerse = it.n; break; }
    total += d;
    if (!it.basmala) toVerse = it.n;
  }
  log(`Sourate ${surah}, versets ${fromVerse}→${toVerse}/${nAyahs}, ${reciterName}, ~${Math.round(total)} s`);

  // Plage + enregistrement
  await page.evaluate(([a, b]) => {
    const chip = document.querySelector('#vScopeChips .chip[data-s="range"]'); if (chip) chip.click();
    S.vScope = 'range'; S.rangeFrom = a; S.rangeTo = b;
    const rf = document.getElementById('rangeFrom'), rt = document.getElementById('rangeTo');
    if (rf) rf.value = a; if (rt) rt.value = b;
    lastExport = null;
    toggleRecord();
  }, [fromVerse, toVerse]);

  await page.waitForFunction(() => lastExport && lastExport.blob, null, { timeout: (total + 180) * 1000, polling: 2000 });
  const ext = await page.evaluate(async () => {
    const ext = /mp4/.test(lastExport.blob.type) ? 'mp4' : 'webm';
    const r = await fetch('/upload?ext=' + ext, { method: 'POST', body: lastExport.blob });
    if (!r.ok) throw new Error('upload ' + r.status);
    return ext;
  });
  log('Enregistrement reçu (' + ext + ')');

  // Infos pour la légende
  const info = await page.evaluate(n => {
    const [lat, fr] = SURAH_FR[n - 1] || ['', ''];
    return { lat, fr, ar: (surahMeta.find(s => s.number === n) || {}).name };
  }, surah);

  // Conversion MP4 compatible Instagram / TikTok
  const mp4 = path.join(OUT, 'video.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-maxrate', '2200k', '-bufsize', '4400k', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-movflags', '+faststart', '-t', '179', mp4]);
  const realDur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString());
  const sizeMb = (fs.statSync(mp4).size / 1048576).toFixed(1);
  log(`video.mp4 : ${realDur.toFixed(1)} s, ${sizeMb} Mo`);

  // État suivant
  const finSourate = toVerse >= nAyahs;
  const next = { ...state, historique: [...(state.historique || [])] };
  next.historique.push({ date: new Date().toISOString().slice(0, 10), sourate: surah, de: fromVerse, a: toVerse, recitateur: reciterId });
  if (finSourate) {
    next.sourateIndex = state.sourateIndex + 1; next.versetSuivant = 1;
    next.recitateurIndex = (state.recitateurIndex + 1) % cfg.recitateurs.length;
    next.termine = next.sourateIndex >= cfg.sourates.length;
  } else {
    next.versetSuivant = toVerse + 1;
  }

  const plage = (fromVerse === 1 && finSourate) ? 'sourate complète' : `versets ${fromVerse} à ${toVerse}`;
  const partie = finSourate && fromVerse > 1 ? ' (fin)' : '';
  const caption =
`Sourate ${info.lat} (${surah})${info.fr && info.fr.toLowerCase() !== String(info.lat).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() ? ' — ' + info.fr : ''}
${info.ar} · ${plage}${partie}
Récitation : ${reciterName}

Écoute, médite et partage 🤍
${cfg.hashtags}`;

  fs.writeFileSync(path.join(OUT, 'post.json'), JSON.stringify({
    skip: false, sourate: surah, de: fromVerse, a: toVerse, recitateur: reciterName,
    duree: realDur, caption, nextState: next,
  }, null, 2));
  log('OK');
} catch (e) {
  console.error(e);
  await page.screenshot({ path: path.join(OUT, 'erreur.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
