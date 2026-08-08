/**
 * paintedArrowModel.ts — YOLA BOYANMIŞ MANEVRA OKUNUN tek kanonik üreticisi (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · harita API'si YOK · React YOK ·
 * global durum YOK. Girdi dışarıdan gelir → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE YAPAR ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Yaklaşan dönüşü haritanın ÜSTÜNDE bir sembol olarak değil, **yolun kendi
 * yüzeyinde** gösterir: rota geometrisi üzerinde manevra noktasından geriye
 * yürüyüp bir gövde, ileriye yürüyüp bir ok ucu üretir ve bunları TEK bir
 * coğrafi poligon olarak döndürür.
 *
 * Poligon lat/lon uzayındadır ve `fill` katmanı olarak çizilir — yani zemin
 * düzlemine aittir. Kamera eğildiğinde perspektif onu asfalta KENDİLİĞİNDEN
 * yatırır; ayrıca bir 3B dönüşüm ya da ekran-uzayı hizalaması GEREKMEZ.
 * Sembol katmanıyla yapılsaydı ok havada durur, eğimle birlikte kayardı.
 *
 * ── DÜRÜSTLÜK SÖZLEŞMESİ ──────────────────────────────────────────────────
 * Ok bir İDDİADIR: "şu şeritten şuraya döneceksin". Dayanağı yoksa ÇİZİLMEZ.
 * Bu yüzden fonksiyon boolean değil, GEREKÇELİ bir hüküm döndürür — gizlenme
 * sebebi LAB'da sayılabilsin diye (`wakeDecisionModel` ile aynı disiplin).
 * "Çizemedim" ile "çizmeye gerek yoktu" AYNI ŞEY DEĞİLDİR.
 *
 * ── ÖLÇEK ─────────────────────────────────────────────────────────────────
 * Tüm mesafeler yerel düz-düzlem yaklaşımıyla hesaplanır. Ok en fazla ~50 m
 * uzanır; bu ölçekte enlem/boylam ölçeklemesi yeterlidir ve haversine'in
 * trigonometrik maliyeti hot-path'e sokulmaz.
 */

/** Okun neden çizilmediği — sayılabilir, LAB'da gösterilebilir. */
export type PaintedArrowHiddenReason =
  /** Navigasyon aktif değil. */
  | 'NAV_INACTIVE'
  /** Rota geometrisi yok ya da çok kısa. */
  | 'NO_GEOMETRY'
  /** Manevra noktası geometriye BAĞLANAMADI (`geometryIndex < 0`). */
  | 'ANCHOR_UNRESOLVED'
  /** Manevraya mesafe ölçülemedi — kesin bir şey çizilemez. */
  | 'DISTANCE_UNKNOWN'
  /** Henüz uzak; erken çizim ekranı kirletir ve yanlış kavşağa işaret eder. */
  | 'TOO_FAR'
  /** Dönüşün içindeyiz; ok artık geride kalır ve yanıltır. */
  | 'TOO_CLOSE'
  /** Düz devam / varış / kalkış — boyanacak bir dönüş yok. */
  | 'NOT_A_TURN'
  /** Geometri manevranın çevresinde ok üretecek kadar uzun değil. */
  | 'GEOMETRY_TOO_SHORT';

export type PaintedArrowVerdict =
  | { readonly visible: false; readonly reason: PaintedArrowHiddenReason }
  | {
      readonly visible: true;
      readonly reason: 'SHOWN';
      /** Kapalı halka; ilk nokta = son nokta (GeoJSON Polygon dış halkası). */
      readonly ring: readonly (readonly [number, number])[];
      /** Dönüş yönü — boyama rengi/asimetrisi için, KARAR için değil. */
      readonly turn: 'left' | 'right' | 'straight';
    };

export interface PaintedArrowInput {
  readonly navActive: boolean;
  /** Tam rota geometrisi — [lon, lat]. */
  readonly routeGeometry: readonly (readonly [number, number])[] | null;
  /** Manevra noktasının geometri indeksi; -1 = çözülemedi. */
  readonly maneuverGeometryIndex: number;
  /** Manevraya yol-boyu mesafe (m); null = ölçülemedi. */
  readonly distanceToManeuverM: number | null;
  readonly maneuverType: string;
  readonly maneuverModifier: string;
}

/* ── Politika sabitleri ─────────────────────────────────────────────────────
   Değerler tek yerdedir ve kilitlidir; sahada ayar gerekirse burada değişir. */

/** Politika sürümü — herhangi bir eşik değişince yükselir, LAB'da görünür. */
export const PAINTED_ARROW_POLICY_VERSION = 'PA-2026.08.08' as const;

/** Bu mesafenin ötesinde ok çizilmez — erken çizim yanlış kavşağı işaretler. */
export const ARROW_SHOW_MAX_M = 140;
/** Bu mesafenin altında ok çizilmez — dönüşe girildi, ok geride kalır. */
export const ARROW_HIDE_MIN_M = 15;
/** Gövde manevra noktasından geriye bu kadar uzanır. */
export const ARROW_APPROACH_M = 32;
/** Ok ucu manevra noktasından ileriye bu kadar uzanır. */
export const ARROW_EXIT_M = 22;
/** Gövde genişliği (şerit hissi). */
export const ARROW_BODY_W_M = 5.0;
/** Ok başı taban genişliği. */
export const ARROW_HEAD_W_M = 10.0;
/** Ok başı uzunluğu — çıkış kolunun İÇİNDEN alınır, dışına taşmaz. */
export const ARROW_HEAD_LEN_M = 11.0;

const M_PER_DEG_LAT = 111_320;
const DEG = Math.PI / 180;

function mPerDegLon(lat: number): number {
  // cos(85°) ≈ 0.087 — kutup yakınında sıfıra bölmeyi engelle.
  return Math.max(M_PER_DEG_LAT * Math.cos(lat * DEG), 1e3);
}

/** Yerel düzlemde iki nokta arası mesafe (m). */
function segMeters(
  a: readonly [number, number], b: readonly [number, number], latRef: number,
): number {
  const dx = (b[0] - a[0]) * mPerDegLon(latRef);
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/**
 * Geometri üzerinde `fromIdx`'ten verilen yönde `meters` kadar yürür.
 * Yol üzerinde kalır (kuş uçuşu DEĞİL) ve gezilen ara noktaları döndürür.
 * Geometri biterse ne kadar yürüdüyse onu döndürür — `walked` bunu bildirir.
 */
function walk(
  geom: readonly (readonly [number, number])[],
  fromIdx: number,
  meters: number,
  dir: 1 | -1,
  latRef: number,
): { points: Array<readonly [number, number]>; walked: number } {
  const points: Array<readonly [number, number]> = [];
  let remaining = meters;
  let i = fromIdx;
  let walked = 0;

  while (remaining > 0) {
    const next = i + dir;
    if (next < 0 || next >= geom.length) break;
    const a = geom[i]!, b = geom[next]!;
    const d = segMeters(a, b, latRef);
    if (d <= 1e-9) { i = next; continue; }

    if (d >= remaining) {
      const t = remaining / d;
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      walked += remaining;
      remaining = 0;
      break;
    }
    points.push(b);
    walked += d;
    remaining -= d;
    i = next;
  }
  return { points, walked };
}

/** Metre cinsinden ofseti dereceye çevirip noktaya uygular. */
function offset(
  p: readonly [number, number], dxM: number, dyM: number, latRef: number,
): [number, number] {
  return [p[0] + dxM / mPerDegLon(latRef), p[1] + dyM / M_PER_DEG_LAT];
}

/** İki nokta arasındaki birim yön vektörü — METRE uzayında. */
function unitDir(
  a: readonly [number, number], b: readonly [number, number], latRef: number,
): { ux: number; uy: number } | null {
  const dx = (b[0] - a[0]) * mPerDegLon(latRef);
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return { ux: dx / len, uy: dy / len };
}

function classifyTurn(modifier: string): 'left' | 'right' | 'straight' {
  const m = modifier.toLowerCase();
  if (m.includes('left')) return 'left';
  if (m.includes('right')) return 'right';
  return 'straight';
}

/**
 * Yola boyanacak ok poligonunu üretir — ya da NEDEN üretilmediğini söyler.
 *
 * Poligon TEK parçadır: sol kenar boyunca ileri → ok başı (sol omuz · uç ·
 * sağ omuz) → sağ kenar boyunca geri. Ok başı çıkış kolunun İÇİNDEN alınır,
 * yani ok toplamda `ARROW_EXIT_M`'yi aşmaz ve kavşağın ötesine taşmaz.
 */
export function buildPaintedArrow(input: PaintedArrowInput): PaintedArrowVerdict {
  if (!input.navActive) return { visible: false, reason: 'NAV_INACTIVE' };

  const geom = input.routeGeometry;
  if (!geom || geom.length < 2) return { visible: false, reason: 'NO_GEOMETRY' };

  const type = input.maneuverType.toLowerCase();
  if (type === 'arrive' || type === 'depart') {
    return { visible: false, reason: 'NOT_A_TURN' };
  }
  const turn = classifyTurn(input.maneuverModifier);
  if (turn === 'straight') return { visible: false, reason: 'NOT_A_TURN' };

  const idx = input.maneuverGeometryIndex;
  if (!Number.isInteger(idx) || idx < 0 || idx >= geom.length) {
    return { visible: false, reason: 'ANCHOR_UNRESOLVED' };
  }

  const dist = input.distanceToManeuverM;
  if (dist === null || !Number.isFinite(dist)) {
    return { visible: false, reason: 'DISTANCE_UNKNOWN' };
  }
  if (dist > ARROW_SHOW_MAX_M) return { visible: false, reason: 'TOO_FAR' };
  if (dist < ARROW_HIDE_MIN_M) return { visible: false, reason: 'TOO_CLOSE' };

  const anchor = geom[idx]!;
  const latRef = anchor[1];

  // Yaklaşım kolu (geriye) ve çıkış kolu (ileriye) — ikisi de YOL ÜZERİNDE.
  const back = walk(geom, idx, ARROW_APPROACH_M, -1, latRef);
  const fwd  = walk(geom, idx, ARROW_EXIT_M, 1, latRef);

  // Her iki kol da anlamlı uzunlukta olmalı; yoksa ok bir yöne işaret etmez.
  if (back.walked < ARROW_APPROACH_M * 0.45 || fwd.walked < ARROW_HEAD_LEN_M) {
    return { visible: false, reason: 'GEOMETRY_TOO_SHORT' };
  }

  /* Merkez çizgi: geriden anchor'a, oradan çıkış koluna — ancak ok BAŞININ
     boyu kadar KISA bırakılır; baş o boşluğa oturur ve toplam uzunluk sabit
     kalır. Çıkış kolu kısaysa baş kolun tamamını kaplar (aşağıdaki oran). */
  const headLen = Math.min(ARROW_HEAD_LEN_M, fwd.walked * 0.85);
  const bodyFwd = walk(geom, idx, Math.max(fwd.walked - headLen, 0), 1, latRef);

  const centerline: Array<readonly [number, number]> = [
    ...back.points.slice().reverse(),
    anchor,
    ...bodyFwd.points,
  ];
  if (centerline.length < 2) return { visible: false, reason: 'GEOMETRY_TOO_SHORT' };

  // Ok ucu: çıkış kolunun gerçek sonu (yol üzerinde).
  const tip = fwd.points[fwd.points.length - 1]!;

  /* Gövdeyi şeride çevir: her nokta için komşularından yön türet, dik yönde
     yarım genişlik kadar ötele. Sol ve sağ kenarlar ayrı toplanır. */
  const left: Array<readonly [number, number]> = [];
  const right: Array<readonly [number, number]> = [];
  const halfW = ARROW_BODY_W_M / 2;

  for (let i = 0; i < centerline.length; i++) {
    const prev = centerline[Math.max(i - 1, 0)]!;
    const next = centerline[Math.min(i + 1, centerline.length - 1)]!;
    const u = unitDir(prev, next, latRef);
    if (!u) continue;
    // Dik vektör: (-uy, ux)
    left.push(offset(centerline[i]!, -u.uy * halfW, u.ux * halfW, latRef));
    right.push(offset(centerline[i]!, u.uy * halfW, -u.ux * halfW, latRef));
  }
  if (left.length < 2 || right.length < 2) {
    return { visible: false, reason: 'GEOMETRY_TOO_SHORT' };
  }

  // Ok başı omuzları: gövdenin bittiği noktada, uca bakan yönün dikinde.
  const bodyEnd = centerline[centerline.length - 1]!;
  const headDir = unitDir(bodyEnd, tip, latRef)
    ?? unitDir(centerline[centerline.length - 2]!, bodyEnd, latRef);
  if (!headDir) return { visible: false, reason: 'GEOMETRY_TOO_SHORT' };

  const halfHead = ARROW_HEAD_W_M / 2;
  const shoulderL = offset(bodyEnd, -headDir.uy * halfHead, headDir.ux * halfHead, latRef);
  const shoulderR = offset(bodyEnd, headDir.uy * halfHead, -headDir.ux * halfHead, latRef);

  const ring: Array<readonly [number, number]> = [
    ...left,
    shoulderL,
    tip,
    shoulderR,
    ...right.slice().reverse(),
  ];
  // GeoJSON dış halkası kapalı olmalı.
  ring.push(ring[0]!);

  return { visible: true, reason: 'SHOWN', ring, turn };
}
