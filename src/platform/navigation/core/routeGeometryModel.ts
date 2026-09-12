/**
 * routeGeometryModel — ROTA GEOMETRİSİNİN ÖLÇÜLEN KÜNYESİ (SAF · P0-NAV-11).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · ağ YOK.
 * Modül düzeyinde yalnız bounded bir KANIT halkası tutar (koordinat TAŞIMAZ).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-11 ölçümü · 2026-08-24, koddan) ─────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `routeValidationModel` GÜÇLÜDÜR ve NAV-11 listesinin çoğunu zaten kapsar:
 * boş/tek noktalı geometri, geçersiz koordinat, dev nokta aralığı, başlangıcın
 * araca uzaklığı, sonun hedefe uzaklığı, mesafe/süre tutarlılığı, bayat istek.
 * Bu modül onun YERİNE GEÇMEZ — kapsamadığı ÜÇ boşluğu kapatır:
 *
 *  1. **YİNELENEN NOKTALAR ÖLÇÜLMÜYORDU.** 640 noktalı bir geometrinin 600'ü
 *     aynı olsa bile hiçbir denetim bunu görmez: `maxGap` küçüktür, koordinatlar
 *     geçerlidir, uçlar doğrudur. Oysa bu geometri ilerleme/eşleştirme
 *     matematiğini bozar (sıfır uzunluklu segmentler).
 *  2. **KAPSAM (bbox) VE POLİLİNE UZUNLUĞU ÖLÇÜLMÜYORDU.** Sağlayıcının
 *     BİLDİRDİĞİ `distanceM` ile geometrinin GERÇEK uzunluğu karşılaştırılmıyordu;
 *     ikisi ayrışıyorsa ya geometri kırpılmıştır ya mesafe yanlıştır.
 *  3. **REDDEDİLEN GEOMETRİ KANITTAN SİLİNİYORDU.** `recordInvalidRejected`
 *     yalnız bir SAYAÇ artırır; adayın kaç noktası vardı, uçları nerede
 *     kaçırdı — hepsi `console.warn`da kalıp kayboluyordu. NAV-11'in kuralı
 *     açıktır: *"INVALID geometri haritada gerçek rota gibi gösterilmesin —
 *     ama sağlayıcı yanıtı kanıttan SİLİNMESİN."*
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · KARAR ÜRETMEZ: rota seçmez, reddetmez, yeniden istek tetiklemez.
 *    Reddetme yetkisi TEK yerdedir: `routeValidationModel.validateRoute`.
 *  · Ölçülemeyen alan `null` — sahte 0 uzunluk / sahte bbox YASAK.
 *  · **KOORDİNAT TAŞIMAZ:** kanıt halkasına yalnız SAYILAR ve SINIFLAR girer
 *    (bbox yalnız DERECE GENİŞLİĞİ olarak taşınır, köşe noktaları DEĞİL) —
 *    rota geometrisi sürücünün gittiği yeri açık eder, PII'dır.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) ÖLÇÜM
   ══════════════════════════════════════════════════════════════════════════ */

/** Aynı sayılacak iki nokta arası en büyük mesafe (m) — sağlayıcı yuvarlaması. */
export const DUPLICATE_POINT_M = 0.5;

/**
 * Yinelenen nokta oranı bu eşiği aşarsa geometri BOZUK sayılır.
 * Sağlayıcılar kavşaklarda birkaç eş nokta üretebilir (normal); yarıdan
 * fazlası eş ise geometri artık bir yol çizgisi değildir.
 */
export const DUPLICATE_RATIO_WARN = 0.15;
export const DUPLICATE_RATIO_FAIL = 0.50;

/**
 * Sağlayıcının BİLDİRDİĞİ mesafe ile geometrinin ÖLÇÜLEN uzunluğu arasındaki
 * kabul edilebilir sapma oranı.
 *
 * NEDEN GENİŞ: `overview=full` bile geometriyi bir miktar basitleştirir ve
 * haversine düzlem yaklaşımı kısa segmentlerde sapar. %15 gürültü payıdır;
 * %40 ise "geometri kırpılmış ya da mesafe başka rotaya ait" demektir.
 */
export const LENGTH_MISMATCH_WARN = 0.15;
export const LENGTH_MISMATCH_FAIL = 0.40;

function _hav(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Geometrinin ölçülen künyesi. **KOORDİNAT İÇERMEZ** — yalnız sayılar.
 */
export interface GeometryMetrics {
  readonly pointCount: number;
  /** Ardışık yinelenenler ELENDİKTEN sonra kalan nokta sayısı. */
  readonly uniquePointCount: number;
  /** Ardışık yinelenen (≤ `DUPLICATE_POINT_M`) nokta sayısı. */
  readonly duplicateCount: number;
  /** Geçersiz (NaN · aralık dışı) nokta sayısı. */
  readonly invalidPointCount: number;
  /** Ardışık iki nokta arası EN BÜYÜK atlama (m). Ölçülemezse `null`. */
  readonly maxGapM: number | null;
  /** Polilinenin ÖLÇÜLEN toplam uzunluğu (m). Ölçülemezse `null`. */
  readonly polylineLengthM: number | null;
  /**
   * Kapsayan kutunun GENİŞLİĞİ (derece) — köşe KOORDİNATLARI DEĞİL.
   * Gizlilik: konum açık etmeden "rota ne kadar alana yayılıyor" sorusu.
   */
  readonly bboxWidthDeg: number | null;
  readonly bboxHeightDeg: number | null;
}

const EMPTY_METRICS: GeometryMetrics = Object.freeze({
  pointCount: 0, uniquePointCount: 0, duplicateCount: 0, invalidPointCount: 0,
  maxGapM: null, polylineLengthM: null, bboxWidthDeg: null, bboxHeightDeg: null,
});

/**
 * Geometriyi ÖLÇER. **SAF · THROW ETMEZ.** Geometri `[lon, lat]` sırasındadır
 * (OSRM/GeoJSON standardı — `routingService` ile aynı sözleşme).
 */
export function measureGeometry(
  geometry: readonly (readonly [number, number])[] | null | undefined,
): GeometryMetrics {
  if (!Array.isArray(geometry) || geometry.length === 0) return EMPTY_METRICS;

  let invalid = 0;
  let duplicates = 0;
  let maxGap: number | null = null;
  let length = 0;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  let prev: readonly [number, number] | null = null;
  let unique = 0;

  for (const pt of geometry) {
    if (!Array.isArray(pt) || pt.length < 2) { invalid++; continue; }
    const lon = pt[0], lat = pt[1];
    if (typeof lon !== 'number' || typeof lat !== 'number'
        || !Number.isFinite(lon) || !Number.isFinite(lat)
        || Math.abs(lat) > 90 || Math.abs(lon) > 180) { invalid++; continue; }

    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;

    if (prev !== null) {
      const d = _hav(prev[1], prev[0], lat, lon);
      /* Yinelenen nokta uzunluğa KATILMAZ ve benzersiz sayılmaz — ama
         ELENMEZ: geometri olduğu gibi korunur, biz yalnız ÖLÇERİZ. */
      if (d <= DUPLICATE_POINT_M) {
        duplicates++;
      } else {
        length += d;
        unique++;
        if (maxGap === null || d > maxGap) maxGap = d;
      }
    } else {
      unique++;   // ilk geçerli nokta
    }
    prev = [lon, lat];
  }

  const measured = prev !== null;
  return {
    pointCount: geometry.length,
    uniquePointCount: unique,
    duplicateCount: duplicates,
    invalidPointCount: invalid,
    maxGapM: maxGap === null ? (measured ? 0 : null) : Math.round(maxGap),
    polylineLengthM: measured ? Math.round(length) : null,
    bboxWidthDeg: measured ? Math.round((maxLon - minLon) * 1e5) / 1e5 : null,
    bboxHeightDeg: measured ? Math.round((maxLat - minLat) * 1e5) / 1e5 : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

/** P0-NAV-11'in istediği dört sınıf. `routeValidationModel.RouteVerdict` ile hizalı. */
export type GeometryIntegrity = 'VALID' | 'DEGRADED' | 'INVALID' | 'UNKNOWN';

export const GEOMETRY_INTEGRITY_LABEL: Readonly<Record<GeometryIntegrity, string>> = {
  VALID:    'geometri sağlam',
  DEGRADED: 'geometri kullanılabilir ama kusurlu',
  INVALID:  'geometri BOZUK — gerçek rota gibi gösterilemez',
  UNKNOWN:  'geometri ölçülemedi — hüküm iddia edilmiyor',
} as const;

export type GeometryFlaw =
  | 'EMPTY'
  | 'SINGLE_POINT'
  | 'INVALID_POINTS'
  | 'DUPLICATE_HEAVY'
  | 'HUGE_GAP'
  | 'LENGTH_MISMATCH'
  | 'ZERO_LENGTH';

export const GEOMETRY_FLAW_LABEL: Readonly<Record<GeometryFlaw, string>> = {
  EMPTY:           'geometri boş',
  SINGLE_POINT:    'tek nokta — çizgi değil',
  INVALID_POINTS:  'geçersiz koordinat içeriyor',
  DUPLICATE_HEAVY: 'noktaların çoğu yinelenen — ilerleme matematiği bozulur',
  HUGE_GAP:        'ardışık noktalar arasında dev atlama',
  LENGTH_MISMATCH: 'ölçülen uzunluk, bildirilen mesafeyle uyuşmuyor',
  ZERO_LENGTH:     'ölçülen uzunluk sıfır',
} as const;

/** Ardışık noktalar arası bu mesafeyi aşan atlama şüphelidir (m). */
export const GEOMETRY_MAX_GAP_M = 5_000;

export interface GeometryVerdict {
  readonly integrity: GeometryIntegrity;
  readonly metrics: GeometryMetrics;
  readonly flaws: readonly GeometryFlaw[];
  /** Yinelenen nokta oranı (0–1). Ölçülemezse `null`. */
  readonly duplicateRatio: number | null;
  /**
   * `|ölçülen − bildirilen| / bildirilen`. Bildirilen mesafe yoksa `null` —
   * "uyuşmuyor" İDDİA EDİLEMEZ.
   */
  readonly lengthMismatchRatio: number | null;
  readonly why: string;
}

/**
 * Geometri bütünlüğü hükmü. **SAF.**
 *
 * ⚠️ Bu hüküm rotayı REDDETMEZ — reddetme yetkisi `validateRoute`tedir.
 * Burada üretilen sınıf, "haritada gerçek rota gibi gösterilebilir mi"
 * sorusunun GÖZLEM cevabıdır ve kanıt katmanına yazılır.
 *
 * @param claimedDistanceM Sağlayıcının bildirdiği mesafe; yoksa `null`.
 */
export function judgeGeometry(
  geometry: readonly (readonly [number, number])[] | null | undefined,
  claimedDistanceM: number | null,
): GeometryVerdict {
  const m = measureGeometry(geometry);
  const flaws: GeometryFlaw[] = [];

  if (m.pointCount === 0) {
    return {
      integrity: 'INVALID', metrics: m, flaws: ['EMPTY'],
      duplicateRatio: null, lengthMismatchRatio: null,
      why: GEOMETRY_FLAW_LABEL.EMPTY,
    };
  }
  if (m.pointCount === 1) {
    return {
      integrity: 'INVALID', metrics: m, flaws: ['SINGLE_POINT'],
      duplicateRatio: 0, lengthMismatchRatio: null,
      why: GEOMETRY_FLAW_LABEL.SINGLE_POINT,
    };
  }

  const duplicateRatio = m.pointCount > 0
    ? Math.round((m.duplicateCount / m.pointCount) * 1000) / 1000 : null;

  const lengthMismatchRatio =
    claimedDistanceM !== null && Number.isFinite(claimedDistanceM) && claimedDistanceM > 0
      && m.polylineLengthM !== null
      ? Math.round((Math.abs(m.polylineLengthM - claimedDistanceM) / claimedDistanceM) * 1000) / 1000
      : null;

  /* ── KESİN BOZULMA (INVALID) ────────────────────────────────────────────── */
  if (m.invalidPointCount > 0) flaws.push('INVALID_POINTS');
  if (m.polylineLengthM === 0) flaws.push('ZERO_LENGTH');
  if (duplicateRatio !== null && duplicateRatio >= DUPLICATE_RATIO_FAIL) flaws.push('DUPLICATE_HEAVY');
  if (lengthMismatchRatio !== null && lengthMismatchRatio >= LENGTH_MISMATCH_FAIL) {
    flaws.push('LENGTH_MISMATCH');
  }
  const invalid = flaws.length > 0;

  /* ── KUSURLU AMA KULLANILABİLİR (DEGRADED) ──────────────────────────────── */
  const warnFlaws: GeometryFlaw[] = [];
  if (!invalid) {
    if (m.maxGapM !== null && m.maxGapM > GEOMETRY_MAX_GAP_M) warnFlaws.push('HUGE_GAP');
    if (duplicateRatio !== null && duplicateRatio >= DUPLICATE_RATIO_WARN) warnFlaws.push('DUPLICATE_HEAVY');
    if (lengthMismatchRatio !== null && lengthMismatchRatio >= LENGTH_MISMATCH_WARN) {
      warnFlaws.push('LENGTH_MISMATCH');
    }
  }

  const all = invalid ? flaws : warnFlaws;
  const integrity: GeometryIntegrity =
    invalid ? 'INVALID' : warnFlaws.length > 0 ? 'DEGRADED' : 'VALID';

  return {
    integrity, metrics: m, flaws: all, duplicateRatio, lengthMismatchRatio,
    why: all.length === 0
      ? `${m.pointCount} nokta · ${m.polylineLengthM ?? '—'} m · en büyük atlama ${m.maxGapM ?? '—'} m`
      : all.map((f) => GEOMETRY_FLAW_LABEL[f]).join(' · '),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) REDDEDİLEN ADAYIN KANITI — SİLİNMEZ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Reddedilen bir rota adayının KALICI izi.
 *
 * NAV-11 kuralı: *"INVALID geometry haritada gerçek rota gibi gösterilmesin.
 * Ama provider response'u kanıttan silinmesin."* Eskiden reddedilen aday yalnız
 * bir SAYAÇ artırıyordu; kaç noktası vardı, uçları nerede kaçırdı — hepsi
 * `console.warn`da kalıp kayboluyordu.
 *
 * **KOORDİNAT TAŞIMAZ** — yalnız ölçüm ve sınıflar.
 */
export interface RejectedGeometryEvidence {
  readonly requestId: number;
  /** Adayı üreten sağlayıcı etiketi (ana makine adı). */
  readonly providerLabel: string | null;
  /** Aday listesindeki indeks (0 = sağlayıcının ilk rotası). */
  readonly candidateIndex: number;
  readonly integrity: GeometryIntegrity;
  readonly metrics: GeometryMetrics;
  readonly flaws: readonly GeometryFlaw[];
  /** `validateRoute`in FAIL veren denetim kimlikleri. */
  readonly failedCheckIds: readonly string[];
  readonly atMs: number;
}

export const REJECTED_GEOMETRY_RING = 12;

let _rejected: RejectedGeometryEvidence[] = [];
let _rejectedTotal = 0;

/** Reddedilen aday kanıtını yazar. **THROW ETMEZ.** */
export function recordRejectedGeometry(e: RejectedGeometryEvidence): void {
  try {
    _rejected.push(e);
    if (_rejected.length > REJECTED_GEOMETRY_RING) {
      _rejected = _rejected.slice(_rejected.length - REJECTED_GEOMETRY_RING);
    }
    _rejectedTotal += 1;
  } catch { /* fail-soft: kanıt kaydı rota akışını bozamaz */ }
}

export interface RejectedGeometrySnapshot {
  readonly recent: readonly RejectedGeometryEvidence[];
  /** Halka taşsa bile korunur. */
  readonly total: number;
}

export function getRejectedGeometryEvidence(): RejectedGeometrySnapshot {
  return { recent: _rejected.slice(), total: _rejectedTotal };
}

export function _resetRejectedGeometryForTest(): void {
  _rejected = [];
  _rejectedTotal = 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) UYGULANAN GEOMETRİNİN KÜNYESİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Haritaya GERÇEKTEN yazılan geometrinin künyesi (P0-NAV-11).
 *
 * NEDEN AYRI: `useRouteStore.geometry` canlı veridir ve LAB onu OKUYAMAZ
 * (koordinat = PII). Bu kayıt aynı geometrinin PII TAŞIMAYAN ölçümüdür ve
 * "haritadaki çizgi ile sağlayıcının verdiği rota aynı mı" sorusunu
 * yanıtlanabilir kılar.
 */
export interface CommittedGeometryEvidence {
  readonly requestId: number;
  readonly providerLabel: string | null;
  readonly integrity: GeometryIntegrity;
  readonly metrics: GeometryMetrics;
  readonly flaws: readonly GeometryFlaw[];
  /** Geometrinin İLK noktasının araca uzaklığı (m). Ölçülemezse `null`. */
  readonly startDistanceM: number | null;
  /** Geometrinin SON noktasının hedefe uzaklığı (m). Ölçülemezse `null`. */
  readonly endDistanceM: number | null;
  /** Rota revizyonu — hangi sürümün ölçüldüğü. */
  readonly routeRevision: number | null;
  readonly atMs: number;
}

let _committed: CommittedGeometryEvidence | null = null;

/** Uygulanan geometrinin künyesini yazar. **THROW ETMEZ.** */
export function recordCommittedGeometry(e: CommittedGeometryEvidence): void {
  try { _committed = e; } catch { /* fail-soft */ }
}

/** Salt-okunur gözlem. Hiç rota uygulanmadıysa `null` — sahte künye YOK. */
export function getCommittedGeometry(): CommittedGeometryEvidence | null {
  return _committed;
}

export function _resetCommittedGeometryForTest(): void { _committed = null; }

/**
 * OTURUM YALITIMI — yeni hedef/oturum başlarken tüm geometri kanıtını düşürür
 * (P0-NAV-18).
 *
 * ── NEDEN GEREKLİ (ölçüm 2026-08-24) ──────────────────────────────────────
 * `_committed` ve reddedilen aday halkası oturumlar arasında YAŞIYORDU: yeni
 * bir hedef seçildikten SONRA ama yeni rota gelmeden ÖNCE, LAB **önceki
 * yolculuğun geometrisini "uygulanan geometri" diye gösteriyordu.** Bu, tam
 * olarak P0-NAV-18'in kapattığı sınıftır: eski oturumun verisi yeni oturumda
 * GÜNCELMİŞ gibi okunamaz.
 *
 * Sayaç DEĞİL, KANIT sıfırlanır: "bu oturumda henüz rota yok" demek, "önceki
 * rotayı göstermek"ten her zaman daha dürüsttür.
 */
export function resetRouteGeometryEvidence(): void {
  _committed = null;
  _rejected = [];
  _rejectedTotal = 0;
}

/**
 * İki noktanın arasındaki mesafe (m) — çağıranın uçları ölçebilmesi için
 * dışa açılır. İkinci bir haversine kopyası YAZILMASIN diye buradadır.
 */
export function geometryDistanceM(
  aLat: number, aLon: number, bLat: number, bLon: number,
): number | null {
  if (!Number.isFinite(aLat) || !Number.isFinite(aLon)
      || !Number.isFinite(bLat) || !Number.isFinite(bLon)) return null;
  return Math.round(_hav(aLat, aLon, bLat, bLon));
}
