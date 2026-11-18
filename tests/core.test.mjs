// Tests du noyau : `node --test tests/`
// Les tests du détecteur utilisent des séquences SIMULÉES (pas de vraie vidéo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cmPerPixel, detenteCm, flightHeightCm, computeFit, zoomFit, nativeToView, viewToNative,
  validateCalibration, extractPose, JumpDetector, STATES, median, LM,
} from '../core.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} attendu ${b} ±${eps}, obtenu ${a}`);

/* ---------- Conversion px/cm ---------- */
test('cmPerPixel : A4 de 300 px → 0,099 cm/px', () => {
  close(cmPerPixel({ x: 0, y: 100 }, { x: 0, y: 400 }), 0.099, 1e-9);
});
test('cmPerPixel : feuille légèrement inclinée (distance euclidienne)', () => {
  close(cmPerPixel({ x: 0, y: 0 }, { x: 30, y: 40 }), 29.7 / 50, 1e-9);
});
test('cmPerPixel : points confondus → NaN', () => {
  assert.ok(Number.isNaN(cmPerPixel({ x: 5, y: 5 }, { x: 5, y: 5 })));
});
test('detenteCm : (500 − 300) × 0,099 = 19,8 cm ; axe Y vers le bas', () => {
  close(detenteCm(500, 300, 0.099), 19.8, 1e-9);
  assert.ok(detenteCm(300, 500, 0.099) < 0);
});
test('flightHeightCm : 500 ms → ≈ 30,7 cm', () => close(flightHeightCm(500), 30.66, 0.01));

/* ---------- Repère natif / affiché ---------- */
test('computeFit contain : 1280×720 dans 1000×1000', () => {
  const f = computeFit(1280, 720, 1000, 1000, 'contain');
  close(f.scale, 0.78125, 1e-9); close(f.ox, 0, 1e-9); close(f.oy, 218.75, 1e-9);
});
test('computeFit cover (image recadrée) : 1280×720 dans 1000×1000', () => {
  const f = computeFit(1280, 720, 1000, 1000, 'cover');
  close(f.scale, 1000 / 720, 1e-9); close(f.ox, (1000 - 1280 * 1000 / 720) / 2, 1e-9); close(f.oy, 0, 1e-9);
});
for (const mode of ['contain', 'cover']) for (const mirror of [false, true]) {
  test(`aller-retour natif→vue→natif (${mode}, miroir=${mirror})`, () => {
    const f = computeFit(1280, 720, 1024, 768, mode);
    for (const p of [{ x: 0, y: 0 }, { x: 1280, y: 720 }, { x: 321.5, y: 610.25 }]) {
      const back = viewToNative(nativeToView(p, f, mirror), f, mirror);
      close(back.x, p.x, 1e-9); close(back.y, p.y, 1e-9);
    }
  });
}
test('miroir : le bord gauche natif s’affiche à droite', () => {
  const f = computeFit(1280, 720, 1280, 720);
  close(nativeToView({ x: 0, y: 0 }, f, true).x, 1280, 1e-9);
});
test('une mesure en pixels CSS est convertie en pixels natifs avant calcul', () => {
  // Vue 640×360 d'une image 1280×720 : 100 px affichés = 200 px natifs
  const f = computeFit(1280, 720, 640, 360);
  const a = viewToNative({ x: 10, y: 50 }, f), b = viewToNative({ x: 10, y: 150 }, f);
  close(b.y - a.y, 200, 1e-9);
});
test('zoomFit garde le point focal au centre et reste réversible', () => {
  const f = computeFit(1280, 720, 1000, 600);
  for (const mirror of [false, true]) {
    const z = zoomFit(f, 3, { x: 400, y: 500 }, 1000, 600, mirror);
    const c = nativeToView({ x: 400, y: 500 }, z, mirror);
    close(c.x, 500, 1e-9); close(c.y, 300, 1e-9);
    const back = viewToNative({ x: 123, y: 456 }, z, mirror);
    const again = nativeToView(back, z, mirror);
    close(again.x, 123, 1e-9); close(again.y, 456, 1e-9);
  }
});

/* ---------- Validation de calibration ---------- */
const CAL = { p1: { x: 600, y: 300 }, p2: { x: 600, y: 420 }, cmPerPx: 29.7 / 120, videoWidth: 1280, videoHeight: 720, deviceId: 'camA', zoom: 1 };
test('calibration valide', () => {
  const r = validateCalibration(CAL, { videoWidth: 1280, videoHeight: 720, deviceId: 'camA', zoom: 1 });
  assert.equal(r.valid, true, r.reasons.join());
});
test('calibration avec étalon de 20 cm (marqueurs)', () => {
  const c = { ...CAL, refCm: 20, cmPerPx: 20 / 120 };
  assert.equal(validateCalibration(c, { videoWidth: 1280, videoHeight: 720, deviceId: 'camA', zoom: 1 }).valid, true);
  assert.equal(validateCalibration({ ...c, refCm: undefined }).valid, false);
});
test('calibration manquante', () => assert.equal(validateCalibration(null, {}).valid, false));
test('résolution modifiée → invalide', () => {
  const r = validateCalibration(CAL, { videoWidth: 640, videoHeight: 480, deviceId: 'camA' });
  assert.equal(r.valid, false); assert.match(r.reasons[0], /Résolution/);
});
test('rotation de la tablette → invalide', () => {
  const r = validateCalibration(CAL, { videoWidth: 720, videoHeight: 1280, deviceId: 'camA' });
  assert.equal(r.valid, false); assert.match(r.reasons[0], /Orientation/);
});
test('autre caméra ou zoom modifié → invalide', () => {
  assert.equal(validateCalibration(CAL, { videoWidth: 1280, videoHeight: 720, deviceId: 'camB' }).valid, false);
  assert.equal(validateCalibration(CAL, { videoWidth: 1280, videoHeight: 720, deviceId: 'camA', zoom: 2 }).valid, false);
});
test('feuille petite ou inclinée → avertissements', () => {
  const small = { ...CAL, p2: { x: 600, y: 340 }, cmPerPx: 29.7 / 40 };
  assert.ok(validateCalibration(small).warnings.some(w => /petit/.test(w)));
  const tilted = { ...CAL, p2: { x: 650, y: 420 } }; tilted.cmPerPx = cmPerPixel(tilted.p1, tilted.p2);
  assert.ok(validateCalibration(tilted).warnings.some(w => /inclinée/.test(w)));
});

/* ---------- Simulation de pose ---------- */
const W = 1280, H = 720, CMPX = 0.25; // 4 px par cm
const HIP0 = 400, GROUND = 700;
function lms({ x = 640, hipY, heelL = GROUND, toeL = GROUND, heelR = GROUND, toeR = GROUND, vis = 0.95, footVis = 0.9 }) {
  const a = Array.from({ length: 33 }, () => ({ x: x / W, y: 0.2, visibility: 0.9 }));
  const set = (i, px, py, v) => { a[i] = { x: px / W, y: py / H, visibility: v }; };
  set(LM.L_HIP, x - 40, hipY, vis); set(LM.R_HIP, x + 40, hipY, vis);
  set(LM.L_ANKLE, x - 40, Math.min(heelL, toeL) - 20, footVis); set(LM.R_ANKLE, x + 40, Math.min(heelR, toeR) - 20, footVis);
  set(LM.L_HEEL, x - 45, heelL, footVis); set(LM.R_HEEL, x + 35, heelR, footVis);
  set(LM.L_TOE, x - 20, toeL, footVis); set(LM.R_TOE, x + 60, toeR, footVis);
  return a;
}
const pose = (o) => extractPose(lms(o), W, H);

let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const noise = (cm) => rnd() * 2 * cm / CMPX;

/** Saut simulé : contre-mouvement, extension de cheville (+8 cm au décollage), vol de hauteur hFlightCm. */
function jumpProfile(t, t0, hFlightCm = 30) {
  const v0 = Math.sqrt(2 * 9.81 * hFlightCm / 100), T = 2 * v0 / 9.81 * 1000;
  const s = t - t0;
  if (s < 0) return { rise: 0, lift: 0 };
  if (s < 250) return { rise: -15 * s / 250, lift: 0 };
  if (s < 450) return { rise: -15 + 23 * (s - 250) / 200, lift: 0 };
  const f = s - 450;
  if (f <= T) { const u = f / 1000; const r = 8 + (v0 * u - 4.905 * u * u) * 100; return { rise: r, lift: Math.max(0, r - 8) }; }
  const l = f - T;
  if (l < 200) return { rise: 8 - 18 * l / 200, lift: 0 };
  if (l < 700) return { rise: -10 + 10 * (l - 200) / 500, lift: 0 };
  return { rise: 0, lift: 0 };
}

function run(det, durationMs, frameFn, fps = 30) {
  const events = [];
  for (let t = 0; t <= durationMs; t += 1000 / fps) {
    const ev = det.update({ t, people: frameFn(t) });
    if (ev) events.push(ev);
  }
  return events;
}
function newDet(p) { const d = new JumpDetector(p); d.setCalibration(CMPX, true); return d; }
const standing = (extra = {}) => pose({ hipY: HIP0 + noise(0.3), ...extra });
const jumping = (t, t0, h, extra = {}) => {
  const { rise, lift } = jumpProfile(t, t0, h);
  const fy = GROUND - lift / CMPX + noise(0.2);
  return pose({ hipY: HIP0 - rise / CMPX + noise(0.3), heelL: fy, toeL: fy, heelR: fy, toeR: fy, ...extra });
};

test('extractPose : pointe au sol et talon levé → le pied reste « au sol »', () => {
  const p = pose({ hipY: 380, heelL: 680, toeL: GROUND, heelR: 680, toeR: GROUND });
  close(p.footL.y, GROUND, 1e-9); assert.ok(p.hipOk && p.feetOk && p.inFrame);
});
test('extractPose : pied hors cadre → inFrame = false', () => {
  assert.equal(pose({ hipY: 400, heelL: 719, toeL: 719 }).inFrame, false);
});

test('états : WAITING → STABILIZING → READY avec une personne immobile', () => {
  const d = newDet(); const seen = new Set();
  run(d, 1500, () => { seen.add(d.state); return [standing()]; });
  assert.ok(seen.has(STATES.WAITING) && seen.has(STATES.STABILIZING));
  assert.equal(d.state, STATES.READY);
  close(d.ref.hipY, HIP0, 0.4 / CMPX);
});

for (const h of [15, 30, 45]) {
  test(`saut simulé (vol ${h} cm) : détente mesurée ≈ ${h + 8} cm`, () => {
    seed = h; const d = newDet();
    const ev = run(d, 4000, (t) => [jumping(t, 1500, h)]);
    assert.equal(ev.length, 1, JSON.stringify(ev));
    assert.equal(ev[0].type, 'result');
    close(ev[0].detenteCm, h + 8, 1.5, 'détente');
    close(ev[0].flightCm, h, 6, 'temps de vol (indicatif)');
    assert.equal(ev[0].uncertain, false, ev[0].issues.join());
    close(ev[0].apexX, 640, 1, 'position horizontale du bassin au sommet');
  });
}

test('saut sur pointes : aucune mesure', () => {
  const d = newDet();
  const ev = run(d, 4000, (t) => {
    const up = t > 1500 && t < 2500 ? 6 : 0;
    const heel = GROUND - up / CMPX;
    return [pose({ hipY: HIP0 - up / CMPX + noise(0.3), heelL: heel, heelR: heel, toeL: GROUND, toeR: GROUND })];
  });
  assert.equal(ev.length, 0);
});

test('saut avorté (flexion puis retour) : aucune mesure', () => {
  const d = newDet();
  const ev = run(d, 4000, (t) => {
    const s = t - 1500; const rise = s > 0 && s < 600 ? -15 * Math.sin(Math.PI * s / 600) : 0;
    return [pose({ hipY: HIP0 - rise / CMPX + noise(0.3) })];
  });
  assert.equal(ev.length, 0);
});

test('deux personnes dans la zone : pas de référence, pas de mesure', () => {
  const d = newDet();
  const ev = run(d, 4000, (t) => [jumping(t, 1500, 30), standing({ x: 300 })]);
  assert.equal(ev.length, 0); assert.notEqual(d.state, STATES.READY);
});

test('deuxième personne hors zone : ignorée', () => {
  const d = newDet(); d.setZone({ x: 440, y: 0, w: 400, h: 720 });
  const ev = run(d, 4000, (t) => [jumping(t, 1500, 30), standing({ x: 100 })]);
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'result');
});

test('une deuxième personne entre pendant le saut → mesure écartée', () => {
  const d = newDet();
  const ev = run(d, 4000, (t) => (t > 2100 && t < 2200) ? [jumping(t, 1500, 30), standing({ x: 300 })] : [jumping(t, 1500, 30)]);
  assert.equal(ev[0].type, 'rejected'); assert.match(ev[0].reason, /Plusieurs/);
});

test('perte de suivi pendant le vol → mesure écartée', () => {
  const d = newDet();
  const ev = run(d, 4000, (t) => (t > 2050 && t < 2400) ? [] : [jumping(t, 1500, 30)]);
  assert.equal(ev[0].type, 'rejected'); assert.match(ev[0].reason, /suivi/);
});

test('absence de sujet : reste en attente', () => {
  const d = newDet(); run(d, 2000, () => []);
  assert.equal(d.state, STATES.WAITING); assert.match(d.message, /Placez-vous/);
});

test('calibration invalide : aucune mesure', () => {
  const d = new JumpDetector(); d.setCalibration(CMPX, false);
  const ev = run(d, 4000, (t) => [jumping(t, 1500, 30)]);
  assert.equal(ev.length, 0); assert.match(d.message, /Calibration/);
});

test('pas de double comptage : rebonds après réception ignorés, 2 sauts séparés = 2 mesures', () => {
  seed = 7; const d = newDet();
  const ev = run(d, 9000, (t) => {
    if (t < 3000) return [jumping(t, 1500, 30)];        // saut 1, réception ≈ 2,45 s
    if (t < 4000) return [jumping(t, 2550, 5)];         // petit rebond juste après (doit être ignoré)
    return [jumping(t, 6000, 20)];                       // saut 2 après retour au calme
  });
  const results = ev.filter(e => e.type === 'result');
  assert.equal(results.length, 2, JSON.stringify(ev.map(e => e.type)));
  close(results[0].detenteCm, 38, 1.5); close(results[1].detenteCm, 28, 1.5);
});

test('cadence IA faible (10 img/s) → mesure signalée incertaine', () => {
  seed = 3; const d = newDet();
  const ev = run(d, 4000, (t) => [jumping(t, 1500, 30)], 10);
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'result');
  assert.equal(ev[0].uncertain, true);
});

test('confiance de suivi faible → mesure incertaine', () => {
  seed = 4; const d = newDet();
  const ev = run(d, 4000, (t) => [jumping(t, 1500, 30, { vis: 0.65 })]);
  assert.equal(ev[0].uncertain, true);
});

test('reset (nouveau saut) conserve la calibration', () => {
  const d = newDet(); run(d, 1500, () => [standing()]);
  d.reset(); assert.equal(d.state, STATES.WAITING); assert.equal(d.calibration.valid, true);
});

test('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5); });
