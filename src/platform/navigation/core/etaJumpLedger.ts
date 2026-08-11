/**
 * etaJumpLedger.ts — ETA SIÇRAMASININ SEBEBİNİ KAYDEDEN DEFTER (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global karar YOK.
 * Zaman ve girdiler dışarıdan verilir → cihazsız test edilebilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN (G3 · kütük #530) ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sahada (2026-08-05, Konya→Tarsus) ETA aynı yolculukta **43 kez >60 s**
 * sıçradı; en büyüğü **6 560 s = 1 sa 49 dk**. `etaS` aralığı 10 007 ↔ 16 764 s.
 *
 * #441 kuş uçuşu mesafeyi ETA girdisinden ÇIKARDI (`remainingDistanceM` yalnız
 * `ALONG_ROUTE` iken geçer, aksi hâlde `null`) — doğru bir düzeltmeydi. Ama
 * ARİTMETİK gösteriyor ki sıçrama tam olarak ORADAN da doğabilir:
 *
 *   ETA = base × factor,  factor ∈ [0.8, 1.5],  mesafe yoksa factor = 1
 *
 *   base = 10 007 s (sahanın alt sınırı) için:
 *     factor 1.0 → 1.5 geçişi  =  **+5 004 s (83 dk)** tek adımda
 *     factor 1.0 → 0.8 geçişi  =  −2 001 s (33 dk)
 *   Gözlenen aralık oranı 16 764/10 007 = **1,68** → [0.8, 1.5] bandının İÇİNDE.
 *
 * Yani düzeltme çarpanının **AÇILIP KAPANMASI** başlı başına bir sıçrama
 * kaynağıdır. İki anahtar onu açıp kapatır:
 *   (1) `remainingDistanceM === null`  → `distanceSource` ALONG_ROUTE değil
 *   (2) `rollingAvgKmh < ETA_MIN_CORRECTION_KMH` (8 km/h) → araç yavaş/durdu
 *
 * ── BU DEFTERİN İŞİ ───────────────────────────────────────────────────────
 * Sıçrama olduğunda **hangi anahtarın o anda değiştiğini** kaydetmek. Böylece
 * bir sonraki saha koşumunda "etaModel mi, mesafe kaynağı mı" sorusu
 * TAHMİNLE değil KAYITLA cevaplanır.
 *
 * ⚠️ Bu defter KARAR ÜRETMEZ: ETA'yı değiştirmez, eşik uygulamaz, uyarı
 * doğurmaz. Yalnız gözlemdir (§7.9 "sessiz kayıt" kovası).
 */

import { ETA_MIN_CORRECTION_KMH, etaSpeedGateWeight } from './etaModel';

/** Sıçrama sayılmak için gereken en küçük mutlak değişim (s) — saha ölçütüyle aynı. */
export const ETA_JUMP_MIN_S = 60;

/**
 * #538 — kapı ARTIK BİR BANT: rampa ağırlığı bu kadar oynadıysa "kapı değişti".
 *
 * NEDEN GEREKLİ: rampa öncesi kapı ikili bir anahtardı ve `>= 8` geçişini
 * yakalamak yetiyordu. Rampadan sonra çarpan bant İÇİNDE de (ör. 9 → 15 km/h)
 * belirgin oynar; yalnız eşik geçişine bakan bir defter bu yeni mekanizmaya
 * KÖR olurdu ve "SPEED_GATE_CHANGED düştü" sonucu YANILTICI çıkardı.
 * Doğrulama ölçümünün geçerliliği bu bant farkındalığına bağlıdır.
 */
export const ETA_GATE_WEIGHT_MIN_DELTA = 0.2;

/** Defterin tavanı — sınırsız kayıt cihazda bellek sorunudur. */
export const ETA_JUMP_RING = 40;

/**
 * Sıçramanın hangi girdiyle AYNI ANDA olduğu.
 *
 * ⚠️ `SUSPECT` değil `CHANGED` deniyor: defter nedensellik İDDİA ETMEZ, yalnız
 * eşzamanlılığı kaydeder. Nedensellik hükmü okuyucunundur.
 */
export type EtaJumpTrigger =
  /** Mesafe kaynağı açılıp kapandı (ALONG_ROUTE ↔ yok) — düzeltme çarpanı anahtarı. */
  | 'DISTANCE_SOURCE_CHANGED'
  /** Hız düzeltme kapısı açılıp kapandı (rollingAvgKmh 8 km/h eşiğini geçti). */
  | 'SPEED_GATE_CHANGED'
  /** Rota revizyonu değişti (reroute) — ETA'nın sıçraması BEKLENİR. */
  | 'ROUTE_REVISION_CHANGED'
  /** ETA durumu değişti (ör. ROUTE_MODEL ↔ DEGRADED_FALLBACK). */
  | 'ETA_STATE_CHANGED'
  /** Yukarıdakilerin hiçbiri değişmedi — sıçrama TABAN süreden geliyor. */
  | 'BASE_DURATION_ONLY';

export const ETA_JUMP_TRIGGER_LABEL: Readonly<Record<EtaJumpTrigger, string>> = {
  DISTANCE_SOURCE_CHANGED: 'mesafe kaynağı değişti (düzeltme çarpanı anahtarı)',
  SPEED_GATE_CHANGED:      'hız düzeltme kapısı değişti (8 km/h eşiği)',
  ROUTE_REVISION_CHANGED:  'rota revizyonu değişti (reroute — sıçrama beklenir)',
  ETA_STATE_CHANGED:       'ETA durumu değişti',
  BASE_DURATION_ONLY:      'yalnız taban süre değişti (anahtar yok)',
} as const;

/** Sıçrama anındaki ölçülen durum — karşılaştırma için iki taraf da taşınır. */
export interface EtaSample {
  readonly atMs: number;
  readonly etaSeconds: number | null;
  /** Düzeltme öncesi taban (rota süre modeli). */
  readonly baseDurationS: number | null;
  /** Uygulanan düzeltme çarpanı. */
  readonly factor: number | null;
  /** `null` = mesafe ETA'ya VERİLMEDİ (kaynak ALONG_ROUTE değil). */
  readonly remainingDistanceM: number | null;
  readonly rollingAvgKmh: number;
  readonly routeRevision: number;
  readonly etaState: string;
}

export interface EtaJumpRecord {
  readonly atMs: number;
  readonly fromS: number;
  readonly toS: number;
  readonly deltaS: number;
  readonly trigger: EtaJumpTrigger;
  /** İnsan-okur tek cümle — LAB'da doğrudan gösterilir. */
  readonly note: string;
  /** Sıçrama anında düzeltme çarpanı ne kadar oynadı. `null` = ölçülemedi. */
  readonly factorFrom: number | null;
  readonly factorTo: number | null;
}

/**
 * İki ardışık örnekten sıçrama kaydı üretir.
 *
 * @returns `null` = sıçrama YOK (eşik altı) ya da ETA ölçülemedi.
 */
export function detectEtaJump(prev: EtaSample, next: EtaSample): EtaJumpRecord | null {
  if (prev.etaSeconds === null || next.etaSeconds === null) return null;
  const deltaS = next.etaSeconds - prev.etaSeconds;
  if (Math.abs(deltaS) < ETA_JUMP_MIN_S) return null;

  /* Anahtar sırası ÖNEMLİ: reroute varsa sıçrama zaten beklenir ve diğer
     anahtarlar onun gölgesinde kalır — en güçlü açıklama önce gelir. */
  const distanceSwitched =
    (prev.remainingDistanceM === null) !== (next.remainingDistanceM === null);
  /* Eşik geçişi VE bant içi belirgin ağırlık değişimi — ikisi de kapı olayıdır.
     Eşik sabiti `etaModel`den gelir: aynı 8 km/h iki dosyada yazılı DEĞİLDİR. */
  const gateCrossed =
    (prev.rollingAvgKmh >= ETA_MIN_CORRECTION_KMH) !== (next.rollingAvgKmh >= ETA_MIN_CORRECTION_KMH);
  const gateWeightMoved =
    Math.abs(etaSpeedGateWeight(next.rollingAvgKmh) - etaSpeedGateWeight(prev.rollingAvgKmh))
      >= ETA_GATE_WEIGHT_MIN_DELTA;
  const speedGateSwitched = gateCrossed || gateWeightMoved;

  let trigger: EtaJumpTrigger;
  if (prev.routeRevision !== next.routeRevision)      trigger = 'ROUTE_REVISION_CHANGED';
  else if (prev.etaState !== next.etaState)           trigger = 'ETA_STATE_CHANGED';
  else if (distanceSwitched)                          trigger = 'DISTANCE_SOURCE_CHANGED';
  else if (speedGateSwitched)                         trigger = 'SPEED_GATE_CHANGED';
  else                                                trigger = 'BASE_DURATION_ONLY';

  const sec = (v: number) => `${Math.round(v)} s`;
  const min = (v: number) => `${(v / 60).toFixed(1)} dk`;
  const note = `ETA ${sec(prev.etaSeconds)} → ${sec(next.etaSeconds)} `
             + `(${deltaS > 0 ? '+' : ''}${min(deltaS)}) · ${ETA_JUMP_TRIGGER_LABEL[trigger]}`;

  return {
    atMs: next.atMs,
    fromS: prev.etaSeconds,
    toS: next.etaSeconds,
    deltaS,
    trigger,
    note,
    factorFrom: prev.factor,
    factorTo: next.factor,
  };
}

/** Bounded defter — en YENİ kayıtlar korunur. */
export function appendJump(
  ledger: readonly EtaJumpRecord[], rec: EtaJumpRecord,
): EtaJumpRecord[] {
  const out = [...ledger, rec];
  return out.length > ETA_JUMP_RING ? out.slice(out.length - ETA_JUMP_RING) : out;
}

export interface EtaJumpSummary {
  readonly total: number;
  /** Tetikleyici başına adet — hangi kaynağın baskın olduğu BURADAN okunur. */
  readonly byTrigger: Readonly<Record<EtaJumpTrigger, number>>;
  /** En büyük tek sıçrama (mutlak, s). `null` = kayıt yok. */
  readonly maxAbsDeltaS: number | null;
  /**
   * Baskın tetikleyici — **yalnız açık farkla öndeyse** bildirilir.
   * Berabere/az farkta `null`: "muhtemelen X" demek yasak (kanıt eşiği).
   */
  readonly dominant: EtaJumpTrigger | null;
}

/** Baskınlık için gereken pay — bundan azı "belirsiz" sayılır. */
export const ETA_DOMINANT_MIN_SHARE = 0.5;

export function summarizeJumps(ledger: readonly EtaJumpRecord[]): EtaJumpSummary {
  const byTrigger: Record<EtaJumpTrigger, number> = {
    DISTANCE_SOURCE_CHANGED: 0, SPEED_GATE_CHANGED: 0,
    ROUTE_REVISION_CHANGED: 0, ETA_STATE_CHANGED: 0, BASE_DURATION_ONLY: 0,
  };
  let maxAbs: number | null = null;
  for (const r of ledger) {
    byTrigger[r.trigger] += 1;
    const a = Math.abs(r.deltaS);
    if (maxAbs === null || a > maxAbs) maxAbs = a;
  }
  let dominant: EtaJumpTrigger | null = null;
  if (ledger.length > 0) {
    const entries = (Object.keys(byTrigger) as EtaJumpTrigger[])
      .map((k) => [k, byTrigger[k]] as const)
      .sort((a, b) => b[1] - a[1]);
    /* İKİ ŞART BİRLİKTE: (1) pay eşiği, (2) ikinciden AÇIK FARK.
       Berabere durumda baskın ilan etmek "muhtemelen X" demektir — tam olarak
       kaçındığımız hata. Eşitlikte `null` döner ve okuyucu belirsizliği görür. */
    const share = entries[0][1] / ledger.length;
    const clearLead = entries.length < 2 || entries[0][1] > entries[1][1];
    if (share >= ETA_DOMINANT_MIN_SHARE && clearLead) dominant = entries[0][0];
  }
  return { total: ledger.length, byTrigger, maxAbsDeltaS: maxAbs, dominant };
}
