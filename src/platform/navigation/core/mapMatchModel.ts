/**
 * mapMatchModel.ts — Aracı ham GPS noktasına DEĞİL, aktif rota üzerindeki en
 * olası segmente oturtan SAF eşleştirme modeli.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Zaman DIŞARIDAN gelir (`nowMs`), böylece test deterministiktir.
 *
 * ── DÜRÜST KAPSAM SINIRI (pazarlıksız) ──────────────────────────────────────
 * Bu bir **rota-göreli** eşleştiricidir, TAM yol-ağı eşleştiricisi DEĞİLDİR.
 * Cihazda yol ağı grafiği YOKTUR (`/maps/routing-graph.bin` paketlenmemiş —
 * bkz. NAVIGATION_REALITY_AUDIT §4.1). Elimizdeki tek gerçek yol geometrisi
 * AKTİF ROTAdır. Dolayısıyla:
 *   • `MATCHED`      = araç aktif rotanın şu segmentinde.
 *   • `OFF_NETWORK`  = araç aktif rota koridorunun DIŞINDA. **Hangi yolda
 *                      olduğunu SÖYLEYEMEYİZ** — o bilgi cihazda yok. Kanıtsız
 *                      "servis yolundasınız" iddiası ÜRETİLMEZ.
 * Paralel yol / ters şerit ayrımı yine yapılır: aynı rota koridorunda ters
 * yönde ilerlemek `headingDelta` ile yakalanır ve eşleşme MATCHED sayılmaz.
 *
 * ── NEDEN "EN YAKIN SEGMENT" YETMEZ ─────────────────────────────────────────
 * Bölünmüş bulvarda karşı şerit 15-25 m ötededir; GPS gürültüsü ±10 m'dir.
 * Yalnız mesafeye bakan bir eşleştirici aracı düzenli olarak karşı şeride
 * atar ve oradan reroute isteyip "saçma rota" üretir. Bu yüzden aday puanı
 * ÜÇ bağımsız kanıttan gelir: dik mesafe · yön uyumu · ilerleme sürekliliği.
 */

import {
  hav, projectOnSegment, pointToSegmentDist, segmentBearingDeg, angularDeltaDeg,
} from './geo';

/* ── Durumlar ─────────────────────────────────────────────────────────────── */

export type MapMatchState =
  /** Aktif rota üzerinde güvenilir eşleşme var. */
  | 'MATCHED'
  /** Kanıt zayıf (düşük doğruluk · belirsiz aday · yön bilinmiyor) — kesin eşleşme ÜRETİLMEZ. */
  | 'MATCH_UNCERTAIN'
  /** Araç aktif rota koridorunun dışında. Hangi yolda olduğu BİLİNMİYOR. */
  | 'OFF_NETWORK'
  /** Fix çok eski — konum kararı verilmez. */
  | 'STALE'
  /** Girdi yok/geçersiz (rota yok, koordinat geçersiz). */
  | 'UNKNOWN';

/** Sınırlı gerekçe kodları — serbest metin ÜRETİLMEZ (LAB'da sayılabilir olmalı). */
export type MapMatchReason =
  | 'NO_GEOMETRY' | 'BAD_INPUT' | 'STALE_FIX' | 'FIRST_FIX'
  | 'LOW_ACCURACY' | 'OFF_CORRIDOR' | 'HEADING_UNKNOWN' | 'HEADING_MISMATCH'
  | 'AMBIGUOUS' | 'JUMP_REJECTED' | 'BACKWARD_REJECTED' | 'RELOCALIZED';

export interface MapMatchSample {
  readonly lat: number;
  readonly lon: number;
  /** GPS bildirilen doğruluk (m). `null` = bilinmiyor → kötümser davranılır. */
  readonly accuracyM: number | null;
  /** Gidiş yönü (derece). `null` = bilinmiyor. Durakta GÜVENİLMEZ. */
  readonly headingDeg: number | null;
  /** km/h. `null` = bilinmiyor. */
  readonly speedKmh: number | null;
  /** Monotonik zaman damgası (performance.now mertebesi). */
  readonly tsMs: number;
}

export interface MapMatchFix {
  readonly state: MapMatchState;
  /** 0..1 — `MATCHED` dışındaki durumlarda ASLA yüksek değildir. */
  readonly confidence: number;
  /** Eşleşen segmentin başlangıç indeksi; eşleşme yoksa -1. */
  readonly segIdx: number;
  readonly snappedLat: number | null;
  readonly snappedLon: number | null;
  /** Eşleşen segmente dik mesafe (m). */
  readonly lateralM: number | null;
  /** Snapped noktadan rotanın SONUNA kalan yol-boyu mesafe (m). */
  readonly alongRemainingM: number | null;
  /** Araç yönü ile segment yönü farkı (0..180); yön bilinmiyorsa null. */
  readonly headingDeltaDeg: number | null;
  /** HAM GPS KAYBOLMAZ — tanı ve görselleştirme için ayrı taşınır. */
  readonly rawLat: number;
  readonly rawLon: number;
  readonly tsMs: number;
  readonly reasons: readonly MapMatchReason[];
}

/* ── Eşikler (hepsi gerekçeli) ────────────────────────────────────────────── */

/** Bu yaştan eski fix ile konum kararı VERİLMEZ. */
export const MATCH_STALE_MS = 5_000;
/** Rota koridoru yarı genişliği (m) — üstüne GPS hata payı eklenir. */
export const CORRIDOR_BASE_M = 55;
/** Hata payı tavanı (m) — accuracy 200 m ise koridor 255 m olmaz. */
export const CORRIDOR_ACC_CAP_M = 40;
/** Bu doğruluğun üstünde kesin eşleşme İDDİA EDİLMEZ. */
export const ACCURACY_UNCERTAIN_M = 35;
/** Altında GPS yönü gürültüdür (routingService.HEADING_TRUST_MIN_KMH ile aynı sözleşme). */
export const MATCH_HEADING_TRUST_MIN_KMH = 5;
/** Bu farkın üstü "ters yön" sayılır — aynı asfaltta karşı şerit. */
export const REVERSE_DELTA_DEG = 120;
/** Yön uyumsuzluğu eşiği — üstünde MATCHED verilmez. */
export const HEADING_MISMATCH_DEG = 80;
/** Rotada geriye kaymaya izin verilen pay (m) — GPS gürültüsü. */
export const BACKWARD_SLACK_M = 20;
/** İzinli sıçrama = hız×dt×çarpan + pay. */
export const JUMP_FACTOR = 3;
export const JUMP_SLACK_M = 60;
/** İki aday bu kadar ayrıksa (yol-boyu) gerçekten FARKLI yerlerdir. */
export const AMBIGUITY_SEPARATION_M = 40;
/** Puan farkı bunun altındaysa aday belirsizdir. */
export const AMBIGUITY_MARGIN = 0.10;
/** Pencere içi en iyi aday bu kadar uzaksa yeniden konumlandır (tam tarama). */
export const RELOCALIZE_M = 120;
/** MATCHED için gereken asgari güven. */
export const MIN_MATCH_CONFIDENCE = 0.45;

const WINDOW_BACK_SEGMENTS = 25;
const WINDOW_MIN_FWD_SEGMENTS = 40;

/** Hiç kanıt yokken dönen sabit — "bilmiyorum" bir CEVAPtır. */
export function unknownMatch(
  rawLat: number, rawLon: number, tsMs: number, reason: MapMatchReason,
): MapMatchFix {
  return {
    state: 'UNKNOWN', confidence: 0, segIdx: -1,
    snappedLat: null, snappedLon: null, lateralM: null,
    alongRemainingM: null, headingDeltaDeg: null,
    rawLat, rawLon, tsMs, reasons: [reason],
  };
}

interface _Candidate {
  segIdx: number;
  lateral: number;
  along: number;
  headingDelta: number | null;
  score: number;
}

function _alongRemaining(
  geometry: readonly [number, number][],
  cum: Float64Array | null,
  segIdx: number,
  pLat: number, pLon: number,
): number {
  const [bLon, bLat] = geometry[segIdx + 1];
  const partial = hav(pLat, pLon, bLat, bLon);
  if (cum && cum.length === geometry.length) return partial + cum[segIdx + 1];
  // Savunma yolu: suffix-sum yoksa O(N) topla (normalde çağrılmaz).
  let sum = 0;
  for (let i = segIdx + 1; i < geometry.length - 1; i++) {
    sum += hav(geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0]);
  }
  return partial + sum;
}

/**
 * Bir GPS örneğini aktif rotaya eşleştirir. SAF — aynı girdi aynı çıktıyı verir.
 *
 * @param prev Önceki eşleşme (süreklilik kanıtı). `null` → ilk fix, tam tarama.
 * @param nowMs Çağıranın monotonik saati; tazelik bunun üzerinden ölçülür.
 */
export function matchToRoute(
  sample: MapMatchSample,
  geometry: readonly [number, number][] | null,
  cumulative: Float64Array | null,
  prev: MapMatchFix | null,
  nowMs: number,
): MapMatchFix {
  const { lat, lon, tsMs } = sample;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return unknownMatch(lat, lon, tsMs, 'BAD_INPUT');
  }
  if (!geometry || geometry.length < 2) {
    return unknownMatch(lat, lon, tsMs, 'NO_GEOMETRY');
  }

  // ── Tazelik: eski fix ile rota kararı verilmez (tünel/sinyal kaybı) ───────
  const age = nowMs - tsMs;
  if (Number.isFinite(age) && age > MATCH_STALE_MS) {
    return {
      state: 'STALE', confidence: 0, segIdx: -1,
      snappedLat: null, snappedLon: null, lateralM: null,
      alongRemainingM: null, headingDeltaDeg: null,
      rawLat: lat, rawLon: lon, tsMs, reasons: ['STALE_FIX'],
    };
  }

  const reasons: MapMatchReason[] = [];
  const accuracy = (sample.accuracyM != null && Number.isFinite(sample.accuracyM) && sample.accuracyM >= 0)
    ? sample.accuracyM
    : null;
  if (accuracy === null || accuracy > ACCURACY_UNCERTAIN_M) reasons.push('LOW_ACCURACY');

  /* ── YÖN GÜVENİ (saha 2026-08-05 · kütük #405/#408) ────────────────────────
   * ÖLÇÜLEN ÇELİŞKİ: `headingDeg` örneklerin **%100'ünde** doluydu, buna rağmen
   * %13,8'inde `HEADING_UNKNOWN` üretiliyordu. Kök: hız `null` iken burada
   * **0 varsayılıyordu** ("araç duruyor") ve düşük hızda GPS yönü gürültü
   * sayıldığı için yön atılıyordu. Oysa `null` "duruyor" DEĞİL "bilmiyorum"dur;
   * sahada araç 94 km/h gidiyordu ve hızın %16'sı null geliyordu (#408).
   *
   * Artık üç durum AYRIŞTIRILIR:
   *   • hız biliniyor ve eşiğin üstünde  → yön GÜVENİLİR
   *   • hız biliniyor ve eşiğin altında  → yön gürültü (HEADING_UNKNOWN) — durgun araç
   *   • hız BİLİNMİYOR                   → yönün kendisi varsa güvenilir sayılır,
   *     çünkü GPS yön alanını yalnız hareket hâlinde üretir; sahte 0 uydurup
   *     eldeki gerçek veriyi atmak, eşleme güvenini düşürüp sahte sapma besliyordu.
   */
  const speedKnown = sample.speedKmh != null && Number.isFinite(sample.speedKmh);
  const speedKmh   = speedKnown ? (sample.speedKmh as number) : 0;
  const headingPresent = sample.headingDeg != null && Number.isFinite(sample.headingDeg);
  const headingTrusted = headingPresent &&
    (!speedKnown || speedKmh >= MATCH_HEADING_TRUST_MIN_KMH);
  if (!headingTrusted) reasons.push('HEADING_UNKNOWN');

  const corridorM = CORRIDOR_BASE_M + Math.min(accuracy ?? CORRIDOR_ACC_CAP_M, CORRIDOR_ACC_CAP_M);

  // ── Arama penceresi ───────────────────────────────────────────────────────
  // Önceki eşleşme varsa dar pencere (O(W)); yoksa/uzaklaştıysa tam tarama.
  const prevUsable = prev !== null && prev.segIdx >= 0 &&
    (prev.state === 'MATCHED' || prev.state === 'MATCH_UNCERTAIN') &&
    prev.segIdx < geometry.length - 1;

  const dtS = prevUsable && Number.isFinite(prev!.tsMs)
    ? Math.max(0, (tsMs - prev!.tsMs) / 1000)
    : 0;
  const plausibleTravelM = (speedKmh / 3.6) * dtS;
  const maxTravelM = plausibleTravelM * JUMP_FACTOR + JUMP_SLACK_M;

  let scanStart = 0;
  let scanEnd   = geometry.length - 2;
  let windowed  = false;
  if (prevUsable) {
    // İleri pencere gerçek ilerleme hızından türetilir — sabit sayı değil.
    const fwd = Math.max(WINDOW_MIN_FWD_SEGMENTS, Math.ceil(maxTravelM / 10));
    scanStart = Math.max(0, prev!.segIdx - WINDOW_BACK_SEGMENTS);
    scanEnd   = Math.min(geometry.length - 2, prev!.segIdx + fwd);
    windowed  = true;
  } else {
    reasons.push('FIRST_FIX');
  }

  let scan = _scan(geometry, cumulative, lat, lon, scanStart, scanEnd,
    headingTrusted ? sample.headingDeg! : null, corridorM, prevUsable ? prev! : null,
    maxTravelM, dtS);

  // Pencere sonucu zayıfsa (araç penceresinin dışına çıkmış) tam tarama yap.
  if (windowed && (scan.candidates.length === 0 || scan.nearestLateral > RELOCALIZE_M)) {
    reasons.push('RELOCALIZED');
    scan = _scan(geometry, cumulative, lat, lon, 0, geometry.length - 2,
      headingTrusted ? sample.headingDeg! : null, corridorM, null, Infinity, dtS);
  }

  /* ── ARAÇ KORİDORDAN ÇOK UZAKSA ───────────────────────────────────────────
   * `_scan` CPU koruması için koridorun 3 katından uzak adayları PUANLAMAZ.
   * Araç gerçekten uzaktaysa (ör. yanlış yola sapmış, 500 m ötede) aday
   * listesi BOŞ döner. Bunu "bilinmiyor" saymak AĞIR bir hata olurdu:
   * `UNKNOWN` sapma makinesinde "karar verme, bekle" demektir — yani en
   * belirgin sapmada reroute HİÇ tetiklenmezdi. Doğru cevap `OFF_NETWORK`. */
  if (scan.candidates.length === 0) {
    if (scan.nearestIdx < 0) return unknownMatch(lat, lon, tsMs, 'NO_GEOMETRY');
    reasons.push('OFF_CORRIDOR');
    return {
      state: 'OFF_NETWORK', confidence: 0, segIdx: -1,
      snappedLat: null, snappedLon: null,
      lateralM: scan.nearestLateral,
      alongRemainingM: null, headingDeltaDeg: null,
      rawLat: lat, rawLon: lon, tsMs, reasons,
    };
  }

  const candidates = scan.candidates;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // ── Belirsizlik: yol-boyu GERÇEKTEN ayrık ikinci bir aday yakın puanlıysa ──
  // (rota kendi üstüne dönüyor / gidiş-dönüş aynı asfalt) → kesin eşleşme YOK.
  let ambiguous = false;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    if (Math.abs(c.along - best.along) < AMBIGUITY_SEPARATION_M) continue;
    if (best.score - c.score < AMBIGUITY_MARGIN) ambiguous = true;
    break;
  }
  if (ambiguous) reasons.push('AMBIGUOUS');

  /* ── ANİ SEGMENT SIÇRAMASI ────────────────────────────────────────────────
   * Süreklilik puanı sıçramayı CEZALANDIRIR ama tek başına ELEMEZ: rota
   * üzerinde, doğru yönde bir nokta yine de yüksek puan alabilir. Fiziksel
   * olarak imkânsız bir ilerleme gördüğümüzde kesin eşleşme İDDİA ETMEYİZ.
   * Konumu UYDURMAYIZ da: en iyi aday taşınır, yalnız güven düşürülür ve
   * gerekçe kodu görünür olur (LAB'da sayılabilir). */
  let implausibleJump = false;
  if (prevUsable && prev!.alongRemainingM != null && dtS > 0) {
    const delta = prev!.alongRemainingM - best.along; // + = ileri
    if (Math.abs(delta) > maxTravelM) {
      implausibleJump = true;
      reasons.push('JUMP_REJECTED');
    } else if (delta < -BACKWARD_SLACK_M) {
      reasons.push('BACKWARD_REJECTED');
    }
  }

  const [aLon, aLat] = geometry[best.segIdx];
  const [bLon, bLat] = geometry[best.segIdx + 1];
  const t    = projectOnSegment(lat, lon, aLat, aLon, bLat, bLon);
  const pLat = aLat + t * (bLat - aLat);
  const pLon = aLon + t * (bLon - aLon);

  // ── Durum kararı — fail-closed sıralama ───────────────────────────────────
  let state: MapMatchState;
  if (best.lateral > corridorM) {
    state = 'OFF_NETWORK';
    reasons.push('OFF_CORRIDOR');
  } else if (best.headingDelta !== null && best.headingDelta > HEADING_MISMATCH_DEG) {
    // Aynı koridorda ama yön tutmuyor (karşı şerit / ters gidiş).
    state = 'MATCH_UNCERTAIN';
    reasons.push('HEADING_MISMATCH');
  } else if (ambiguous || implausibleJump || !headingTrusted || accuracy === null ||
             accuracy > ACCURACY_UNCERTAIN_M || best.score < MIN_MATCH_CONFIDENCE) {
    state = 'MATCH_UNCERTAIN';
  } else {
    state = 'MATCHED';
  }

  // Güven: puanı taşı ama belirsiz durumlarda TAVANLA — "uncertain" yüksek güven veremez.
  let confidence = Math.max(0, Math.min(1, best.score));
  if (state !== 'MATCHED') confidence = Math.min(confidence, 0.40);
  if (state === 'OFF_NETWORK') confidence = 0;

  return {
    state,
    confidence,
    segIdx: state === 'OFF_NETWORK' ? -1 : best.segIdx,
    snappedLat: state === 'OFF_NETWORK' ? null : pLat,
    snappedLon: state === 'OFF_NETWORK' ? null : pLon,
    lateralM: best.lateral,
    alongRemainingM: state === 'OFF_NETWORK' ? null : best.along,
    headingDeltaDeg: best.headingDelta,
    rawLat: lat, rawLon: lon, tsMs,
    reasons,
  };
}

interface _ScanResult {
  /** Puanlanmış adaylar (koridorun 3 katı içindekiler). */
  candidates: _Candidate[];
  /** Aralıktaki EN YAKIN segment — aday olmasa bile bilinir. */
  nearestIdx: number;
  nearestLateral: number;
}

/**
 * Verilen aralıktaki adayları puanlar. Saf yardımcı.
 *
 * Aday listesi CPU koruması için filtrelidir; ama `nearestIdx/nearestLateral`
 * HER ZAMAN doldurulur — böylece "aday yok" ile "yol yok" karıştırılmaz.
 */
function _scan(
  geometry: readonly [number, number][],
  cum: Float64Array | null,
  lat: number, lon: number,
  from: number, to: number,
  headingDeg: number | null,
  corridorM: number,
  prev: MapMatchFix | null,
  maxTravelM: number,
  dtS: number,
): _ScanResult {
  const out: _Candidate[] = [];
  let nearestIdx = -1;
  let nearestLateral = Infinity;
  // Uzun rotada tam tarama pahalıdır: kaba örnekle, sonra en iyi çevresini incele.
  const span = to - from;
  const step = span > 800 ? Math.ceil(span / 400) : 1;

  const consider = (i: number): void => {
    const [aLon, aLat] = geometry[i];
    const [bLon, bLat] = geometry[i + 1];
    const lateral = pointToSegmentDist(lat, lon, aLat, aLon, bLat, bLon);
    if (lateral < nearestLateral) { nearestLateral = lateral; nearestIdx = i; }
    // Koridorun 3 katından uzak adaylar hiç PUANLANMAZ (CPU koruması) — ama
    // en yakın segment yukarıda KAYDEDİLDİ; çağıran bunu OFF_NETWORK olarak
    // dürüstçe raporlar. Sessiz "bilinmiyor"a düşme YOK.
    if (lateral > corridorM * 3) return;

    const t    = projectOnSegment(lat, lon, aLat, aLon, bLat, bLon);
    const pLat = aLat + t * (bLat - aLat);
    const pLon = aLon + t * (bLon - aLon);
    const along = _alongRemaining(geometry, cum, i, pLat, pLon);

    // 1) Dik mesafe kanıtı
    const distScore = Math.max(0, 1 - lateral / corridorM);

    // 2) Yön kanıtı — ters şeridi eleyen TEK sinyal
    let headingDelta: number | null = null;
    let headScore = 0.5; // yön bilinmiyorsa nötr (ne ödül ne ceza)
    if (headingDeg !== null) {
      const segBearing = segmentBearingDeg(aLat, aLon, bLat, bLon);
      headingDelta = angularDeltaDeg(headingDeg, segBearing);
      headScore = headingDelta >= REVERSE_DELTA_DEG
        ? 0                                     // ters yön — sert ceza
        : Math.max(0, 1 - headingDelta / REVERSE_DELTA_DEG);
    }

    // 3) Süreklilik kanıtı — ani sıçrama ve geriye kayma cezalandırılır
    let contScore = 0.5;
    if (prev !== null && prev.alongRemainingM !== null) {
      const progressM = prev.alongRemainingM - along; // + = ileri gitti
      if (progressM < -BACKWARD_SLACK_M) {
        contScore = 0; // rotada geriye kaydı
      } else if (dtS > 0 && Math.abs(progressM) > maxTravelM) {
        contScore = 0; // fiziksel olarak imkânsız sıçrama
      } else {
        const expected = Math.max(1, maxTravelM);
        contScore = Math.max(0, 1 - Math.abs(progressM) / expected) * 0.5 + 0.5;
      }
    }

    const score = prev !== null
      ? 0.45 * distScore + 0.35 * headScore + 0.20 * contScore
      : 0.60 * distScore + 0.40 * headScore;

    out.push({ segIdx: i, lateral, along, headingDelta, score });
  };

  for (let i = from; i <= to; i += step) consider(i);

  // Kaba tarama yapıldıysa en iyi adayın çevresini tam çözünürlükte incele.
  if (step > 1 && out.length > 0) {
    let bestIdx = out[0].segIdx;
    let bestSc  = out[0].score;
    for (const c of out) if (c.score > bestSc) { bestSc = c.score; bestIdx = c.segIdx; }
    const rs = Math.max(from, bestIdx - step);
    const re = Math.min(to,   bestIdx + step);
    for (let i = rs; i <= re; i++) consider(i);
  }

  return { candidates: out, nearestIdx, nearestLateral };
}
