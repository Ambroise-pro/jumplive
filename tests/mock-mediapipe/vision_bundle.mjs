// FAUX MediaPipe pour les tests de bout en bout (SIMULATION, pas de vrai modèle).
// Renvoie un sujet immobile puis un saut connu : extension de cheville 8 cm + vol 30 cm → détente attendue ≈ 38 cm.
// Utilisation : Paramètres > Analyse IA > Base MediaPipe = ./tests/mock-mediapipe
export const FilesetResolver = { forVisionTasks: async (path) => ({ path }) };

function profile(s, t0, hFlightCm) {
  const v0 = Math.sqrt(2 * 9.81 * hFlightCm / 100), T = 2 * v0 / 9.81 * 1000, d = s - t0;
  if (d < 0) return { rise: 0, lift: 0 };
  if (d < 250) return { rise: -15 * d / 250, lift: 0 };
  if (d < 450) return { rise: -15 + 23 * (d - 250) / 200, lift: 0 };
  const f = d - 450;
  if (f <= T) { const u = f / 1000, r = 8 + (v0 * u - 4.905 * u * u) * 100; return { rise: r, lift: Math.max(0, r - 8) }; }
  const l = f - T;
  if (l < 200) return { rise: 8 - 18 * l / 200, lift: 0 };
  if (l < 700) return { rise: -10 + 10 * (l - 200) / 500, lift: 0 };
  return { rise: 0, lift: 0 };
}

export class PoseLandmarker {
  static async createFromOptions(fileset, opts) { return new PoseLandmarker(opts); }
  constructor(opts) { this.opts = opts; this.t0 = null; }
  close() {}
  detectForVideo(video, t) {
    if (this.t0 == null) this.t0 = t;
    if (window.__MOCK_LONG) return { landmarks: [longPose(video, t - this.t0, window.__MOCK_LONG)] };
    const W = video.videoWidth, H = video.videoHeight, cmPx = window.__MOCK_CMPX ?? 0.2475;
    const period = window.__MOCK_PERIOD ?? 7000;
    const cycle = Math.floor((t - this.t0) / period), fl = window.__MOCK_FLIGHTS;
    const flight = fl ? fl[cycle % fl.length] : (window.__MOCK_FLIGHT ?? 30);   // un saut par période, hauteurs variables
    const { rise, lift } = profile((t - this.t0) % period, 2500, flight);
    const x = W * 0.5, hipY = H * 0.55 - rise / cmPx, footY = H * 0.93 - lift / cmPx;
    const n = (px, py, v = 0.95) => ({ x: px / W, y: py / H, z: 0, visibility: v });
    const l = Array.from({ length: 33 }, () => n(x, H * 0.2, 0.9));
    l[11] = n(x - 30, hipY - 120); l[12] = n(x + 30, hipY - 120);
    l[23] = n(x - 20, hipY); l[24] = n(x + 20, hipY);
    l[25] = n(x - 22, (hipY + footY) / 2); l[26] = n(x + 22, (hipY + footY) / 2);
    l[27] = n(x - 22, footY - 12); l[28] = n(x + 22, footY - 12);
    l[29] = n(x - 26, footY); l[30] = n(x + 18, footY);
    l[31] = n(x - 10, footY); l[32] = n(x + 34, footY);
    const out = { landmarks: [l] };
    if (window.__MOCK_TWO) out.landmarks.push(l.map(p => ({ ...p, x: p.x - 0.05 })));
    return out;
  }
}

// Saut en longueur vu de profil (élève tourné vers +x) : pointes à -5 cm de la ligne, réception des talons à `lands[i]` cm.
// cfg = { p0x, gy, k (px/cm), lands: [...], period }
function longPose(video, dt, cfg) {
  const W = video.videoWidth, H = video.videoHeight, k = cfg.k, period = cfg.period ?? 7000;
  const cycle = Math.floor(dt / period), s = (dt % period) - 2500, land = cfg.lands[cycle % cfg.lands.length], toe0 = -5;
  let toeCm = toe0, lift = 0, hipUp = 0;
  if (s >= 0 && s < 450) hipUp = s < 250 ? -15 * s / 250 : -15 + 15 * (s - 250) / 200;
  else if (s >= 450) {
    const f = s - 450, T = 500, heel0 = toe0 - 24;
    if (f <= T) { const u = f / T; toeCm = heel0 + (land - heel0) * u + 24; lift = 120 * u * (1 - u); hipUp = 40 * u * (1 - u); }
    else { const l = f - T; toeCm = land - (l < 150 ? l / 150 : 1) + 24; hipUp = -10; }
  }
  const X = (cm) => cfg.p0x + cm * k, toe = X(toeCm), heel = X(toeCm - 24), fy = cfg.gy - lift * k;
  const hip = { x: (toe + heel) / 2, y: cfg.gy - 95 * k - hipUp * k };
  const n = (px, py, v = 0.95) => ({ x: px / W, y: py / H, z: 0, visibility: v });
  const l = Array.from({ length: 33 }, () => n(hip.x, hip.y - 60 * k, 0.9));
  l[11] = n(hip.x, hip.y - 50 * k); l[12] = n(hip.x, hip.y - 50 * k);
  l[15] = n(hip.x + 10, hip.y - 30 * k); l[16] = n(hip.x + 10, hip.y - 30 * k);
  l[23] = n(hip.x - 3, hip.y); l[24] = n(hip.x + 3, hip.y);
  l[25] = n(hip.x + 8 * k, (hip.y + fy) / 2); l[26] = n(hip.x + 8 * k, (hip.y + fy) / 2);
  l[27] = n(heel + 3 * k - 2, fy - 8 * k); l[28] = n(heel + 3 * k + 2, fy - 8 * k);
  l[29] = n(heel - 2, fy); l[30] = n(heel + 2, fy);
  l[31] = n(toe - 2, fy); l[32] = n(toe + 2, fy);
  if (cfg.upperHidden) for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24]) l[i] = { x: hip.x / W, y: -0.05, z: 0, visibility: 0.12 }; // caméra basse
  return l;
}
