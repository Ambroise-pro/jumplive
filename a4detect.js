// JumpMeasure LIVE — détection automatique de l'étalon de calibration.
// Trois méthodes :
//   1. detectWhiteSheet : feuille A4 blanche, JavaScript pur (seuils + composantes connexes + bords sous-pixel)
//   2. detectSheetOpenCV : feuille A4 blanche, OpenCV.js (contours + quadrilatère + coins sous-pixel)
//   3. detectMarkers : feuille imprimée à deux marqueurs carrés (centres à distance connue)
// Entrée : un objet type ImageData { data (RGBA), width, height } au repère NATIF de la caméra.
// Sortie : { ok, method, p1 (haut), p2 (bas), refCm, heightPx, confidence (0..1), ms, quad?, markers?, reason? }

export const A4_CM = 29.7;
export const A4_RATIO = 297 / 210;
export const MARKER = { sideMm: 40, holeMm: 16, distMm: 200 };

const now = () => (globalThis.performance?.now?.() ?? Date.now());

/* ---------- Outils image ---------- */

export function toGray(img) {
  const { data, width: w, height: h } = img, g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return { g, w, h };
}

export function downscale(G, f) {
  if (f <= 1) return G;
  const w = Math.floor(G.w / f), h = Math.floor(G.h / f), g = new Float32Array(w * h), n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = 0; dy < f; dy++) { const row = (y * f + dy) * G.w + x * f; for (let dx = 0; dx < f; dx++) s += G.g[row + dx]; }
    g[y * w + x] = s / n;
  }
  return { g, w, h };
}

export function integral(G) {
  const { g, w, h } = G, W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  return { I, W, w, h };
}

/** Somme sur [x0,x1[ × [y0,y1[ (bornes ramenées dans l'image). */
export function boxSum(S, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.min(S.w, Math.round(x0))); x1 = Math.max(0, Math.min(S.w, Math.round(x1)));
  y0 = Math.max(0, Math.min(S.h, Math.round(y0))); y1 = Math.max(0, Math.min(S.h, Math.round(y1)));
  if (x1 <= x0 || y1 <= y0) return { sum: 0, n: 0 };
  const I = S.I, W = S.W;
  return { sum: I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0], n: (x1 - x0) * (y1 - y0) };
}
const boxMean = (S, x0, y0, x1, y1) => { const r = boxSum(S, x0, y0, x1, y1); return r.n ? r.sum / r.n : NaN; };
/** Moyenne de l'anneau entre le rectangle intérieur et le rectangle extérieur. */
function ringMean(S, x0, y0, x1, y1, m) {
  const o = boxSum(S, x0 - m, y0 - m, x1 + m, y1 + m), i = boxSum(S, x0, y0, x1, y1);
  return o.n - i.n > 0 ? (o.sum - i.sum) / (o.n - i.n) : NaN;
}

/** Composantes 4-connexes d'un masque, avec statistiques. */
export function labelComponents(mask, w, h, gray) {
  const labels = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [];
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    id++;
    const c = { id, count: 0, minX: w, maxX: -1, minY: h, maxY: -1, sumX: 0, sumY: 0, sumL: 0 };
    let sp = 0; stack[sp++] = i; labels[i] = id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      c.count++; c.sumX += x; c.sumY += y; if (gray) c.sumL += gray[p];
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      if (x > 0) { const q = p - 1; if (mask[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; } }
      if (x < w - 1) { const q = p + 1; if (mask[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; } }
      if (y > 0) { const q = p - w; if (mask[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; } }
      if (y < h - 1) { const q = p + w; if (mask[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; } }
    }
    comps.push(c);
  }
  return { labels, comps };
}

function histogram(g) { const H = new Float64Array(256); for (const v of g) H[Math.max(0, Math.min(255, v | 0))]++; return H; }
function percentile(H, total, p) { let s = 0; for (let i = 0; i < 256; i++) { s += H[i]; if (s >= total * p) return i; } return 255; }
function otsu(H, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * H[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += H[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sB += t * H[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Droite y = a·x + b robuste (moindres carrés, rejet itératif des points aberrants). */
export function fitLine(pts) {
  let use = pts, a = 0, b = 0;
  for (let pass = 0; pass < 3; pass++) {
    if (use.length < 2) break;
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = use.length;
    for (const p of use) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
    const den = n * sxx - sx * sx; a = den ? (n * sxy - sx * sy) / den : 0; b = (sy - a * sx) / n;
    const res = pts.map(p => Math.abs(p.y - (a * p.x + b))), thr = Math.max(0.8, 2.5 * median(res));
    use = pts.filter((p, i) => res[i] < thr);
  }
  const res = use.map(p => p.y - (a * p.x + b));
  return { a, b, n: use.length, rms: Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, res.length)) };
}

/** Position sous-pixel du maximum d'un gradient vertical dans une colonne. */
function edgeInColumn(G, x, y0, y1, sign) {
  const { g, w, h } = G;
  y0 = Math.max(2, Math.floor(y0)); y1 = Math.min(h - 3, Math.ceil(y1));
  const col = (y) => g[y * w + x - 1] + g[y * w + x] + g[y * w + x + 1];
  const grad = (y) => sign * (col(y + 1) - col(y - 1)) / 3;
  let best = -Infinity, by = -1;
  for (let y = y0; y <= y1; y++) { const v = grad(y); if (v > best) { best = v; by = y; } }
  if (by < 0 || best < 10) return null;
  const gm = grad(by - 1), gp = grad(by + 1), d = gm - 2 * best + gp;
  const off = d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (gm - gp) / d)) : 0;
  return { y: by + off, strength: best };
}

/**
 * Affine les bords haut et bas d'une feuille à partir d'un quadrilatère approximatif [tl, tr, br, bl]
 * (gradient vertical sous-pixel colonne par colonne, droites robustes). Renvoie p1/p2 et la hauteur
 * mesurée perpendiculairement aux bords, ou null.
 */
export function refineTopBottom(G, quad, searchPx = 6) {
  const [tl, tr, br, bl] = quad;
  const top = [], bot = [];
  const xa = Math.max(tl.x, bl.x), xb = Math.min(tr.x, br.x), wq = xb - xa;
  if (wq < 6) return null;
  const lineY = (p, q, x) => p.y + (q.y - p.y) * (x - p.x) / ((q.x - p.x) || 1e-9);
  for (let x = Math.round(xa + 0.2 * wq); x <= Math.round(xb - 0.2 * wq); x++) {
    if (x < 2 || x > G.w - 3) continue;
    const yt = lineY(tl, tr, x), yb = lineY(bl, br, x);
    const et = edgeInColumn(G, x, yt - searchPx, yt + searchPx, +1), eb = edgeInColumn(G, x, yb - searchPx, yb + searchPx, -1);
    if (et) top.push({ x, y: et.y }); if (eb) bot.push({ x, y: eb.y });
  }
  if (top.length < 5 || bot.length < 5) return null;
  const lt = fitLine(top), lb = fitLine(bot);
  const cx = (xa + xb) / 2, a = (lt.a + lb.a) / 2, th = Math.atan(a);
  const yT = lt.a * cx + lt.b, yB = lb.a * cx + lb.b, d = (yB - yT) * Math.cos(th);
  return { p1: { x: cx, y: yT }, p2: { x: cx - d * Math.sin(th), y: yT + d * Math.cos(th) }, d, lt, lb };
}

/* ---------- 1. Feuille blanche, JavaScript pur ---------- */

export function detectWhiteSheet(img, opt = {}) {
  const t0 = now();
  const G = toGray(img);
  const f = Math.max(1, Math.round(G.w / (opt.analysisWidth ?? 640)));
  const D = downscale(G, f), SI = integral(D), N = D.w * D.h;
  const H = histogram(D.g);
  const ths = [...new Set([otsu(H, N), ...[0.6, 0.75, 0.85, 0.92, 0.96].map(p => percentile(H, N, p))])].filter(t => t < 250);
  const minArea = Math.max(120, N * 0.0003);
  const mask = new Uint8Array(N);
  const cands = [];
  for (const T of ths) {
    for (let i = 0; i < N; i++) mask[i] = D.g[i] > T ? 1 : 0;
    const { labels, comps } = labelComponents(mask, D.w, D.h, D.g);
    for (const c of comps) {
      if (c.count < minArea) continue;
      if (c.minX <= 1 || c.minY <= 1 || c.maxX >= D.w - 2 || c.maxY >= D.h - 2) continue;
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1, aspect = bh / bw, fill = c.count / (bw * bh);
      if (aspect < 1.0 || aspect > 2.0 || fill < 0.72) continue;
      const inMean = c.sumL / c.count, ring = ringMean(SI, c.minX, c.minY, c.maxX + 1, c.maxY + 1, Math.max(3, Math.round(bw * 0.15)));
      const contrast = inMean - ring;
      if (!(contrast >= 18)) continue;
      const aspectScore = Math.max(0, 1 - Math.abs(Math.log(aspect / A4_RATIO)) * 3);
      const score = aspectScore * Math.min(1, (fill - 0.72) / 0.2) * Math.min(1, contrast / 50);
      if (score <= 0.05) continue;
      cands.push({ c, score, labels, T, bw, bh, aspect, fill, contrast });
    }
  }
  if (!cands.length) return { ok: false, method: 'white', reason: 'Aucune forme claire aux proportions d’une A4 verticale', ms: now() - t0 };
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  // une autre forme bien notée et à un autre endroit → ambiguïté
  const rival = cands.find(k => k.score > best.score * 0.8 && Math.hypot(k.c.sumX / k.c.count - best.c.sumX / best.c.count, k.c.sumY / k.c.count - best.c.sumY / best.c.count) > best.bw);
  const { c, labels } = best;

  // bords haut/bas colonne par colonne dans l'image native
  const top = [], bot = [];
  const xd0 = Math.round(c.minX + best.bw * 0.2), xd1 = Math.round(c.maxX - best.bw * 0.2);
  for (let xd = xd0; xd <= xd1; xd++) {
    let yt = -1, yb = -1;
    for (let y = c.minY; y <= c.maxY; y++) if (labels[y * D.w + xd] === c.id) { if (yt < 0) yt = y; yb = y; }
    if (yt < 0) continue;
    for (let k = 0; k < f; k++) {
      const x = xd * f + k; if (x < 2 || x > G.w - 3) continue;
      const ct = yt * f, cb = (yb + 1) * f - 1, R = f + 3;
      const et = edgeInColumn(G, x, ct - R, ct + R, +1), eb = edgeInColumn(G, x, cb - R, cb + R, -1);
      if (et) top.push({ x, y: et.y }); if (eb) bot.push({ x, y: eb.y });
    }
  }
  if (top.length < 5 || bot.length < 5) return { ok: false, method: 'white', reason: 'Bords haut/bas de la feuille trop flous', ms: now() - t0 };
  const lt = fitLine(top), lb = fitLine(bot);
  const x0 = c.minX * f, x1 = (c.maxX + 1) * f, cx = (x0 + x1) / 2;
  const a = (lt.a + lb.a) / 2, th = Math.atan(a);
  const yT = lt.a * cx + lt.b, yB = lb.a * cx + lb.b;
  const d = (yB - yT) * Math.cos(th);
  const p1 = { x: cx, y: yT }, p2 = { x: cx - d * Math.sin(th), y: yT + d * Math.cos(th) };
  const sharp = Math.min(1, 1.2 / Math.max(0.3, (lt.rms + lb.rms) / 2));
  let confidence = best.score * (0.6 + 0.4 * sharp) * (Math.abs(lt.a - lb.a) < 0.05 ? 1 : 0.6);
  const warnings = [];
  if (rival) { confidence *= 0.6; warnings.push('Autre forme claire comparable dans l’image'); }
  return {
    ok: true, method: 'white', p1, p2, refCm: A4_CM, heightPx: d, confidence, ms: now() - t0, warnings,
    quad: [{ x: x0, y: lt.a * x0 + lt.b }, { x: x1, y: lt.a * x1 + lt.b }, { x: x1, y: lb.a * x1 + lb.b }, { x: x0, y: lb.a * x0 + lb.b }],
    debug: { threshold: best.T, aspect: best.aspect, fill: best.fill, contrast: best.contrast, edgeRms: [lt.rms, lb.rms], candidates: cands.length },
  };
}

/* ---------- 3. Feuille imprimée à deux marqueurs ---------- */

function findMarkerCandidates(G, S, r) {
  const { g, w, h } = G, N = w * h, mask = new Uint8Array(N);
  for (let y = 0; y < h; y++) {
    const y0 = y - r, y1 = y + r + 1;
    for (let x = 0; x < w; x++) {
      const m = boxMean(S, x - r, y0, x + r + 1, y1), v = g[y * w + x];
      if (v < m - Math.max(15, 0.2 * m)) mask[y * w + x] = 1;
    }
  }
  const { comps } = labelComponents(mask, w, h, g);
  const out = [];
  for (const c of comps) {
    if (c.count < 25) continue;
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    if (bw < 6 || bh < 6 || bw / bh < 0.6 || bw / bh > 1.6) continue;
    if (c.minX < 2 || c.minY < 2 || c.maxX > w - 3 || c.maxY > h - 3) continue;
    const fill = c.count / (bw * bh);
    if (fill < 0.5 || fill > 0.97) continue;
    const darkMean = c.sumL / c.count;
    const m = Math.max(2, Math.round(Math.max(bw, bh) * 0.3));
    const surround = ringMean(S, c.minX, c.minY, c.maxX + 1, c.maxY + 1, m);
    const contrast = surround - darkMean;
    if (!(contrast >= 30)) continue;
    const cxb = (c.minX + c.maxX + 1) / 2, cyb = (c.minY + c.maxY + 1) / 2, hs = Math.max(1, Math.min(bw, bh) * 0.12);
    const holeMean = boxMean(S, cxb - hs, cyb - hs, cxb + hs, cyb + hs);
    if (!(holeMean > darkMean + 0.35 * contrast)) continue;
    // centre sous-pixel : barycentre pondéré par la « noirceur »
    let sw = 0, sx = 0, sy = 0;
    for (let y = c.minY - 2; y <= c.maxY + 2; y++) for (let x = c.minX - 2; x <= c.maxX + 2; x++) {
      const wgt = Math.max(0, Math.min(contrast, surround - g[y * w + x]));
      sw += wgt; sx += wgt * x; sy += wgt * y;
    }
    const side = Math.sqrt(c.count / (1 - (MARKER.holeMm / MARKER.sideMm) ** 2));
    const squareScore = Math.max(0, 1 - Math.abs(fill - 0.84) * 2.5);
    out.push({ x: sx / sw, y: sy / sw, side, bw, bh, fill, contrast, darkMean, surround, squareScore,
      box: { x: c.minX, y: c.minY, w: bw, h: bh } });
  }
  return out;
}

export function detectMarkers(img, opt = {}) {
  const t0 = now();
  const G = toGray(img), S = integral(G);
  const ratio = MARKER.distMm / MARKER.sideMm;
  const refCm = opt.distCm ?? MARKER.distMm / 10;
  let best = null, nCand = 0, pairs = 0;
  for (const r of [Math.round(Math.min(G.w, G.h) / 10), Math.round(Math.min(G.w, G.h) / 30)]) {
    const cands = findMarkerCandidates(G, S, Math.max(6, r));
    nCand = Math.max(nCand, cands.length);
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
      let A = cands[i], B = cands[j];
      if (A.y > B.y) [A, B] = [B, A];
      const sr = A.side / B.side; if (sr < 0.75 || sr > 1.33) continue;
      const dx = B.x - A.x, dy = B.y - A.y, dist = Math.hypot(dx, dy);
      if (dy <= 0 || Math.abs(dx) > 0.35 * dy) continue;
      const side = (A.side + B.side) / 2, rr = dist / side;
      if (rr < ratio * 0.75 || rr > ratio * 1.3) continue;
      // le papier entre les deux marqueurs doit être clair
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, mid = boxMean(S, mx - side / 2, my - side / 2, mx + side / 2, my + side / 2);
      const paper = (A.surround + B.surround) / 2;
      if (!(mid > paper - 0.35 * (A.contrast + B.contrast) / 2)) continue;
      pairs++;
      const score = Math.max(0, 1 - Math.abs(rr / ratio - 1) * 3) * (1 - Math.abs(Math.log(sr)) * 2)
        * (A.squareScore + B.squareScore) / 2 * Math.min(1, Math.min(A.contrast, B.contrast) / 80);
      if (!best || score > best.score) best = { A, B, score, dist };
    }
    if (best && best.score > 0.3) break;
  }
  if (!best || best.score <= 0.05) {
    return { ok: false, method: 'markers', reason: nCand ? 'Marqueurs trouvés mais pas la paire attendue (feuille incomplète ou trop inclinée ?)' : 'Aucun marqueur détecté', ms: now() - t0 };
  }
  const { A, B } = best;
  const warnings = [];
  if (Math.min(A.side, B.side) < 10) warnings.push('Marqueurs très petits à l’image : rapprochez la caméra ou augmentez la résolution');
  return {
    ok: true, method: 'markers', p1: { x: A.x, y: A.y }, p2: { x: B.x, y: B.y }, refCm, heightPx: best.dist,
    confidence: Math.min(1, best.score), ms: now() - t0, warnings,
    markers: [A.box, B.box], debug: { candidates: nCand, pairs, sides: [A.side, B.side] },
  };
}

/* ---------- 2. Feuille blanche, OpenCV.js ---------- */

export function detectSheetOpenCV(cv, img) {
  const t0 = now();
  const mats = [];
  const M = (m) => { mats.push(m); return m; };
  try {
    const src = M(cv.matFromImageData(img));
    const gray = M(new cv.Mat()); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blur = M(new cv.Mat()); cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const W = img.width, H = img.height, minArea = Math.max(400, W * H * 0.0008);
    const gd = gray.data; // Uint8Array
    const lum = (x, y) => { x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y))); return gd[y * W + x]; };
    const cands = [];
    const evaluate = (pts) => {
      const s = [...pts].sort((p, q) => p.y - q.y);
      const [tl, tr] = s.slice(0, 2).sort((p, q) => p.x - q.x), [bl, br] = s.slice(2).sort((p, q) => p.x - q.x);
      const L = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
      const h = (L(tl, bl) + L(tr, br)) / 2, w = (L(tl, tr) + L(bl, br)) / 2;
      if (w < 8) return;
      const aspect = h / w; if (aspect < 1.1 || aspect > 1.85) return;
      // luminance intérieure (grille) et extérieure (points décalés vers l'extérieur)
      const bil = (u, v) => ({ x: tl.x * (1 - u) * (1 - v) + tr.x * u * (1 - v) + bl.x * (1 - u) * v + br.x * u * v,
        y: tl.y * (1 - u) * (1 - v) + tr.y * u * (1 - v) + bl.y * (1 - u) * v + br.y * u * v });
      let si = 0, ni = 0, so = 0, no = 0;
      for (let u = 0.2; u <= 0.81; u += 0.15) for (let v = 0.1; v <= 0.91; v += 0.1) { const p = bil(u, v); si += lum(p.x, p.y); ni++; }
      for (const t of [0.25, 0.5, 0.75]) for (const [u, v] of [[t, -0.08], [t, 1.08], [-0.12, t], [1.12, t]]) { const p = bil(u, v); so += lum(p.x, p.y); no++; }
      const contrast = si / ni - so / no; if (contrast < 18) return;
      const aspectScore = Math.max(0, 1 - Math.abs(Math.log(aspect / A4_RATIO)) * 3);
      const par = 1 - Math.min(1, Math.abs(L(tl, bl) - L(tr, br)) / h * 4);
      cands.push({ tl, tr, bl, br, h, w, aspect, contrast, score: aspectScore * Math.min(1, contrast / 50) * (0.5 + 0.5 * par) });
    };
    const scan = (bin) => {
      const contours = M(new cv.MatVector()), hier = M(new cv.Mat());
      cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        if (cv.contourArea(c) >= minArea) {
          const approx = new cv.Mat(); cv.approxPolyDP(c, approx, 0.025 * cv.arcLength(c, true), true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const d = approx.data32S; evaluate([0, 1, 2, 3].map(k => ({ x: d[2 * k], y: d[2 * k + 1] })));
          }
          approx.delete();
        }
        c.delete();
      }
    };
    const edges = M(new cv.Mat()); cv.Canny(blur, edges, 40, 120);
    const k = M(cv.Mat.ones(3, 3, cv.CV_8U)); const dil = M(new cv.Mat()); cv.dilate(edges, dil, k);
    scan(dil);
    const th = M(new cv.Mat()); cv.threshold(blur, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); scan(th);
    const ad = M(new cv.Mat()); cv.adaptiveThreshold(blur, ad, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 2 * Math.round(Math.min(W, H) / 16) + 1, -10); scan(ad);
    if (!cands.length) return { ok: false, method: 'opencv', reason: 'Aucun quadrilatère clair aux proportions d’une A4 verticale', ms: now() - t0 };
    cands.sort((a, b) => b.score - a.score || b.h - a.h);
    const best = cands[0];
    const rival = cands.find(q => q.score > best.score * 0.8 && Math.hypot(q.tl.x - best.tl.x, q.tl.y - best.tl.y) > best.w);
    // coins sous-pixel
    const corners = [best.tl, best.tr, best.br, best.bl];
    const cm = M(cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(p => [p.x, p.y])));
    try {
      cv.cornerSubPix(gray, cm, new cv.Size(5, 5), new cv.Size(-1, -1), new cv.TermCriteria(cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_MAX_ITER, 30, 0.01));
      const r = cm.data32F;
      corners.forEach((p, i) => { const q = { x: r[2 * i], y: r[2 * i + 1] }; if (Math.hypot(q.x - p.x, q.y - p.y) < 4) { p.x = q.x; p.y = q.y; } });
    } catch { /* coins entiers conservés */ }
    const [tl, tr, br, bl] = corners;
    // Les contours OpenCV sont décalés d'environ 1 px vers l'intérieur : on remesure les bords haut et bas
    // au gradient sous-pixel (même méthode que la détection JS).
    const Gf = { g: Float32Array.from(gd), w: W, h: H };
    const ref = refineTopBottom(Gf, [tl, tr, br, bl], 6);
    const p1 = ref ? ref.p1 : { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
    const p2 = ref ? ref.p2 : { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
    const warnings = [];
    let confidence = best.score;
    if (rival) { confidence *= 0.6; warnings.push('Autre quadrilatère clair comparable dans l’image'); }
    if (!ref) { confidence *= 0.5; warnings.push('Bords flous : mesure sur les contours OpenCV (≈1 px de biais)'); }
    return { ok: true, method: 'opencv', p1, p2, refCm: A4_CM, heightPx: Math.hypot(p2.x - p1.x, p2.y - p1.y), confidence, ms: now() - t0,
      warnings, quad: [tl, tr, br, bl], debug: { candidates: cands.length, aspect: best.aspect, contrast: best.contrast } };
  } finally {
    mats.forEach(m => { try { m.delete(); } catch { } });
  }
}

/* ---------- Combinaison de plusieurs images ---------- */

/** Fusionne les détections de plusieurs images : médiane des points, dispersion, taux de réussite. */
export function combineDetections(results) {
  const ok = results.filter(r => r.ok);
  if (!ok.length) return { ...(results[results.length - 1] || { ok: false, reason: 'Aucune image analysée' }), frames: results.length, success: 0 };
  const md = (f) => median(ok.map(f));
  const p1 = { x: md(r => r.p1.x), y: md(r => r.p1.y) }, p2 = { x: md(r => r.p2.x), y: md(r => r.p2.y) };
  const hs = ok.map(r => Math.hypot(r.p2.x - r.p1.x, r.p2.y - r.p1.y)), hm = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const spread = hs.length > 1 ? Math.sqrt(hs.reduce((s, h) => s + (h - hm) ** 2, 0) / (hs.length - 1)) : 0;
  const rate = ok.length / results.length;
  const ref = ok[ok.length >> 1];
  return { ...ref, p1, p2, heightPx: hm, spreadPx: spread, frames: results.length, success: ok.length,
    confidence: md(r => r.confidence) * rate * (spread > 1.5 ? 0.7 : 1), ms: md(r => r.ms),
    warnings: [...new Set(ok.flatMap(r => r.warnings || []))] };
}
