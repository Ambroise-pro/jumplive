// Tests du saut en longueur (vue de profil) sur des séquences SIMULÉES : `node --test tests/long.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longAxis, validateLongCalibration, LongJumpDetector, extractPose, STATES, LM } from '../core.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} attendu ${b} ±${eps}, obtenu ${a}`);
const W = 1280, H = 720, GROUND = 650;

// étalonnage linéaire : ligne d'appel x=200, 3 px/cm
const CAL_LIN = { p0: { x: 200, y: GROUND }, p1: { x: 500, y: GROUND }, p2: { x: 800, y: GROUND }, d1: 100, d2: 200, videoWidth: W, videoHeight: H };
// étalonnage avec perspective (caméra pas perpendiculaire) : X = a s / (c s + 1)
const A_TRUE = 1 / 3, C_TRUE = -0.0004;
const sOf = (X) => X / (A_TRUE - C_TRUE * X);
const CAL_PERSP = { p0: { x: 150, y: GROUND }, p1: { x: 150 + sOf(100), y: GROUND }, p2: { x: 150 + sOf(200), y: GROUND }, d1: 100, d2: 200, videoWidth: W, videoHeight: H };

test('axe linéaire : 3 px/cm, sol, inverse', () => {
  const ax = longAxis(CAL_LIN);
  close(ax.toCm({ x: 650, y: GROUND }), 150, 1e-9);
  close(ax.toCm({ x: 170, y: GROUND }), -10, 1e-9);
  close(ax.cmPerPxAt({ x: 400, y: GROUND }), 1 / 3, 1e-9);
  close(ax.fromCm(175).x, 725, 1e-9);
  close(ax.groundY(999), GROUND, 1e-9);
});
test('axe avec perspective : homographie 1D exacte', () => {
  const ax = longAxis(CAL_PERSP);
  for (const X of [-20, 37, 150, 260]) close(ax.toCm({ x: 150 + sOf(X), y: GROUND }), X, 1e-6, `X=${X}`);
  close(ax.fromCm(180).x, 150 + sOf(180), 1e-6);
});
test('axe : sol incliné (caméra penchée), projection sur la droite des repères', () => {
  const k = Math.tan(3 * Math.PI / 180), cal = { ...CAL_LIN, p1: { x: 500, y: GROUND + 300 * k }, p2: { x: 800, y: GROUND + 600 * k } };
  const ax = longAxis(cal);
  close(ax.toCm({ x: 200 + 450 * Math.cos(Math.atan(k)) ** 0, y: GROUND + 450 * k }), 150, 1e-6);
});
test('validation longueur', () => {
  const ctx = { videoWidth: W, videoHeight: H };
  assert.equal(validateLongCalibration(CAL_LIN, ctx).valid, true);
  assert.equal(validateLongCalibration(CAL_PERSP, ctx).valid, true);
  assert.ok(validateLongCalibration(CAL_PERSP, ctx).warnings.some(w => /perpendiculaire/.test(w)));
  assert.equal(validateLongCalibration({ ...CAL_LIN, p1: CAL_LIN.p2, p2: CAL_LIN.p1 }, ctx).valid, false);
  assert.equal(validateLongCalibration(CAL_LIN, { videoWidth: 640, videoHeight: 480 }).valid, false);
  assert.equal(validateLongCalibration(null, ctx).valid, false);
});

/* ---------- poses simulées (profil, élève tourné vers +x) ---------- */
function makePose(ax, { toeCm, liftCm = 0, hipUpCm = 0, handBehindCm = null, xShiftPx = 0, vis = 0.95, upperHidden = false }) {
  const P = (X) => ax.fromCm(X), k = 1 / ax.cmPerPxAt(P(Math.max(0, toeCm)));   // px par cm local
  const toe = P(toeCm), heel = P(toeCm - 24), lift = liftCm * k;
  const hip = { x: (toe.x + heel.x) / 2 + xShiftPx, y: GROUND - 95 * k - hipUpCm * k };
  const a = Array.from({ length: 33 }, () => ({ x: hip.x / W, y: (hip.y - 60 * k) / H, visibility: 0.9 }));
  const set = (i, x, y, v = vis) => { a[i] = { x: (x + xShiftPx) / W, y: y / H, visibility: v }; };
  set(LM.L_HIP, hip.x - 4 - xShiftPx, hip.y); set(LM.R_HIP, hip.x + 4 - xShiftPx, hip.y);
  for (const [he, to, an, dx] of [[LM.L_HEEL, LM.L_TOE, LM.L_ANKLE, -2], [LM.R_HEEL, LM.R_TOE, LM.R_ANKLE, 2]]) {
    set(he, heel.x + dx, heel.y - lift); set(to, toe.x + dx, toe.y - lift); set(an, heel.x + 3 * k + dx, heel.y - lift - 8 * k);
  }
  if (upperHidden) { // caméra basse : hanches et haut du corps hors champ / mal détectés
    for (const i of [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER]) a[i] = { x: hip.x / W, y: -0.05, visibility: 0.15 };
    a[LM.L_WRIST] = a[LM.R_WRIST] = { x: hip.x / W, y: -0.05, visibility: 0.1 };
    return extractPose(a, W, H);
  }
  if (handBehindCm != null) { const hp = P(handBehindCm); set(LM.L_WRIST, hp.x, hp.y - 2 * k); set(LM.R_WRIST, hp.x, hp.y - 2 * k); }
  else { set(LM.L_WRIST, hip.x + 10, hip.y - 40); set(LM.R_WRIST, hip.x + 10, hip.y - 40); }
  return extractPose(a, W, H);
}

/** Saut pieds joints : pointes à toe0 cm, réception des talons à land cm (puis léger recul de 1 cm). */
function jumpAt(ax, t, { t0 = 1500, toe0 = -5, land = 180, settle = 1, hand = false } = {}) {
  const s = t - t0, T = 500;
  if (s < 0) return { toeCm: toe0 };
  if (s < 450) return { toeCm: toe0, hipUpCm: s < 250 ? -15 * s / 250 : -15 + 15 * (s - 250) / 200 };
  const f = s - 450, heel0 = toe0 - 24, heel1 = land;
  if (f <= T) { const u = f / T; return { toeCm: heel0 + (heel1 - heel0) * u + 24, liftCm: Math.max(0, 4 * 30 * u * (1 - u)), hipUpCm: 40 * u * (1 - u) }; }
  const l = f - T;
  const back = l < 150 ? settle * l / 150 : settle;
  return { toeCm: land - back + 24, hipUpCm: -10, handBehindCm: hand && l > 200 ? land - 30 : null };
}

function run(det, cal, ms, poseFn, fps = 30) {
  const ax = longAxis(cal), evs = [];
  det.setCalibration(cal, true);
  for (let t = 0; t <= ms; t += 1000 / fps) {
    const people = poseFn(t, ax);
    const e = det.update({ t, people });
    if (e) evs.push(e);
  }
  return evs;
}

for (const [name, cal] of [['linéaire', CAL_LIN], ['perspective', CAL_PERSP]]) {
  test(`longueur ${name} : saut de 180 cm mesuré depuis la ligne (talon le plus en arrière)`, () => {
    const d = new LongJumpDetector(), seen = new Set();
    const evs = run(d, cal, 5000, (t, ax) => { seen.add(d.state); return [makePose(ax, jumpAt(ax, t))]; });
    assert.equal(evs.length, 1, JSON.stringify(evs));
    assert.equal(evs[0].type, 'result', evs[0].reason);
    close(evs[0].valueCm, 179, 1.5, 'distance depuis la ligne');
    close(evs[0].fromToesCm, 184, 2, 'distance depuis les pointes');
    assert.equal(evs[0].uncertain, false, evs[0].issues.join());
    assert.ok(['WAITING', 'STABILIZING', 'READY', 'JUMPING'].every(s => seen.has(s)));
  });
}

test('seuls les pieds sont visibles (haut du corps hors champ) : saut mesuré', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 5000, (t, ax) => [makePose(ax, { ...jumpAt(ax, t), upperHidden: true })]);
  assert.equal(evs.length, 1, JSON.stringify(evs)); assert.equal(evs[0].type, 'result', evs[0].reason);
  close(evs[0].valueCm, 179, 1.5);
});
test('un seul pied bien détecté suffit (pieds joints)', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 5000, (t, ax) => { const p = makePose(ax, jumpAt(ax, t)); p.footR.v = 0.1; return [p]; });
  assert.equal(evs[0]?.type, 'result', JSON.stringify(evs)); close(evs[0].valueCm, 179, 1.5);
});
test('pieds non détectés : en attente, message sur les pieds', () => {
  const d = new LongJumpDetector();
  run(d, CAL_LIN, 2000, (t, ax) => { const p = makePose(ax, { toeCm: -5 }); p.footL.v = p.footR.v = 0.1; return [p]; });
  assert.equal(d.state, STATES.WAITING);
});
test('pieds perdus pendant le vol (flou) : saut quand même mesuré', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 5000, (t, ax) => {
    const p = makePose(ax, jumpAt(ax, t));
    if (t > 2000 && t < 2400) { p.footL.v = p.footR.v = 0.05; }   // 400 ms sans pieds en vol
    return [p];
  });
  assert.equal(evs[0]?.type, 'result', JSON.stringify(evs)); close(evs[0].valueCm, 179, 1.5);
});
test('pieds retrouvés seulement après le contact : mesure faite sur le talon posé', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 5000, (t, ax) => {
    const p = makePose(ax, jumpAt(ax, t));
    if (t > 2000 && t < 2550) { p.footL.v = p.footR.v = 0.05; }   // contact vers 2,45 s, pieds revus à 2,55 s
    return [p];
  });
  assert.equal(evs[0]?.type, 'result', JSON.stringify(evs)); close(evs[0].valueCm, 179, 1.5);
});
test('pieds jamais retrouvés : saut écarté avec un message clair', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 6000, (t, ax) => { const p = makePose(ax, jumpAt(ax, t)); if (t > 2000) { p.footL.v = p.footR.v = 0.05; } return [p]; });
  assert.equal(evs[0]?.type, 'rejected'); assert.match(evs[0].reason, /réception/);
});
test('pieds au-delà de la ligne : jamais prêt', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 3000, (t, ax) => [makePose(ax, { toeCm: 3 })]);
  assert.equal(evs.length, 0); assert.notEqual(d.state, STATES.READY); assert.match(d.message, /Reculez/);
});
test('trop loin derrière la ligne : « Avancez »', () => {
  const d = new LongJumpDetector();
  const cal = { ...CAL_LIN, p0: { x: 500, y: GROUND }, p1: { x: 800, y: GROUND }, p2: { x: 1100, y: GROUND } };  // ligne plus à droite
  run(d, cal, 2000, (t, ax) => [makePose(ax, { toeCm: -90 })]);
  assert.match(d.message, /Avancez/);
});
test('personne perdue après le décollage et jamais retrouvée → écartée', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 6000, (t, ax) => t > 2050 ? [] : [makePose(ax, jumpAt(ax, t))]);
  assert.equal(evs[0].type, 'rejected'); assert.match(evs[0].reason, /réception/);
});
test('réception hors du cadre → écartée', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 5000, (t, ax) => [makePose(ax, jumpAt(ax, t, { land: 380 }))]);
  assert.equal(evs[0].type, 'rejected'); assert.match(evs[0].reason, /cadre/);   // pieds sortis de l'image
});
test('main posée derrière les talons → mesure incertaine', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 5000, (t, ax) => [makePose(ax, jumpAt(ax, t, { hand: true }))]);
  assert.equal(evs[0].type, 'result'); assert.equal(evs[0].uncertain, true); assert.ok(evs[0].issues.some(i => /main/.test(i)));
});
test('deux personnes : pas de mesure', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 5000, (t, ax) => [makePose(ax, jumpAt(ax, t)), makePose(ax, { toeCm: -40, xShiftPx: 0 })]);
  assert.equal(evs.length, 0);
});
test('enchaînement : 2 sauts séparés = 2 mesures', () => {
  const d = new LongJumpDetector();
  const evs = run(d, CAL_LIN, 12000, (t, ax) => {
    if (t < 6000) return [makePose(ax, jumpAt(ax, t))];
    if (t < 7000) return [];                                     // retour à la ligne (hors champ)
    return [makePose(ax, jumpAt(ax, t, { t0: 8500, land: 150 }))];
  });
  const r = evs.filter(e => e.type === 'result');
  assert.equal(r.length, 2, JSON.stringify(evs.map(e => e.type + ':' + (e.reason || e.valueCm))));
  close(r[0].valueCm, 179, 1.5); close(r[1].valueCm, 149, 1.5);
});
