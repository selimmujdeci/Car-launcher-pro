/**
 * batteryEvidenceModel.ts — akü/sistem voltajından KANIT KARARI (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Zaman ve örnekler dışarıdan verilir → test deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VOLTAJ (ADR-286 Adım 3, onaylanmış sinyal seçimi) ───────────────
 * ══════════════════════════════════════════════════════════════════════════
 * ELM327 `ATRV` adaptörün KENDİ ölçümüdür: OBD portunun besleme pininden okur,
 * ECU'ya hiç sormaz. Marka · model · protokol fark etmez ve **ECU sussa bile
 * gelir** (`obdService.ts`: "ATRV, ECU ölse bile ~5 s'de bir gelir"). 12 V
 * kurşun-asit sistemi evrensel olduğu için eşikler araç kalibrasyonu
 * GEREKTİRMEZ, ve ölçüm **park halinde** yapılabilir → #491 uzun yola çıkmadan
 * koşulabilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ŞART 1 · MARŞ PENCERESİ DIŞLANIR ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Marş anında voltaj 9–10 V'a düşer ve bu **normaldir** — marş motoru yüzlerce
 * amper çeker. O anki okumadan kanıt üretmek "akü bitik" demek olurdu; oysa
 * sağlıklı akü de marşta düşer. İki kapı birden:
 *   · Mutlak taban: `CRANK_VOLTAGE_FLOOR` altındaki örnek marş şüphelisidir.
 *     Kontak açıkken ölü akü bile bu kadar düşmez; bu bölge marşa aittir.
 *   · Geçiş penceresi: motor 0 → çalışır geçişinden sonra `CRANK_WINDOW_MS`
 *     boyunca hiç kanıt üretilmez (marş + alternatörün toparlanması).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ŞART 2 · ASIL HÜKÜM MOTOR ÇALIŞIRKEN ──────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Uyarı/kritik severity YALNIZ motor çalışırken üretilir. Motor kapalı okuma
 * yalnız `INFO` verir. İki somut sebep:
 *
 *   (1) **Kontak açık ölçüm head unit yükü altındadır.** Ekran, ses ve modem
 *       akımı çeker; SAĞLIKLI bir akü bu yük altında 12.1–12.3 V okuyabilir.
 *       Bunu "zayıf akü" saymak YANLIŞ ALARM üretir.
 *   (2) **Yeni park etmiş araçta yüzey şarjı vardır.** Alternatör az önce
 *       doldurduğu için ZAYIF bir akü 12.6 V okuyabilir. Bunu "sağlıklı"
 *       saymak YANLIŞ TEMİZLİK üretir — arızayı gizler.
 *
 * Motor çalışırken ölçülen ise alternatör/regülatör hakkında GERÇEK teşhistir:
 * yük durumundan ve yüzey şarjından bağımsızdır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ŞART 3 · TEK ÖRNEKTEN HÜKÜM YOK ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Voltaj gürültülüdür: fan/rölanti dalgalanması, klima kompresörü, direksiyon
 * pompası anlık düşüş yapar. `INFO` dışı bir severity için pencere içinde en az
 * `MIN_SAMPLES` **tutarlı** (aynı severity bandında) okuma şarttır.
 *
 * Pencere ve eşik seçimi: ATRV ~5 s'de bir gelir → 20 s ≈ 4 örnek. 3 tutarlı
 * okuma tek gürültülü örneği eler ama tepkiyi geciktirmez. Daha uzun pencere
 * gerçek bir şarj arızasını geç bildirirdi; daha kısa pencere gürültüyü
 * arızaya çevirirdi.
 */

/** Politika sürümü — eşik/pencere değişince yükselir, LAB'da görünür. */
export const BATTERY_EVIDENCE_POLICY_VERSION = 'BEV-2026.08.09' as const;

/* ── Marş kapıları (ŞART 1) ────────────────────────────────────────────── */

/** Bu voltajın altı MARŞ bölgesidir; kontak açıkken ölü akü bile buraya inmez. */
export const CRANK_VOLTAGE_FLOOR = 11.0;
/** Motor 0 → çalışır geçişinden sonra bu süre boyunca kanıt üretilmez. */
export const CRANK_WINDOW_MS = 3_000;

/* ── Tutarlılık (ŞART 3) ───────────────────────────────────────────────── */

export const CONSISTENCY_WINDOW_MS = 20_000;
export const MIN_SAMPLES = 3;

/* ── Eşikler — motor ÇALIŞIRKEN (asıl teşhis zemini) ───────────────────── */

/** Altı: alternatör/regülatör şarj etmiyor. */
export const CHARGE_LOW_V = 13.2;
/** Üstü: aşırı şarj — akü kaynar, elektronik risk altında. */
export const CHARGE_OVER_V = 15.0;
/** Normal şarj bandının üst ucu (bu ile OVER arası sınır bölgesi: alarm yok). */
export const CHARGE_NORMAL_MAX_V = 14.8;

/** Fiziksel olarak anlamsız okuma — ölçüm hatası, kanıt üretilmez. */
export const VOLTAGE_SANE_MIN = 6.0;
export const VOLTAGE_SANE_MAX = 20.0;

export type EvidenceSeverityLite = 'INFO' | 'WARNING' | 'CRITICAL';

/** Kanıt neden ÜRETİLMEDİ — sayılabilir, LAB'da gösterilir. */
export type BatterySkipReason =
  | 'NO_SAMPLES'            // hiç okuma yok
  | 'ENGINE_STATE_UNKNOWN'  // motor çalışıyor mu bilinmiyor → hangi eşik geçerli belirsiz
  | 'CRANKING'              // marş bölgesi / marş penceresi
  | 'OUT_OF_RANGE'          // fiziksel olarak anlamsız voltaj
  | 'INSUFFICIENT_SAMPLES'  // pencerede yeterli okuma yok
  | 'INCONSISTENT';         // okumalar aynı bantta değil

export interface VoltageSample {
  /** Volt. */
  readonly voltage: number;
  /** Motor devri; `0` = kapalı, `>0` = çalışıyor, `-1` = BİLİNMİYOR. */
  readonly rpm: number;
  readonly atMs: number;
}

export type BatteryEvidenceDecision =
  | { readonly produce: false; readonly reason: BatterySkipReason }
  | {
      readonly produce: true;
      readonly severity: EvidenceSeverityLite;
      /** Motor çalışır ve kapalı okumalar AYRI metriklerdir — kıyaslanmazlar. */
      readonly metric: 'battery_voltage_running' | 'battery_voltage_rest';
      readonly value: number;
      readonly sampleCount: number;
      readonly engineRunning: boolean;
    };

/** Motor çalışırken bir voltajın severity bandı. */
function runningSeverity(v: number): EvidenceSeverityLite {
  if (v > CHARGE_OVER_V) return 'CRITICAL';
  if (v < CHARGE_LOW_V) return 'WARNING';
  return 'INFO';                      // CHARGE_NORMAL_MAX_V..OVER arası sınır: alarm yok
}

function isSane(v: number): boolean {
  return Number.isFinite(v) && v >= VOLTAGE_SANE_MIN && v <= VOLTAGE_SANE_MAX;
}

/**
 * Örneklerden kanıt kararı üretir — ya kanıt ya GEREKÇE.
 *
 * ⚠️ Kanıt yoksa kanıt ÜRETİLMEZ: boş/varsayılan kanıt yazmak "ölçtük ve iyi"
 * demektir, oysa gerçek "ölçemedik"tir.
 */
export function decideBatteryEvidence(
  samples: readonly VoltageSample[],
  nowMs: number,
): BatteryEvidenceDecision {
  if (samples.length === 0) return { produce: false, reason: 'NO_SAMPLES' };

  /* Pencere içindekiler — sıralama garanti edilmez, filtreleyip son okumayı
     zamana göre seçeriz. */
  const win = samples.filter((s) => nowMs - s.atMs <= CONSISTENCY_WINDOW_MS
                                 && nowMs - s.atMs >= 0);
  if (win.length === 0) return { produce: false, reason: 'INSUFFICIENT_SAMPLES' };

  const ordered = [...win].sort((a, b) => a.atMs - b.atMs);
  const latest = ordered[ordered.length - 1]!;

  /* ── ŞART 1 · marş kapıları ─────────────────────────────────────────────
     (a) Mutlak taban: pencerede marş bölgesine inen bir okuma varsa TÜM
         pencere şüphelidir — marş anı ile onu izleyen toparlanma aynı
         pencerededir ve ortalaması yanıltır. */
  if (ordered.some((s) => isSane(s.voltage) && s.voltage < CRANK_VOLTAGE_FLOOR)) {
    return { produce: false, reason: 'CRANKING' };
  }
  /* (b) Geçiş penceresi: motor 0 → çalışır geçişi olduysa, geçişten sonra
         CRANK_WINDOW_MS boyunca kanıt üretilmez. */
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!, cur = ordered[i]!;
    if (prev.rpm === 0 && cur.rpm > 0 && (nowMs - cur.atMs) < CRANK_WINDOW_MS) {
      return { produce: false, reason: 'CRANKING' };
    }
  }

  if (!isSane(latest.voltage)) return { produce: false, reason: 'OUT_OF_RANGE' };

  /* Motor durumu bilinmiyorsa hangi eşik takımının geçerli olduğu da bilinmez.
     Tahmin etmek yerine kanıt üretmeyiz (fail-closed). */
  if (latest.rpm < 0) return { produce: false, reason: 'ENGINE_STATE_UNKNOWN' };

  const engineRunning = latest.rpm > 0;
  const metric = engineRunning ? 'battery_voltage_running' : 'battery_voltage_rest';

  /* Aynı motor durumundaki ve makul aralıktaki okumalar. Motor durumu pencere
     içinde değiştiyse iki farklı ölçüm rejimi karışır — yalnız güncel rejimin
     okumaları sayılır. */
  const sameRegime = ordered.filter(
    (s) => isSane(s.voltage) && (s.rpm > 0) === engineRunning);

  /* ── ŞART 2 · motor KAPALIYKEN severity yükseltilmez ────────────────────
     Kontak açık ölçüm head unit yükü altındadır (sağlıklı akü 12.1–12.3
     okuyabilir → yanlış alarm) ve yeni park etmiş araçta yüzey şarjı zayıf
     aküyü iyi gösterir (→ yanlış temizlik). Bu yüzden motor kapalı okuma
     KAYDEDİLİR ama hüküm taşımaz. */
  if (!engineRunning) {
    return {
      produce: true, severity: 'INFO', metric, value: latest.voltage,
      sampleCount: sameRegime.length, engineRunning: false,
    };
  }

  /* ── ŞART 3 · INFO dışı severity için tutarlı çoklu okuma ──────────────── */
  const sev = runningSeverity(latest.voltage);
  if (sev === 'INFO') {
    return {
      produce: true, severity: 'INFO', metric, value: latest.voltage,
      sampleCount: sameRegime.length, engineRunning: true,
    };
  }

  if (sameRegime.length < MIN_SAMPLES) {
    return { produce: false, reason: 'INSUFFICIENT_SAMPLES' };
  }
  const consistent = sameRegime.filter((s) => runningSeverity(s.voltage) === sev);
  if (consistent.length < MIN_SAMPLES) {
    return { produce: false, reason: 'INCONSISTENT' };
  }

  return {
    produce: true, severity: sev, metric, value: latest.voltage,
    sampleCount: consistent.length, engineRunning: true,
  };
}
