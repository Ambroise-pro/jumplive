// JumpMeasure LIVE — noyau de calcul (aucune dépendance au DOM, testable avec `node --test`).
// Toutes les coordonnées sont exprimées dans le REPÈRE NATIF de l'image caméra
// (pixels de videoWidth × videoHeight, axe Y vers le bas).

export const A4_CM = 29.7;

export const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12, L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28, L_HEEL: 29, R_HEEL: 30, L_TOE: 31, R_TOE: 32,
};

/* ---------- Calibration et mesure ---------- */

export function cmPerPixel(p1, p2, refCm = A4_CM) {
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  return d > 0 ? refCm / d : NaN;
}

export function detenteCm(yReferencePx, ySommetPx, cmPx) {
  return (yReferencePx - ySommetPx) * cmPx;
}

/** Estimation indicative par le temps de vol : h = g·t²/8 (en cm). */
export function flightHeightCm(flightMs) {
  const t = flightMs / 1000;
  return (9.81 * t * t / 8) * 100;
}

/* ---------- Repère natif <-> repère affiché ---------- */

/** Équivalent de object-fit (contain | cover) : où l'image native est dessinée dans la vue. */
export function computeFit(srcW, srcH, dstW, dstH, mode = 'contain') {
  const s = mode === 'cover' ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * s, h = srcH * s;
  return { scale: s, ox: (dstW - w) / 2, oy: (dstH - h) / 2, w, h, srcW, srcH };
}

/** Applique un zoom (≥1) centré sur un point natif, en gardant ce point au centre de la vue. */
export function zoomFit(fit, zoom, focus, dstW, dstH, mirror = false) {
  if (!zoom || zoom === 1) return fit;
  const s = fit.scale * zoom;
  const fx = mirror ? fit.srcW - focus.x : focus.x;
  return { ...fit, scale: s, w: fit.srcW * s, h: fit.srcH * s, ox: dstW / 2 - fx * s, oy: dstH / 2 - focus.y * s };
}

export function nativeToView(pt, fit, mirror = false) {
  const x = mirror ? fit.srcW - pt.x : pt.x;
  return { x: fit.ox + x * fit.scale, y: fit.oy + pt.y * fit.scale };
}

export function viewToNative(pt, fit, mirror = false) {
  let x = (pt.x - fit.ox) / fit.scale;
  const y = (pt.y - fit.oy) / fit.scale;
  if (mirror) x = fit.srcW - x;
  return { x, y };
}

/* ---------- Statistiques ---------- */

export function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN; }
export function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

/* ---------- Validation de la calibration ---------- */

/**
 * @param cal calibration enregistrée
 * @param ctx { deviceId, videoWidth, videoHeight, zoom }
 * @returns { valid, reasons: string[], warnings: string[] }
 */
export function validateCalibration(cal, ctx) {
  const reasons = [], warnings = [];
  if (!cal || !cal.p1 || !cal.p2 || !(cal.cmPerPx > 0)) {
    return { valid: false, reasons: ['Calibration manquante'], warnings };
  }
  if (ctx) {
    if (cal.videoWidth && ctx.videoWidth) {
      const swapped = cal.videoWidth === ctx.videoHeight && cal.videoHeight === ctx.videoWidth && cal.videoWidth !== cal.videoHeight;
      if (swapped) reasons.push('Orientation de l’image modifiée (rotation)');
      else if (cal.videoWidth !== ctx.videoWidth || cal.videoHeight !== ctx.videoHeight)
        reasons.push(`Résolution modifiée (${cal.videoWidth}×${cal.videoHeight} → ${ctx.videoWidth}×${ctx.videoHeight})`);
    }
    if (cal.deviceId && ctx.deviceId && cal.deviceId !== ctx.deviceId) reasons.push('Caméra différente de celle de la calibration');
    if (cal.zoom != null && ctx.zoom != null && Math.abs(cal.zoom - ctx.zoom) > 0.01) reasons.push('Zoom de la caméra modifié');
  }
  const hPx = Math.hypot(cal.p2.x - cal.p1.x, cal.p2.y - cal.p1.y);
  if (Math.abs(cmPerPixel(cal.p1, cal.p2, cal.refCm ?? A4_CM) - cal.cmPerPx) > 1e-6) reasons.push('Calibration incohérente');
  if (cal.cmPerPx < 0.02 || cal.cmPerPx > 2) reasons.push('Échelle invraisemblable');
  if (hPx < 60) warnings.push(`Étalon petit à l’image (${Math.round(hPx)} px) : précision réduite`);
  const angle = Math.abs(Math.atan2(cal.p2.x - cal.p1.x, cal.p2.y - cal.p1.y) * 180 / Math.PI);
  const tilt = Math.min(angle, 180 - angle);
  if (tilt > 8) warnings.push(`Feuille inclinée de ${tilt.toFixed(0)}° : vérifier qu’elle est bien verticale`);
  return { valid: reasons.length === 0, reasons, warnings };
}

/* ---------- Extraction de la pose ---------- */

/**
 * Convertit des landmarks MediaPipe normalisés (0..1) en données utiles, en pixels natifs.
 * Pied : on retient le point le plus bas entre talon et pointe (max y). Sur pointes de pieds
 * ce point (la pointe) reste au sol ; au décollage, il monte.
 */
export function extractPose(lms, W, H, opt = {}) {
  const minHipVis = opt.minHipVis ?? 0.6, minFootVis = opt.minFootVis ?? 0.4;
  const g = (i) => { const p = lms[i] || {}; return { x: (p.x ?? NaN) * W, y: (p.y ?? NaN) * H, v: p.visibility ?? 1 }; };
  const lh = g(LM.L_HIP), rh = g(LM.R_HIP);
  const hip = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, v: Math.min(lh.v, rh.v) };
  const foot = (heelI, toeI, ankleI) => {
    const he = g(heelI), to = g(toeI), an = g(ankleI);
    return { y: Math.max(he.y, to.y), x: (he.x + to.x) / 2, v: Math.min(he.v, to.v, an.v), ankleY: an.y };
  };
  const footL = foot(LM.L_HEEL, LM.L_TOE, LM.L_ANKLE), footR = foot(LM.R_HEEL, LM.R_TOE, LM.R_ANKLE);
  const pts = [lh, rh, footL, footR];
  const inFrame = pts.every(p => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H * 0.995);
  return {
    hip, footL, footR, inFrame,
    hipOk: hip.v >= minHipVis && Number.isFinite(hip.y),
    feetOk: footL.v >= minFootVis && footR.v >= minFootVis,
    conf: Math.min(hip.v, footL.v, footR.v),
  };
}

export function inZone(pt, zone) {
  if (!zone) return true;
  return pt.x >= zone.x && pt.x <= zone.x + zone.w && pt.y >= zone.y && pt.y <= zone.y + zone.h;
}

/* ---------- Détecteur de saut (machine à états) ---------- */

export const STATES = { WAITING: 'WAITING', STABILIZING: 'STABILIZING', READY: 'READY', JUMPING: 'JUMPING', RESULT: 'RESULT' };

export const DEFAULTS = {
  stableWindowMs: 700,   // durée d'immobilité pour la référence
  stableMaxStdCm: 1.0,   // écart-type max du bassin pendant la fenêtre
  stableMaxRangeCm: 3.5, // amplitude max du bassin pendant la fenêtre
  takeoffHipCm: 3,       // élévation min du bassin au décollage
  takeoffFootCm: 2.5,    // élévation min du point bas de CHAQUE pied (décollage réel)
  landingFootCm: 1.5,    // pieds revenus à moins de x cm du sol = réception
  minFlightMs: 120, maxFlightMs: 1200,
  maxLostMs: 160,        // trou de suivi toléré pendant le saut
  resultHoldMs: 2500,    // période réfractaire après un résultat (anti double comptage)
  readyDriftCm: 6, readyDriftMs: 1500,
  minDetenteCm: 3, maxDetenteCm: 120,
  minAiFps: 12, minQualityVis: 0.75,
};

export class JumpDetector {
  constructor(params = {}) {
    this.p = { ...DEFAULTS, ...params };
    this.calibration = { cmPerPx: NaN, valid: false };
    this.zone = null;
    this.reset();
  }

  setParams(p) { Object.assign(this.p, p); }
  setCalibration(cmPerPx, valid) { this.calibration = { cmPerPx, valid: !!valid && cmPerPx > 0 }; }
  setZone(zone) { this.zone = zone || null; }

  reset() {
    this.state = STATES.WAITING;
    this.message = 'Placez-vous dans la zone';
    this.window = [];
    this.ref = null;
    this.jump = null;
    this.lastSeen = -Infinity;
    this.stateSince = 0;
    this.driftSince = null;
    this.tiptoe = false;
    this.lastResult = null;
    this.hipHist = [];
    this.footHist = [];
  }

  _set(state, t, msg) {
    if (state !== this.state) { this.state = state; this.stateSince = t; }
    if (msg) this.message = msg;
  }

  _smooth(hist, v, n = 3) { hist.push(v); if (hist.length > n) hist.shift(); return median(hist); }

  /** frame = { t (ms), people: [extractPose(...)] } → retourne un évènement {type:'result'|'rejected'} ou null */
  update(frame) {
    const { t } = frame, P = this.p, cmPx = this.calibration.cmPerPx;

    if (this.state === STATES.RESULT) {
      if (t - this.stateSince < P.resultHoldMs) return null;
      this._toWaiting(t);
    }
    if (!this.calibration.valid) { this._toWaiting(t, 'Calibration manquante ou invalide'); return null; }

    const inside = frame.people.filter(p => p.hipOk && inZone(p.hip, this.zone));
    const multiple = inside.length > 1;
    const person = inside.length === 1 ? inside[0] : null;
    if (person) this.lastSeen = t;
    const lost = !person && (t - this.lastSeen > P.maxLostMs);

    let hipY = NaN, fL = NaN, fR = NaN;
    if (person) {
      hipY = this._smooth(this.hipHist, person.hip.y); // médiane glissante sur 3 images
      fL = person.footL.y; fR = person.footR.y;
    }

    switch (this.state) {
      case STATES.WAITING: {
        if (multiple) { this.message = 'Une seule personne dans la zone'; return null; }
        if (!person) { this.message = 'Placez-vous dans la zone'; return null; }
        if (!person.inFrame) { this.message = 'Tout le corps doit être visible (pieds compris)'; return null; }
        if (!person.feetOk) { this.message = 'Pieds mal visibles : ajustez la caméra ou l’éclairage'; return null; }
        this.window = [];
        this._set(STATES.STABILIZING, t, 'Restez immobile…');
        // pas de return : on alimente directement la fenêtre
      }
      // fallthrough
      case STATES.STABILIZING: {
        if (multiple) { this._toWaiting(t, 'Une seule personne dans la zone'); return null; }
        if (lost) { this._toWaiting(t); return null; }
        if (!person) return null;
        if (!person.feetOk || !person.inFrame) { this._toWaiting(t, 'Pieds mal visibles'); return null; }
        this.window.push({ t, hipY: person.hip.y, fL, fR });
        while (this.window.length && t - this.window[0].t > P.stableWindowMs) this.window.shift();
        const span = this.window.length ? t - this.window[0].t : 0;
        if (span >= P.stableWindowMs * 0.85 && this.window.length >= 5) {
          const hs = this.window.map(s => s.hipY);
          const sdCm = std(hs) * cmPx, rangeCm = (Math.max(...hs) - Math.min(...hs)) * cmPx;
          if (sdCm <= P.stableMaxStdCm && rangeCm <= P.stableMaxRangeCm) {
            this.ref = {
              hipY: median(hs), fL: median(this.window.map(s => s.fL)), fR: median(this.window.map(s => s.fR)),
              sdCm, t0: this.window[0].t, t1: t,
            };
            this.driftSince = null; this.tiptoe = false;
            this._set(STATES.READY, t, 'Prêt — sautez !');
          }
        }
        return null;
      }
      case STATES.READY: {
        if (multiple) { this._toWaiting(t, 'Une seule personne dans la zone'); return null; }
        if (lost) { this._toWaiting(t); return null; }
        if (!person) return null;
        const hipUp = (this.ref.hipY - hipY) * cmPx;
        const upL = (this.ref.fL - fL) * cmPx, upR = (this.ref.fR - fR) * cmPx;
        if (hipUp >= P.takeoffHipCm && upL >= P.takeoffFootCm && upR >= P.takeoffFootCm) {
          this.jump = {
            takeoffT: t, apexY: person.hip.y, apexX: person.hip.x, apexT: t, samples: 1, visSum: person.conf, lostFrames: 0,
            startFrameT: this.ref.t1, minVis: person.conf,
          };
          this._set(STATES.JUMPING, t, 'Saut en cours…');
          return null;
        }
        if (hipUp >= P.takeoffHipCm && upL < P.takeoffFootCm && upR < P.takeoffFootCm) {
          if (!this.tiptoe) { this.tiptoe = true; this.message = 'Montée sur pointes : non comptée'; }
        } else if (this.tiptoe && Math.abs(hipUp) < 1) { this.tiptoe = false; this.message = 'Prêt — sautez !'; }
        // dérive : la personne a changé de position sans sauter → nouvelle référence
        const feetDown = Math.abs(upL) < P.takeoffFootCm && Math.abs(upR) < P.takeoffFootCm;
        if (Math.abs(hipUp) > P.readyDriftCm && feetDown) {
          this.driftSince ??= t;
          if (t - this.driftSince > P.readyDriftMs) { this.window = []; this._set(STATES.STABILIZING, t, 'Restez immobile…'); }
        } else this.driftSince = null;
        return null;
      }
      case STATES.JUMPING: {
        const J = this.jump;
        if (multiple) return this._reject(t, 'Plusieurs personnes dans la zone');
        if (!person) {
          if (lost) return this._reject(t, 'Perte de suivi pendant le saut');
          J.lostFrames++; return null;
        }
        if (!person.inFrame) return this._reject(t, 'Sortie du cadre pendant le saut');
        J.samples++; J.visSum += person.conf; J.minVis = Math.min(J.minVis, person.conf);
        if (person.hip.y < J.apexY) { J.apexY = person.hip.y; J.apexX = person.hip.x; J.apexT = t; }
        if (t - J.takeoffT > P.maxFlightMs) return this._reject(t, 'Durée de vol invraisemblable');
        const upL = (this.ref.fL - fL) * cmPx, upR = (this.ref.fR - fR) * cmPx;
        if (t > J.apexT && upL <= P.landingFootCm && upR <= P.landingFootCm) {
          const flightMs = t - J.takeoffT;
          if (flightMs < P.minFlightMs) return this._reject(t, 'Saut trop court (pas de vol net)');
          const d = detenteCm(this.ref.hipY, J.apexY, cmPx);
          if (d < P.minDetenteCm) return this._reject(t, 'Élévation trop faible');
          if (d > P.maxDetenteCm) return this._reject(t, 'Valeur aberrante');
          const aiFps = (J.samples - 1) / (flightMs / 1000);
          const avgVis = J.visSum / J.samples;
          const issues = [];
          if (avgVis < P.minQualityVis) issues.push('confiance du suivi faible');
          if (aiFps < P.minAiFps) issues.push(`cadence IA faible (${aiFps.toFixed(0)} img/s)`);
          if (J.lostFrames > 1) issues.push('images perdues pendant le vol');
          if (this.ref.sdCm > P.stableMaxStdCm * 0.8) issues.push('référence peu stable');
          const res = {
            type: 'result', detenteCm: d, flightMs, flightCm: flightHeightCm(flightMs),
            refY: this.ref.hipY, apexY: J.apexY, apexX: J.apexX, refT: this.ref.t1, takeoffT: J.takeoffT, apexT: J.apexT, landT: t,
            avgVis, aiFps, uncertain: issues.length > 0, issues,
          };
          this.lastResult = res;
          this._set(STATES.RESULT, t, issues.length ? 'Mesure incertaine — vérifiez' : 'Mesure terminée');
          return res;
        }
        return null;
      }
    }
    return null;
  }

  _reject(t, reason) {
    const ev = { type: 'rejected', reason, refT: this.ref?.t1, takeoffT: this.jump?.takeoffT, t };
    this.lastResult = ev;
    this.jump = null;
    this._set(STATES.RESULT, t, 'Mesure écartée : ' + reason);
    return ev;
  }

  _toWaiting(t, msg) {
    this.window = []; this.ref = null; this.jump = null; this.hipHist = []; this.footHist = [];
    this._set(STATES.WAITING, t, msg || 'Placez-vous dans la zone');
  }
}
