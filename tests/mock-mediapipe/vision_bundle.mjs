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
    const W = video.videoWidth, H = video.videoHeight, cmPx = window.__MOCK_CMPX ?? 0.2475;
    const period = window.__MOCK_PERIOD ?? 7000;
    const { rise, lift } = profile((t - this.t0) % period, 2500, window.__MOCK_FLIGHT ?? 30);
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
