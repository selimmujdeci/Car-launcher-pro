/**
 * visionTypes.ts — Vision Engine tip sözlüğü.
 *
 * Tüm interface ve enum tanımları burada; runtime değer üretmez.
 * Diğer vision modülleri bu dosyadan import alır — dairesel bağımlılık riski yok.
 */

// ── Pinhole kamera modeli ─────────────────────────────────────────────────────

export interface CameraIntrinsics {
  /** Focal length (piksel) — kare piksel varsayımıyla fx = fy */
  fx: number;
  /** Principal point X (piksel) */
  cx: number;
  /** Principal point Y (piksel) */
  cy: number;
}

// ── Ok projeksiyon aralığı ───────────────────────────────────────────────────

export interface ArrowProjectionRange {
  /** Ok kuyruğu — araçtan ilerideki mesafe (m) */
  fwdNear: number;
  /** Ok ucu — araçtan ilerideki mesafe (m) */
  fwdFar:  number;
}

// ── Derinlik bazlı render ipuçları ──────────────────────────────────────────

export interface ArrowDepthHints {
  /** Kamera derinliği (m) */
  avgDepthM:   number;
  /** Opaklık çarpanı [0–1] */
  alpha:       number;
  /** Çizgi kalınlığı çarpanı [0–1] */
  strokeScale: number;
  /** Dünya-uzayı boyut çarpanı (Stevens güç yasası, γ=0.65) */
  sizeScale:   number;
}

// ── Yol yüzeyi ok vertexleri ─────────────────────────────────────────────────

export interface ArrowVertex {
  /** Araç başlığından sağa (m, negatif = sol) */
  right:  number;
  /** Araçtan ileride (m) */
  fwd:    number;
  /** Projeksiyon sonucu ekran pikseli — null = ekran dışı */
  screen: { x: number; y: number } | null;
}

export interface GroundArrow {
  /** 7 chevron vertex — yol yüzeyine projekte edilmiş */
  vertices: ArrowVertex[];
  /** Derinlik bazlı render ipuçları */
  hints:    ArrowDepthHints;
}

// ── Rota polilini örnekleme ──────────────────────────────────────────────────

export interface RouteSample {
  /** Araç başlığına göre sağa (m) */
  right:              number;
  /** Araçtan ileride (m) */
  fwd:                number;
  /** Yerel rota teğet yönü (0° = düz, +90° = sağ) */
  localBearingDeg:    number;
  /** Araçtan bu noktaya kümülatif toplam dönüş (°) */
  cumulativeTurnDeg:  number;
}

export interface RouteChevron {
  tip:   { x: number; y: number } | null;
  left:  { x: number; y: number } | null;
  right: { x: number; y: number } | null;
  hints: ArrowDepthHints;
}

export interface RouteSampleParams {
  minSpacingM: number;
  maxSamples:  number;
  minPixelGap: number;
}

// ── Şerit hizalama ────────────────────────────────────────────────────────────

export interface LaneEstimate {
  laneOffsetM: number;
  laneWidthM:  number;
  confidence:  number;
}

// ── Gecikme tahmini ───────────────────────────────────────────────────────────

export interface LatencyPrediction {
  lat:        number;
  lon:        number;
  headingDeg: number;
  latencyMs:  number;
}

// ── Chevron vurgu rolü ───────────────────────────────────────────────────────

export type ChevronRole = 'primary' | 'secondary';

export interface EmphasizedChevron extends RouteChevron {
  role: ChevronRole;
}
