// Tests des 3 méthodes de détection sur des images SYNTHÉTIQUES dont la géométrie est connue.
// `node --test tests/a4detect.test.mjs`  (OpenCV : définir OPENCV_JS=/chemin/opencv.js, sinon ces tests sont ignorés)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { detectWhiteSheet, detectMarkers, detectSheetOpenCV, combineDetections, MARKER, A4_CM } from '../a4detect.js';
import { scene } from './scene.mjs';

const relErr = (got, exp) => Math.abs(got - exp) / exp;
const cmPx = (r) => r.refCm / Math.hypot(r.p2.x - r.p1.x, r.p2.y - r.p1.y);

const CASES = [
  { name: 'droite, fond dégradé', o: { heightPx: 140 } },
  { name: 'inclinée 4°', o: { heightPx: 140, tiltDeg: 4 } },
  { name: 'petite (100 px)', o: { heightPx: 100, cx: 500, cy: 300 } },
  { name: 'grande (260 px), fond sombre', o: { heightPx: 260, bg: 'dark' } },
  { name: 'objets parasites', o: { heightPx: 150, cx: 700, distractors: true } },
  { name: 'bruit fort', o: { heightPx: 140, noise: 18 } },
];

/* ---------- 1. Feuille blanche JS ---------- */
for (const k of CASES) test(`méthode 1 (feuille blanche JS) — ${k.name}`, () => {
  const r = detectWhiteSheet(scene(k.o));
  assert.ok(r.ok, r.reason);
  const e = relErr(cmPx(r), A4_CM / k.o.heightPx);
  assert.ok(e < 0.01, `erreur ${(e * 100).toFixed(2)} % (hauteur ${r.heightPx.toFixed(2)} px au lieu de ${k.o.heightPx})`);
  console.log(`  1 · ${k.name} : ${r.heightPx.toFixed(2)} px / ${k.o.heightPx} → erreur ${(e * 100).toFixed(2)} %, confiance ${r.confidence.toFixed(2)}, ${r.ms.toFixed(0)} ms`);
});

/* ---------- 3. Marqueurs ---------- */
for (const k of CASES) test(`méthode 3 (marqueurs) — ${k.name}`, () => {
  const r = detectMarkers(scene(k.o));
  assert.ok(r.ok, r.reason);
  const expPx = k.o.heightPx * MARKER.distMm / 297;
  const e = relErr(r.heightPx, expPx);
  assert.ok(e < 0.01, `erreur ${(e * 100).toFixed(2)} % (${r.heightPx.toFixed(2)} px au lieu de ${expPx.toFixed(2)})`);
  assert.ok(r.p1.y < r.p2.y);
  console.log(`  3 · ${k.name} : ${r.heightPx.toFixed(2)} px / ${expPx.toFixed(2)} → erreur ${(e * 100).toFixed(2)} %, confiance ${r.confidence.toFixed(2)}, ${r.ms.toFixed(0)} ms`);
});

/* ---------- Cas négatifs ---------- */
test('méthode 1 : pas de feuille → échec explicite', () => {
  const r = detectWhiteSheet(scene({ sheet: false, distractors: true }));
  assert.equal(r.ok, false); assert.ok(r.reason.length > 5);
});
test('méthode 3 : feuille blanche sans marqueurs → échec explicite', () => {
  const r = detectMarkers(scene({ markers: false, distractors: true }));
  assert.equal(r.ok, false);
});
test('méthode 3 : carrés noirs pleins isolés non confondus avec des marqueurs', () => {
  const r = detectMarkers(scene({ sheet: false, distractors: true }));
  assert.equal(r.ok, false);
});
test('feuille sur fond clair : méthode 1 échoue proprement, méthode 3 réussit', () => {
  const img = scene({ heightPx: 140, bg: 'bright', paper: 225 });
  const r1 = detectWhiteSheet(img), r3 = detectMarkers(img);
  if (r1.ok) assert.ok(relErr(cmPx(r1), A4_CM / 140) < 0.02, 'si elle répond, elle doit être juste');
  assert.ok(r3.ok, r3.reason);
});

test('combineDetections : médiane et dispersion', () => {
  const mk = (h) => ({ ok: true, p1: { x: 0, y: 0 }, p2: { x: 0, y: h }, refCm: 29.7, confidence: 0.9, ms: 10 });
  const c = combineDetections([mk(100), mk(101), mk(99), { ok: false }]);
  assert.equal(c.success, 3); assert.equal(c.heightPx, 100); assert.ok(c.spreadPx > 0.9 && c.spreadPx < 1.1);
  assert.equal(combineDetections([{ ok: false, reason: 'x' }]).ok, false);
});

/* ---------- 2. OpenCV (si disponible) ---------- */
const OCV = process.env.OPENCV_JS;
// Attention : le module OpenCV est « thenable » et se renvoie lui-même : ne jamais faire `await cv` ni `return cv`
// depuis une fonction async (boucle infinie). On l'emballe dans un objet.
async function loadCv() {
  const require = createRequire(import.meta.url);
  const cv = require(OCV);
  if (!cv.Mat) await new Promise((res) => { cv.onRuntimeInitialized = res; const t = setInterval(() => { if (cv.Mat) { clearInterval(t); res(); } }, 50); });
  return { cv };
}
test('méthode 2 (OpenCV)', { skip: !(OCV && fs.existsSync(OCV)) && 'OPENCV_JS non défini' }, async (t) => {
  const { cv } = await loadCv();
  for (const k of CASES) await t.test(k.name, () => {
    const r = detectSheetOpenCV(cv, scene(k.o));
    assert.ok(r.ok, r.reason);
    const e = relErr(cmPx(r), A4_CM / k.o.heightPx);
    console.log(`  2 · ${k.name} : ${r.heightPx.toFixed(2)} px / ${k.o.heightPx} → erreur ${(e * 100).toFixed(2)} %, confiance ${r.confidence.toFixed(2)}, ${r.ms.toFixed(0)} ms`);
    assert.ok(e < 0.015, `erreur ${(e * 100).toFixed(2)} %`);
  });
  await t.test('pas de feuille → échec', () => assert.equal(detectSheetOpenCV(cv, scene({ sheet: false, distractors: true })).ok, false));
});
