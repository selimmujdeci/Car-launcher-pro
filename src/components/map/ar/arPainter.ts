/**
 * arPainter.ts — AR sahnesinin 2B tuval çizimi.
 *
 * Karar VERMEZ: ne çizileceği `arScene` + `VisionOverlay`'de belirlenir; burada
 * yalnız boyanır. Head-unit GPU'ları (Mali-400 sınıfı) için bilinçli kısıtlar:
 *   - `ctx.filter = blur(...)` ve `shadowBlur` YOK (kare başına tam ekran bulanıklık).
 *   - Parıltı = aynı yolun geniş/düşük-alfa + dar/yüksek-alfa iki geçişi.
 *   - Gradyan nesneleri kare başına birkaç tane; yol başına tek `Path`.
 */
import type { ScreenPt } from './arScene';

/** Apple sistem renkleri (koyu görünüm) — kamera üstünde okunurluk için. */
export const AR_COLORS = {
  route: '10,132,255',     // systemBlue
  routeEdge: '100,210,255', // systemCyan
  caution: '255,159,10',   // systemOrange
  danger: '255,69,58',     // systemRed
  white: '255,255,255',
} as const;

const FONT = '600 15px -apple-system, "SF Pro Text", Inter, "Segoe UI", Roboto, system-ui, sans-serif';

/** `ctx.roundRect` Chrome 99+ — eski head-unit WebView'larında yok; elle çizilir. */
function pillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = Math.min(h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

function tracePolyline(ctx: CanvasRenderingContext2D, pts: readonly ScreenPt[]): void {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/**
 * Yol yüzeyine yatan rota halısı. Alfa derinlikle (ekran y'si ile) azalır:
 * kaputun hemen önünde belirgin, ufka doğru kaybolur — gerçek boya gibi.
 */
export function paintRibbon(
  ctx: CanvasRenderingContext2D,
  left: readonly ScreenPt[],
  right: readonly ScreenPt[],
  alpha: number,
): void {
  const n = Math.min(left.length, right.length);
  if (n < 2 || alpha <= 0) return;
  let yNear = -Infinity, yFar = Infinity;
  for (let i = 0; i < n; i++) {
    yNear = Math.max(yNear, left[i].y, right[i].y);
    yFar = Math.min(yFar, left[i].y, right[i].y);
  }
  if (!(yNear - yFar > 2)) return;

  const body = ctx.createLinearGradient(0, yNear, 0, yFar);
  /* Kaput önünde yarı saydam (yol dokusu görünür kalır), orta mesafede en
     belirgin, ufukta sıfır. Opak "mavi levha" yolu örtüyordu. */
  body.addColorStop(0, `rgba(${AR_COLORS.route},${0.10 * alpha})`);
  body.addColorStop(0.22, `rgba(${AR_COLORS.route},${0.40 * alpha})`);
  body.addColorStop(0.6, `rgba(${AR_COLORS.route},${0.34 * alpha})`);
  body.addColorStop(1, `rgba(${AR_COLORS.route},0)`);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();

  /* Kenar çizgileri — halıyı yoldan ayıran ince, parlak sınır. */
  const edge = ctx.createLinearGradient(0, yNear, 0, yFar);
  edge.addColorStop(0, `rgba(${AR_COLORS.routeEdge},${0.25 * alpha})`);
  edge.addColorStop(0.25, `rgba(${AR_COLORS.routeEdge},${0.9 * alpha})`);
  edge.addColorStop(1, `rgba(${AR_COLORS.routeEdge},0)`);
  ctx.strokeStyle = edge;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  tracePolyline(ctx, left.slice(0, n));
  tracePolyline(ctx, right.slice(0, n));
  ctx.stroke();
  ctx.restore();
}

/** Yola sabit chevron'lar; `alphas[i]` derinlik + yaklaşan dalga ışıltısı. */
export function paintChevrons(
  ctx: CanvasRenderingContext2D,
  polys: readonly (readonly ScreenPt[])[],
  alphas: readonly number[],
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    const a = alphas[i];
    if (poly.length < 3 || !(a > 0.02)) continue;
    ctx.beginPath();
    tracePolyline(ctx, poly);
    ctx.closePath();
    ctx.fillStyle = `rgba(${AR_COLORS.white},${a})`;
    ctx.fill();
  }
  ctx.restore();
}

export type LeadTone = 'tracked' | 'headway' | 'collision';

/**
 * ADAS'ın izlediği öndeki araç — köşe parantezleri (dolu kutu değil; aracı
 * örtmez). Renk ADAS hükmüdür: izleniyor (beyaz) · takip mesafesi (turuncu) ·
 * çarpışma (kırmızı, nabızlı).
 */
export function paintLeadBracket(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  tone: LeadTone,
  label: string | null,
  pulse: number,
): void {
  const rgb = tone === 'collision' ? AR_COLORS.danger : tone === 'headway' ? AR_COLORS.caution : AR_COLORS.white;
  const a = tone === 'tracked' ? 0.85 : 0.75 + 0.25 * pulse;
  const L = Math.max(10, Math.min(box.w, box.h) * 0.22);
  const { x, y, w, h } = box;

  ctx.save();
  if (tone === 'collision') {
    ctx.fillStyle = `rgba(${rgb},${0.10 + 0.14 * pulse})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = `rgba(${rgb},${a})`;
  ctx.lineWidth = tone === 'tracked' ? 3 : 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
  ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
  ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
  ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
  ctx.stroke();

  if (label) {
    ctx.font = FONT;
    const tw = ctx.measureText(label).width;
    const pw = tw + 20, ph = 26;
    const px = x + w / 2 - pw / 2, py = y + h + 8;
    ctx.fillStyle = tone === 'tracked' ? 'rgba(28,28,30,0.78)' : `rgba(${rgb},0.92)`;
    pillPath(ctx, px, py, pw, ph);
    ctx.fill();
    ctx.fillStyle = tone === 'tracked' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.88)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, py + ph / 2 + 0.5);
  }
  ctx.restore();
}

/**
 * Şerit ayrılma uyarısının MEKÂNSAL karşılığı: aşılan şerit çizgisi kırmızı
 * vurgulanır, o taraftaki ekran kenarı kızarır. Uyarı metni/sesi
 * SafetyOverlay'indir — burada yalnız "hangi çizgi" gösterilir.
 */
export function paintLaneEdge(
  ctx: CanvasRenderingContext2D,
  side: 'left' | 'right',
  line: readonly [ScreenPt, ScreenPt] | null,
  w: number,
  h: number,
  pulse: number,
): void {
  ctx.save();
  /* Alt köşeden yayılan parlama — sert kenarlı dikdörtgen gökyüzünde blok gibi duruyordu. */
  const x0 = side === 'left' ? 0 : w;
  const r = Math.max(w * 0.42, h * 0.8);
  const g = ctx.createRadialGradient(x0, h, 0, x0, h, r);
  g.addColorStop(0, `rgba(${AR_COLORS.danger},${0.34 + 0.18 * pulse})`);
  g.addColorStop(0.55, `rgba(${AR_COLORS.danger},${0.12 + 0.06 * pulse})`);
  g.addColorStop(1, `rgba(${AR_COLORS.danger},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(side === 'left' ? 0 : w - r, h - r, r, r);

  if (line) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${AR_COLORS.danger},0.28)`;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y); ctx.lineTo(line[1].x, line[1].y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${AR_COLORS.danger},${0.8 + 0.2 * pulse})`;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  ctx.restore();
}
