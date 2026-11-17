// Générateur de scènes synthétiques (géométrie connue) pour tester la détection.
import { MARKER } from '../a4detect.js';

/* ---------- Rendu d'une scène ---------- */
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Scène W×H avec une feuille A4 (hauteur heightPx, inclinaison tiltDeg), marqueurs optionnels. */
export function scene({ W = 1280, H = 720, cx = 640, cy = 360, heightPx = 140, tiltDeg = 0, markers = true,
  bg = 'gradient', noise = 6, blur = true, distractors = false, sheet = true, paper = 232 } = {}) {
  seed = 12345;
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    lum[y * W + x] = bg === 'dark' ? 60 : bg === 'bright' ? 170 + 30 * (x / W) : 70 + 70 * (x / W) + 20 * (y / H);
  }
  const rects = [];
  if (distractors) {
    rects.push({ x: 60, y: 40, w: 260, h: 150, v: 245 });   // fenêtre lumineuse (paysage)
    rects.push({ x: 980, y: 80, w: 160, h: 160, v: 240 });  // panneau carré clair
    rects.push({ x: 300, y: 380, w: 120, h: 300, v: 35 });  // silhouette sombre
    rects.push({ x: 1050, y: 450, w: 40, h: 40, v: 20 });   // carré noir isolé
    rects.push({ x: 1150, y: 450, w: 40, h: 40, v: 20 });
    for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) lum[y * W + x] = r.v;
  }
  if (sheet) {
    const s = heightPx / 297, th = tiltDeg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    const inSheet = (x, y) => {
      const dx = x - cx, dy = y - cy, u = (c * dx + sn * dy) / s + 105, v = (-sn * dx + c * dy) / s + 148.5;
      if (u < 0 || u > 210 || v < 0 || v > 297) return null;
      if (markers) {
        const half = MARKER.sideMm / 2, hole = MARKER.holeMm / 2, top = 148.5 - MARKER.distMm / 2, bot = 148.5 + MARKER.distMm / 2;
        for (const my of [top, bot]) {
          const au = Math.abs(u - 105), av = Math.abs(v - my);
          if (au < half && av < half && !(au < hole && av < hole)) return 25;
        }
        if (Math.abs(v - 148.5) < 0.4 && u > 55 && u < 155) return 40; // règle de contrôle
      }
      return paper;
    };
    const R = heightPx * 0.8;
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(H, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(W, cx + R); x++) {
      let acc = 0, n = 0, hit = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const v = inSheet(x + (a + 0.5) / 4, y + (b + 0.5) / 4); n++;
        if (v != null) { acc += v; hit++; } else acc += lum[y * W + x];
      }
      if (hit) lum[y * W + x] = acc / n;
    }
  }
  let out = lum;
  if (blur) { // flou 3×3 léger (optique)
    out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const wgt = dx || dy ? (dx && dy ? 0.5 : 1) : 2; s += lum[yy * W + xx] * wgt; n += wgt;
      }
      out[y * W + x] = s / n;
    }
  }
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = out[i] + (rnd() - 0.5) * 2 * noise;
    data[4 * i] = v; data[4 * i + 1] = v; data[4 * i + 2] = v; data[4 * i + 3] = 255;
  }
  return { data, width: W, height: H };
}

