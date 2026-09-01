/**
 * voiceGuidanceAudit — SÖYLENMEYENİ VE GEÇ SÖYLENENİ ÖLÇER (SAF · P0-NAV-16).
 *
 * SAF: I/O YOK · TTS YOK · timer YOK · `Date.now` YOK · React YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-16 ölçümü · 2026-08-24, koddan) ─────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sesli yönlendirme zinciri NAV-16'nın istediklerinin ÇOĞUNA zaten sahipti:
 *   · deterministik manevra kimliği — `oturum:rotaRevizyonu:adım`
 *     (yalnız adım indeksi kullanmak reroute sonrası "zaten söylendi"
 *      yanlışını üretiyordu; bu kusur ZATEN düzeltilmiş)
 *   · üç kademe (`FAR` HAZIRLIK · `NEAR` YAKLAŞMA · `IMMINENT` DÖNÜŞ)
 *   · **hıza uyarlanabilir** son kademe (~4 sn önce; sabit 80 m şehir içinde
 *     erken, otoyolda geç kalıyordu — ölçülmüş ve düzeltilmiş)
 *   · rota kimliği değişince kuyruk TEMİZLENİR (reroute sonrası eski maske
 *     taşınmaz)
 *   · reroute sırasında manevra anonsu BASTIRILIR
 *   · `distanceSource === 'UNKNOWN'` iken KONUŞULMAZ (uydurma yasağı)
 * **Bu tur o algoritmayı YENİDEN KURMADI.**
 *
 * Ölçülen boşluk şuydu: **runtime yalnız SÖYLENENİ sayıyordu.** NAV-16'nın
 * dört sorusundan (çok erken · çok geç · iki kez · HİÇ) yalnız "iki kez"
 * ölçülebiliyordu (`_duplicateSuppressed`). "Hiç söylenmedi" ve "geç söylendi"
 * hiçbir yerde görünmüyordu — oysa sürücünün gerçekten yaşadığı kusur bunlar:
 * dönüşü kaçırmak, anonsu dönüşün üstünde duymak.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · KARAR ÜRETMEZ: anons tetiklemez, eşik değiştirmez, kademe eklemez.
 *  · Kanıt yetersizse `UNKNOWN` — konuşulmamış olması her zaman kusur DEĞİLDİR
 *    (mesafe kaynağı bilinmiyorsa susmak DOĞRU davranıştır).
 *  · PII TAŞIMAZ: talimat METNİ girmez, yalnız kademe · mesafe · sınıf.
 */

import { STAGE_BIT, type GuidanceStage } from './voiceGuidanceModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) ZAMANLAMA HÜKMÜ — "ÇOK GEÇ" ÖLÇÜLEBİLİR OLSUN
   ══════════════════════════════════════════════════════════════════════════ */

export type AnnouncementTiming =
  /** Kademenin penceresinde söylendi. */
  | 'ON_TIME'
  /** Pencereye girildikten epey sonra söylendi — tick kaçmış olabilir. */
  | 'LATE'
  /** Manevranın neredeyse üstünde söylendi — sürücü tepki veremez. */
  | 'VERY_LATE'
  /** Ölçülemedi. */
  | 'UNKNOWN';

export const ANNOUNCEMENT_TIMING_LABEL: Readonly<Record<AnnouncementTiming, string>> = {
  ON_TIME:   'zamanında',
  LATE:      'geç — kademe penceresinin epey içinde',
  VERY_LATE: 'ÇOK GEÇ — sürücü tepki veremez',
  UNKNOWN:   'ölçülemedi',
} as const;

/**
 * Anonsun kademe penceresine göre ne kadar geç kaldığı (0–1 oranı).
 *
 * `LATE` eşiği: mesafe, kademe eşiğinin YARISININ altına inmişse anons
 * penceresinin ilk yarısı kaçırılmış demektir.
 */
export const LATE_RATIO = 0.5;
/** `VERY_LATE` eşiği: eşiğin beşte birinin altı — manevranın üstü. */
export const VERY_LATE_RATIO = 0.2;

/**
 * Bir anonsun zamanlamasını yargılar. **SAF.**
 *
 * @param distanceAtSpeechM Anons ANINDA manevraya kalan mesafe.
 * @param stageThresholdM   O kademenin eşiği (FAR 600 · NEAR 250 · IMMINENT hıza bağlı).
 */
export function judgeAnnouncementTiming(
  distanceAtSpeechM: number | null,
  stageThresholdM: number | null,
): AnnouncementTiming {
  if (distanceAtSpeechM === null || stageThresholdM === null
      || !Number.isFinite(distanceAtSpeechM) || !Number.isFinite(stageThresholdM)
      || stageThresholdM <= 0 || distanceAtSpeechM < 0) {
    return 'UNKNOWN';
  }
  const ratio = distanceAtSpeechM / stageThresholdM;
  if (ratio <= VERY_LATE_RATIO) return 'VERY_LATE';
  if (ratio <= LATE_RATIO)      return 'LATE';
  return 'ON_TIME';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KAÇIRILAN MANEVRA — "HİÇ SÖYLENMEDİ" ÖLÇÜLEBİLİR OLSUN
   ══════════════════════════════════════════════════════════════════════════ */

export type MissedGuidance =
  /** Tüm gereken kademeler söylendi. */
  | 'NONE'
  /** Hazırlık/yaklaşma söylendi ama SON uyarı (dönüş anı) söylenmedi. */
  | 'MISSED_IMMINENT'
  /** Manevra için HİÇBİR anons yapılmadı. */
  | 'MISSED_ALL'
  /** Susmak DOĞRUYDU — kanıt yoktu (mesafe kaynağı bilinmiyordu vb.). */
  | 'SILENCE_JUSTIFIED';

export const MISSED_GUIDANCE_LABEL: Readonly<Record<MissedGuidance, string>> = {
  NONE:              'anons tam',
  MISSED_IMMINENT:   'son uyarı SÖYLENMEDİ — sürücü dönüşü kaçırabilir',
  MISSED_ALL:        'bu manevra için HİÇ anons yapılmadı',
  SILENCE_JUSTIFIED: 'susmak doğruydu — kanıt yoktu',
} as const;

export interface MissedGuidanceInput {
  /** Manevra geçilirken bu manevra için söylenmiş kademe bitleri. */
  readonly spokenBits: number;
  /**
   * Manevra boyunca mesafe kaynağı en az BİR KEZ kullanılabilir miydi.
   * `false` ise susmak DOĞRUYDU — uydurma anons yasağı gereği.
   */
  readonly hadUsableDistance: boolean;
  /** Manevra boyunca reroute sürüyor muydu — anons zaten bastırılır. */
  readonly wasRerouting: boolean;
}

/**
 * Geçilmiş bir manevranın anons bütünlüğünü yargılar. **SAF.**
 *
 * ⚠️ SESSİZLİK HER ZAMAN KUSUR DEĞİLDİR: mesafe kaynağı bilinmiyorken ya da
 * reroute sürerken susmak ÜRÜNÜN DOĞRU DAVRANIŞIDIR. Bunları kusur saymak,
 * fail-closed tasarımı arıza gibi göstermek olurdu.
 */
export function judgeMissedGuidance(i: MissedGuidanceInput): MissedGuidance {
  if (i.wasRerouting || !i.hadUsableDistance) return 'SILENCE_JUSTIFIED';
  if (i.spokenBits === 0) return 'MISSED_ALL';
  if ((i.spokenBits & STAGE_BIT.IMMINENT) === 0) return 'MISSED_IMMINENT';
  return 'NONE';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DEFTER (bounded · fail-soft)
   ══════════════════════════════════════════════════════════════════════════ */

export interface GuidanceAuditEntry {
  readonly maneuverId: string;
  readonly stage: GuidanceStage | null;
  readonly timing: AnnouncementTiming;
  readonly missed: MissedGuidance;
  /** Anons anındaki mesafe (m). Ölçülemezse `null`. */
  readonly distanceM: number | null;
  readonly atMs: number;
}

export const GUIDANCE_AUDIT_RING = 12;

function _emptyTiming(): Record<AnnouncementTiming, number> {
  return { ON_TIME: 0, LATE: 0, VERY_LATE: 0, UNKNOWN: 0 };
}
function _emptyMissed(): Record<MissedGuidance, number> {
  return { NONE: 0, MISSED_IMMINENT: 0, MISSED_ALL: 0, SILENCE_JUSTIFIED: 0 };
}

let _timing = _emptyTiming();
let _missed = _emptyMissed();
let _recent: GuidanceAuditEntry[] = [];

/** Bir anonsun zamanlamasını sayar. **THROW ETMEZ.** */
export function recordAnnouncementTiming(
  maneuverId: string, stage: GuidanceStage,
  distanceM: number | null, thresholdM: number | null, atMs: number,
): void {
  try {
    const timing = judgeAnnouncementTiming(distanceM, thresholdM);
    _timing[timing] = (_timing[timing] ?? 0) + 1;
    /* Yalnız ZAMANINDA OLMAYAN anonslar halkaya girer — halka anlamlı
       olayları taşısın (normal anonslar sayaçta zaten var). */
    if (timing === 'ON_TIME' || timing === 'UNKNOWN') return;
    _recent.push({ maneuverId, stage, timing, missed: 'NONE', distanceM, atMs });
    if (_recent.length > GUIDANCE_AUDIT_RING) {
      _recent = _recent.slice(_recent.length - GUIDANCE_AUDIT_RING);
    }
  } catch { /* fail-soft: teşhis kaydı anonsu ASLA bozamaz */ }
}

/** Geçilmiş bir manevranın anons bütünlüğünü sayar. **THROW ETMEZ.** */
export function recordMissedGuidance(
  maneuverId: string, i: MissedGuidanceInput, atMs: number,
): void {
  try {
    const missed = judgeMissedGuidance(i);
    _missed[missed] = (_missed[missed] ?? 0) + 1;
    if (missed === 'NONE' || missed === 'SILENCE_JUSTIFIED') return;
    _recent.push({
      maneuverId, stage: null, timing: 'UNKNOWN', missed, distanceM: null, atMs,
    });
    if (_recent.length > GUIDANCE_AUDIT_RING) {
      _recent = _recent.slice(_recent.length - GUIDANCE_AUDIT_RING);
    }
  } catch { /* fail-soft */ }
}

export interface GuidanceAuditSnapshot {
  readonly timing: Readonly<Record<AnnouncementTiming, number>>;
  readonly missed: Readonly<Record<MissedGuidance, number>>;
  readonly recent: readonly GuidanceAuditEntry[];
  /** Yargılanan toplam anons. */
  readonly announcementCount: number;
  /** Yargılanan toplam geçilmiş manevra. */
  readonly maneuverCount: number;
}

export function getGuidanceAudit(): GuidanceAuditSnapshot {
  let announcementCount = 0;
  for (const k of Object.keys(_timing) as AnnouncementTiming[]) announcementCount += _timing[k];
  let maneuverCount = 0;
  for (const k of Object.keys(_missed) as MissedGuidance[]) maneuverCount += _missed[k];
  return {
    timing: { ..._timing },
    missed: { ..._missed },
    recent: _recent.slice(),
    announcementCount,
    maneuverCount,
  };
}

/** Yeni oturum — eski yolculuğun anons kusurları yenisine taşınmaz. */
export function resetGuidanceAudit(): void {
  _timing = _emptyTiming();
  _missed = _emptyMissed();
  _recent = [];
}
