// Tests du lissage du suivi : `node --test tests/smoothing.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneEuro, PoseSmoother, std } from '../core.js';

let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);

test('immobile : le tremblement est fortement réduit', () => {
  const f = new OneEuro(1.2, 1), raw = [], out = [];
  for (let i = 0; i < 90; i++) { const x = 0.5 + rnd() * 0.01; raw.push(x); out.push(f.filter(x, i / 30)); }
  const r = std(raw.slice(30)), o = std(out.slice(30));
  assert.ok(o < r * 0.35, `écart-type brut ${r.toFixed(5)}, lissé ${o.toFixed(5)}`);
});
test('mouvement rapide : suivi avec peu de retard', () => {
  const f = new OneEuro(1.2, 1); let last = 0;
  for (let i = 0; i <= 15; i++) last = f.filter(0.5 - 0.3 * (i / 15), i / 30);   // 30 % de l'image en 0,5 s
  assert.ok(Math.abs(last - 0.2) < 0.06, `position lissée ${last.toFixed(3)} au lieu de 0,200`);
});
test('PoseSmoother : réinitialisé quand le nombre de personnes change', () => {
  const s = new PoseSmoother('medium'), pose = (x) => Array.from({ length: 33 }, () => ({ x, y: 0.5, visibility: 0.9 }));
  s.smooth([pose(0.5)], 0); s.smooth([pose(0.5)], 0.033);
  const two = s.smooth([pose(0.5), pose(0.2)], 0.066);
  assert.equal(two[1][0].x, 0.2);   // nouvelle personne : pas de mélange avec l'ancienne
  assert.equal(new PoseSmoother('off').smooth([pose(0.3)], 0)[0][0].x, 0.3);
});

/* ---------- chaîne complète : points qui tremblent → lissage → détecteur (comme dans l'application) ---------- */
import { JumpDetector, extractPose, STATES, LM } from '../core.js';
const W = 1280, H = 720, CMPX = 0.25, HIP0 = 400, GROUND = 700;
function lms(hipY, footY, noisePx) {
  const n = () => rnd() * 2 * noisePx;
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.2, visibility: 0.9 }));
  const set = (i, x, y) => { a[i] = { x: (x + n()) / W, y: (y + n()) / H, visibility: 0.92 }; };
  set(LM.L_HIP, 600, hipY); set(LM.R_HIP, 680, hipY);
  for (const [he, to, an, x] of [[LM.L_HEEL, LM.L_TOE, LM.L_ANKLE, 595], [LM.R_HEEL, LM.R_TOE, LM.R_ANKLE, 675]]) { set(he, x, footY); set(to, x + 25, footY); set(an, x + 5, footY - 20); }
  return a;
}
function pipeline(smoothLevel, noiseCm, durMs, jumpAt = null) {
  const det = new JumpDetector({ stableMaxStdCm: 1.5, stableMaxRangeCm: 5.25 }); det.setCalibration(CMPX, true);
  const sm = new PoseSmoother(smoothLevel), states = new Set(), evs = [];
  for (let t = 0; t <= durMs; t += 1000 / 30) {
    let rise = 0, lift = 0;
    if (jumpAt != null) { const f = t - jumpAt, T = 495; if (f > 0 && f < T) { const u = f / 1000; rise = 8 + (2.426 * u - 4.905 * u * u) * 100; lift = rise - 8; } }
    const raw = [lms(HIP0 - rise / CMPX, GROUND - lift / CMPX, noiseCm / CMPX)];
    const smooth = sm.smooth(raw, t / 1000).map(l => extractPose(l, W, H));
    const people = det.state === STATES.JUMPING ? raw.map(l => extractPose(l, W, H)) : smooth;
    const e = det.update({ t, people }); if (e) evs.push(e); states.add(det.state);
  }
  return { states, evs, det };
}
function firstReady(level, noiseCm, seedv) {
  seed = seedv;
  const det = new JumpDetector({ stableMaxStdCm: 1.5, stableMaxRangeCm: 5.25 }); det.setCalibration(CMPX, true);
  const sm = new PoseSmoother(level);
  for (let t = 0; t <= 6000; t += 1000 / 30) {
    const raw = [lms(HIP0, GROUND, noiseCm / CMPX)];
    det.update({ t, people: sm.smooth(raw, t / 1000).map(l => extractPose(l, W, H)) });
    if (det.state === STATES.READY) return t;
  }
  return 6000;
}
test('points qui tremblent de ±5 cm : le lissage permet d’être « Prêt » vite et à coup sûr', () => {
  const seeds = [3, 7, 11, 19, 23, 31];
  const off = seeds.map(v => firstReady('off', 5, v)), med = seeds.map(v => firstReady('medium', 5, v));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`  délai avant « Prêt » — sans lissage : ${off.map(Math.round).join(', ')} ms ; lissage moyen : ${med.map(Math.round).join(', ')} ms`);
  assert.ok(med.every(v => v < 1500), 'lissé : toujours prêt en moins de 1,5 s');
  assert.ok(mean(med) < mean(off) / 2, 'au moins deux fois plus rapide');
});
test('avec lissage, la mesure du saut utilise les points bruts (pas d’écrêtage du sommet)', () => {
  seed = 5; const r = pipeline('strong', 1, 5000, 2500);
  const res = r.evs.find(e => e.type === 'result');
  assert.ok(res, JSON.stringify(r.evs));
  assert.ok(Math.abs(res.detenteCm - 38) < 2, `détente ${res.detenteCm.toFixed(1)} cm (attendu 38)`);
});
