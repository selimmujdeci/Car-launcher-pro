/**
 * offRouteModel.ts — Rotadan sapmanın SAF durum makinesi.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Makine değişmezdir (immutable): `stepOffRoute` YENİ durum döndürür.
 *
 * ── ÇÖZDÜĞÜ İKİ KARŞIT ARIZA ────────────────────────────────────────────────
 * (A) TEK kötü GPS fix'i reroute başlatıyordu → rota durup dururken yeniden
 *     çiziliyor, sürücü "şaşırdı" diyor.
 * (B) Gerçekten başka yola girildiğinde karar GEÇ geliyordu → sürücü yanlış
 *     yolda ilerlemeye devam ediyor.
 * İkisi aynı sayıyla çözülemez: **kanıt penceresi uyarlanabilir olmalıdır.**
 * 110 km/h'de 3 örnek ≈ 90 m yol demektir (sapma zaten kesindir); 10 km/h'de
 * aynı 3 örnek ≈ 8 m'dir (GPS gürültüsünden ayırt edilemez). Bu yüzden
 * gereken kanıt SAYISI ve SÜRESİ hızdan ve doğruluktan türetilir — sabit
 * keyfî bir gecikme KULLANILMAZ.
 *
 * ── KANIT ÇOKLUĞU ───────────────────────────────────────────────────────────
 * Karar tek boyuta (dik mesafe) bakmaz. Kullanılan kanıtlar:
 *   · map-match durumu (aktif rotada mı)          · yol-boyu uzaklık
 *   · yön uyumu (rotayla aynı yöne mi gidiyor)    · ilerleme yönü (ileri/geri)
 *   · ardışık doğrulanmış örnek sayısı            · GPS doğruluğu · hız
 */

import type { MapMatchState } from './mapMatchModel';

export type OffRouteState =
  | 'ON_ROUTE'
  | 'SUSPECTED_OFF_ROUTE'
  | 'CONFIRMED_OFF_ROUTE'
  | 'REROUTING'
  | 'REJOINED'
  | 'UNKNOWN';

export type OffRouteReason =
  | 'ON_CORRIDOR' | 'OUTSIDE_CORRIDOR' | 'HEADING_MISMATCH' | 'MOVING_BACKWARD'
  | 'EVIDENCE_PENDING' | 'EVIDENCE_MET' | 'GPS_UNKNOWN' | 'GPS_STALE'
  | 'MATCH_UNCERTAIN' | 'REJOIN_CONFIRMED' | 'HELD_NO_DECISION'
  /** Doğruluk, üzerine AKSİYON alınabilecek eşiğin dışında — karar askıya alındı. */
  | 'ACCURACY_INSUFFICIENT';

/**
 * Üzerine rota kurulabilecek asgari GPS doğruluğu (m) — kütük #402.
 *
 * SAHADA ÖLÇÜLEN ÇELİŞKİ: `CONFIRMED_OFF_ROUTE` 70/399 örnekte (%17,5) üretildi,
 * buna karşılık `isRerouting` **%0,0** ve `req.committed` 1'de kaldı. Sebep: bu
 * makine kötü doğruluklu fix'i sapma KANITI sayıyordu (yalnız gereken örnek
 * sayısını 1 artırarak), `routingService` ise aynı fix'le rota kurmayı
 * `accuracyM > 50` kapısıyla — HAKLI OLARAK — reddediyordu.
 *
 * Sonuç, vizyon anayasasının 8. kapısının kopması: sistem, üzerine HAREKET
 * EDEMEYECEĞİ bir karar üretiyor, kütüğe yazıyor ve susuyordu. İki katman artık
 * AYNI eşiği paylaşır: aksiyona dönüşemeyecek kanıt, karara da dönüşmez.
 */
export const ACTIONABLE_ACCURACY_M = 50;

export interface OffRouteEvidence {
  readonly matchState: MapMatchState;
  /** Aktif rotaya dik mesafe (m); bilinmiyorsa null. */
  readonly lateralM: number | null;
  /** Araç yönü ile segment yönü farkı (0..180); bilinmiyorsa null. */
  readonly headingDeltaDeg: number | null;
  /** Bir önceki örneğe göre yol-boyu ilerleme (m). + = ileri. Bilinmiyorsa null. */
  readonly progressM: number | null;
  readonly accuracyM: number | null;
  readonly speedKmh: number | null;
  /** Monotonik zaman damgası. */
  readonly tsMs: number;
}

export interface OffRouteMachine {
  readonly state: OffRouteState;
  /** Ardışık "sapma" kanıtı sayısı. */
  readonly evidenceCount: number;
  /** Bu örnekte gereken kanıt sayısı (uyarlanabilir) — LAB'da gösterilir. */
  readonly requiredEvidence: number;
  /** Kanıtın sürmesi gereken asgari süre (ms) — uyarlanabilir. */
  readonly requiredEvidenceMs: number;
  /** İlk şüphe anı (monotonik ms); yoksa null. */
  readonly firstSuspectedAtMs: number | null;
  /** Sapmanın DOĞRULANDIĞI an — reroute gecikme ölçümünün T0'ı. */
  readonly confirmedAtMs: number | null;
  /** Rotaya geri dönüş kanıtı sayacı. */
  readonly rejoinCount: number;
  readonly reasons: readonly OffRouteReason[];
}

/* ── Uyarlanabilir kanıt penceresi ────────────────────────────────────────── */

/** Sapma bu katsayıyla çarpılan koridoru aşarsa kanıt bir örnek kısalır. */
export const GROSS_DEVIATION_FACTOR = 3;
/** Rotaya geri dönüş için gereken ardışık örnek. */
export const REJOIN_EVIDENCE = 2;
export const MIN_EVIDENCE = 2;
export const MAX_EVIDENCE = 5;

/**
 * Bu örnek için gereken ardışık kanıt sayısı.
 *
 * Hız yüksekse sapma kısa sürede metrelerce büyür — az örnek yeter ve GEÇ
 * kalmak tehlikelidir. Hız düşükse aynı sapma GPS gürültüsüyle karışır —
 * daha çok örnek gerekir. Doğruluk kötüyse bir örnek eklenir.
 */
export function requiredEvidenceFor(speedKmh: number | null, accuracyM: number | null, grossDeviation: boolean): number {
  const v = (speedKmh != null && Number.isFinite(speedKmh)) ? speedKmh : 0;
  let n = 3;
  if (v > 70) n = 2;
  else if (v < 15) n = 4;
  if (accuracyM == null || accuracyM > 25) n += 1;
  if (grossDeviation) n -= 1;
  return Math.max(MIN_EVIDENCE, Math.min(MAX_EVIDENCE, n));
}

/** Kaba sapmada kanıt süresi tabanı — gürültü ayrımı zaten kesindir. */
export const GROSS_EVIDENCE_MS = 1_200;

/**
 * Kanıtın sürmesi gereken asgari süre (ms).
 *
 * Yüksek frekanslı bir konum kaynağı 200 ms içinde 5 örnek üretebilir; SAYI
 * tek başına "sürüyor" demek DEĞİLDİR. Süre tabanı hızla ölçeklenir.
 *
 * KABA SAPMA İSTİSNASI: sapma koridorun `GROSS_DEVIATION_FACTOR` katını
 * aşıyorsa bu GPS gürültüsü OLAMAZ (doğruluk > 50 m zaten reddediliyor,
 * koridor payı 40 m ile tavanlı). Böyle bir sapmada uzun beklemek, sürücüyü
 * bilerek yanlış yolda tutmaktır — süre tabanı kısalır.
 */
export function requiredEvidenceMsFor(speedKmh: number | null, grossDeviation = false): number {
  const v = (speedKmh != null && Number.isFinite(speedKmh)) ? speedKmh : 0;
  const base = v > 70 ? 800 : v < 15 ? 2_500 : 1_500;
  return grossDeviation ? Math.min(base, GROSS_EVIDENCE_MS) : base;
}

export function initialOffRoute(): OffRouteMachine {
  return {
    state: 'UNKNOWN',
    evidenceCount: 0,
    requiredEvidence: 3,
    requiredEvidenceMs: 1_500,
    firstSuspectedAtMs: null,
    confirmedAtMs: null,
    rejoinCount: 0,
    reasons: ['GPS_UNKNOWN'],
  };
}

/**
 * Bir kanıt örneğini işler ve YENİ makine durumunu döndürür.
 *
 * `corridorM` map-match ile AYNI koridor değeridir — iki katman aynı eşiği
 * paylaşır, çelişki üretmezler.
 */
export function stepOffRoute(
  m: OffRouteMachine,
  ev: OffRouteEvidence,
  corridorM: number,
): OffRouteMachine {
  // ── 1) Konum bilinmiyorsa KARAR YOK ───────────────────────────────────────
  // Tünel / sinyal kaybı / bayat fix bir rota sapması DEĞİLDİR. Mevcut durum
  // korunur, kanıt sayacı sıfırlanır (sahte birikim olmasın).
  if (ev.matchState === 'STALE' || ev.matchState === 'UNKNOWN') {
    return {
      ...m,
      evidenceCount: 0,
      firstSuspectedAtMs: null,
      state: m.state === 'SUSPECTED_OFF_ROUTE' ? 'ON_ROUTE' : m.state,
      reasons: [ev.matchState === 'STALE' ? 'GPS_STALE' : 'GPS_UNKNOWN', 'HELD_NO_DECISION'],
    };
  }

  // ── 2) Reroute sürerken sapma yeniden değerlendirilmez ────────────────────
  // Yeni rota commit edilene kadar eski rotaya göre "sapma" saymak anlamsızdır.
  if (m.state === 'REROUTING') {
    if (ev.matchState === 'MATCHED' && (ev.lateralM ?? Infinity) <= corridorM) {
      const rejoin = m.rejoinCount + 1;
      if (rejoin >= REJOIN_EVIDENCE) {
        return { ...m, state: 'REJOINED', rejoinCount: rejoin, evidenceCount: 0,
                 firstSuspectedAtMs: null, reasons: ['REJOIN_CONFIRMED'] };
      }
      return { ...m, rejoinCount: rejoin, reasons: ['ON_CORRIDOR', 'EVIDENCE_PENDING'] };
    }
    return { ...m, rejoinCount: 0, reasons: ['HELD_NO_DECISION'] };
  }

  // ── 2b) AKSİYONA DÖNÜŞEMEYECEK KANIT, KARARA DA DÖNÜŞMEZ (kütük #402) ─────
  // Doğruluğu `ACTIONABLE_ACCURACY_M`'nin dışındaki fix ile rota kurulamaz;
  // o hâlde bu fix ile "rotadan çıktın" da DOĞRULANAMAZ. Mevcut durum korunur,
  // kanıt birikmez — sahte sapma üretmenin de en büyük kaynağı buydu.
  // NOT: doğruluğu BİLİNMEYEN fix de aksiyona uygun değildir (null = kanıt yok).
  if (ev.accuracyM == null || ev.accuracyM > ACTIONABLE_ACCURACY_M) {
    return {
      ...m,
      evidenceCount: 0,
      firstSuspectedAtMs: null,
      // Şüphe aşamasındaysak geri düşürülür; DOĞRULANMIŞ bir sapma ise
      // korunur (zaten iyi fix'lerle doğrulanmıştı, tek kötü fix silmemeli).
      state: m.state === 'SUSPECTED_OFF_ROUTE' ? 'ON_ROUTE' : m.state,
      reasons: ['ACCURACY_INSUFFICIENT', 'HELD_NO_DECISION'],
    };
  }

  const lateral = ev.lateralM ?? Infinity;
  const grossDeviation = lateral > corridorM * GROSS_DEVIATION_FACTOR;
  const required   = requiredEvidenceFor(ev.speedKmh, ev.accuracyM, grossDeviation);
  const requiredMs = requiredEvidenceMsFor(ev.speedKmh, grossDeviation);

  // ── 3) Sapma kanıtı var mı? ───────────────────────────────────────────────
  const outsideCorridor = ev.matchState === 'OFF_NETWORK' || lateral > corridorM;
  const headingWrong    = ev.headingDeltaDeg != null && ev.headingDeltaDeg > 90;
  const movingBackward  = ev.progressM != null && ev.progressM < -corridorM;

  // MATCH_UNCERTAIN tek başına SAPMA KANITI DEĞİLDİR — belirsizlik, sapma
  // olduğunu değil, bilmediğimizi söyler. Yalnız koridor dışıysa sayılır.
  const deviated = outsideCorridor || (headingWrong && lateral > corridorM * 0.5) || movingBackward;

  if (!deviated) {
    // ── Rotadayız ───────────────────────────────────────────────────────────
    if (m.state === 'CONFIRMED_OFF_ROUTE' || m.state === 'REJOINED') {
      const rejoin = m.rejoinCount + 1;
      if (rejoin >= REJOIN_EVIDENCE) {
        return { state: 'ON_ROUTE', evidenceCount: 0, requiredEvidence: required,
                 requiredEvidenceMs: requiredMs, firstSuspectedAtMs: null,
                 confirmedAtMs: null, rejoinCount: 0, reasons: ['REJOIN_CONFIRMED'] };
      }
      return { ...m, state: 'REJOINED', rejoinCount: rejoin, evidenceCount: 0,
               requiredEvidence: required, requiredEvidenceMs: requiredMs,
               reasons: ['ON_CORRIDOR', 'EVIDENCE_PENDING'] };
    }
    return {
      state: 'ON_ROUTE', evidenceCount: 0, requiredEvidence: required,
      requiredEvidenceMs: requiredMs, firstSuspectedAtMs: null,
      confirmedAtMs: null, rejoinCount: 0,
      reasons: [ev.matchState === 'MATCH_UNCERTAIN' ? 'MATCH_UNCERTAIN' : 'ON_CORRIDOR'],
    };
  }

  // ── 4) Sapma kanıtı biriktir ──────────────────────────────────────────────
  const count = m.evidenceCount + 1;
  const firstAt = m.firstSuspectedAtMs ?? ev.tsMs;
  const elapsed = ev.tsMs - firstAt;

  const reasons: OffRouteReason[] = [];
  if (outsideCorridor) reasons.push('OUTSIDE_CORRIDOR');
  if (headingWrong)    reasons.push('HEADING_MISMATCH');
  if (movingBackward)  reasons.push('MOVING_BACKWARD');

  // TEK örnek ASLA doğrulamaz: hem sayı hem süre koşulu sağlanmalı.
  if (count >= required && elapsed >= requiredMs) {
    // Zaten doğrulanmışsa T0 korunur — gecikme ölçümü kaymaz.
    return {
      state: 'CONFIRMED_OFF_ROUTE',
      evidenceCount: count,
      requiredEvidence: required,
      requiredEvidenceMs: requiredMs,
      firstSuspectedAtMs: firstAt,
      confirmedAtMs: m.state === 'CONFIRMED_OFF_ROUTE' ? m.confirmedAtMs : ev.tsMs,
      rejoinCount: 0,
      reasons: [...reasons, 'EVIDENCE_MET'],
    };
  }

  return {
    state: 'SUSPECTED_OFF_ROUTE',
    evidenceCount: count,
    requiredEvidence: required,
    requiredEvidenceMs: requiredMs,
    firstSuspectedAtMs: firstAt,
    confirmedAtMs: null,
    rejoinCount: 0,
    reasons: [...reasons, 'EVIDENCE_PENDING'],
  };
}

/** Reroute isteği başlatıldı — makine yeni rota gelene kadar karar vermez. */
export function markRerouting(m: OffRouteMachine): OffRouteMachine {
  return { ...m, state: 'REROUTING', evidenceCount: 0, rejoinCount: 0,
           reasons: ['HELD_NO_DECISION'] };
}

/** Yeni rota commit edildi — makine temiz başlar. */
export function markRouteCommitted(): OffRouteMachine {
  return {
    state: 'ON_ROUTE', evidenceCount: 0, requiredEvidence: 3,
    requiredEvidenceMs: 1_500, firstSuspectedAtMs: null, confirmedAtMs: null,
    rejoinCount: 0, reasons: ['ON_CORRIDOR'],
  };
}

export const OFF_ROUTE_STATE_LABEL: Readonly<Record<OffRouteState, string>> = {
  ON_ROUTE:            'ROTADA',
  SUSPECTED_OFF_ROUTE: 'SAPMA ŞÜPHESİ',
  CONFIRMED_OFF_ROUTE: 'SAPMA DOĞRULANDI',
  REROUTING:           'YENİDEN HESAPLANIYOR',
  REJOINED:            'ROTAYA DÖNÜLDÜ',
  UNKNOWN:             'BİLİNMİYOR',
} as const;
