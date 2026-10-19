// Simulation réseau pour tester render.mjs sans internet : NOOR_MOCK=test/mock.mjs node render.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const D = path.dirname(fileURLToPath(import.meta.url));
const tones = [3, 5, 9].map(d => fs.readFileSync(path.join(D, `tone${d}.mp3`)));
const AYAHS = { 1: 7, 9: 129, 36: 83, 37: 182, 38: 88 };
const nA = n => AYAHS[n] || 20;

export default async function (ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr|unpkg|cdnjs/, r => r.abort());
  await ctx.route(/api\.alquran\.cloud\/v1\/surah$/, r => r.fulfill({
    contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ data: Array.from({ length: 114 }, (_, i) => ({ number: i + 1, name: 'سورة ' + (i + 1), englishName: 'S' + (i + 1), numberOfAyahs: nA(i + 1) })) }),
  }));
  await ctx.route(/api\.alquran\.cloud\/v1\/surah\/(\d+)\/editions/, r => {
    const n = +r.request().url().match(/surah\/(\d+)/)[1];
    const mk = (fr) => ({ ayahs: Array.from({ length: nA(n) }, (_, i) => ({ number: 1000 + i, numberInSurah: i + 1, text: fr ? `Traduction du verset ${i + 1}` : (i === 0 && n !== 1 && n !== 9 ? 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ' : '') + 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ ' + (i + 1) })) });
    r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: [mk(false), mk(true)] }) });
  });
  await ctx.route(/everyayah\.com|cdn\.islamic\.network/, r => {
    const m = r.request().url().match(/(\d+)\.mp3/); const k = m ? +m[1] % 3 : 0;
    r.fulfill({ contentType: 'audio/mpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: tones[k] });
  });
}
