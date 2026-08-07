/**
 * ignitionEvidenceAdapter.ts — ham araç sinyallerini KONTAK KANITINA çeviren adaptör (#127).
 *
 * ── NEDEN AYRI DOSYA (deepScanIgnitionSource'un İÇİNE YAZILMADI) ────────────
 * `deepScanIgnitionSource.ts` kaynağında AÇIKÇA şu yazar:
 *   "Fizik eşiği (RPM/voltaj) UYDURULMAZ: yardımcı sinyaller ÇAĞIRAN tarafından bool'a
 *    yorumlanıp `engine_running` gibi AUTHORITATIVE bir kanıt olarak sunulur; bu katman
 *    ham sayıya eşik uygulamaz (zero-trust telemetry)."
 * RPM/voltaj eşiklerini o saf çözümleyicinin içine koymak bu invaryantı bozardı ve
 * çözümleyiciyi araç-fiziğine bağımlı hâle getirirdi. Eşik YORUMU buraya, KARAR oraya.
 *
 * ── ZERO-TRUST: TEK SİNYAL ONAY VERMEZ ──────────────────────────────────────
 * `engine_running` kanıtı YALNIZ İKİ BAĞIMSIZ sinyal AYNI ANDA sağlandığında üretilir:
 *   (1) RPM > {@link ENGINE_RUNNING_MIN_RPM}  → motor dönüyor
 *   (2) Şarj voltajı ≥ {@link ALTERNATOR_MIN_VOLTS} → alternatör basıyor (kontak KESİN açık)
 * Tek başına RPM (rölanti sanılabilecek gürültü), tek başına voltaj (yeni şarj edilmiş akü),
 * "OBD bağlı" veya "hız > 0" ASLA onay üretmez — bunlar TÜRETİLMİŞ sinyallerdir.
 *
 * Koşullar sağlanmazsa `null` döner: kaynak "kontak KAPALI" DEMEZ, yalnız SUSAR
 * (bilinmeyeni `false` diye kaydetmek kanıt uydurmaktır). Çözümleyici authoritative
 * kanıt bulamayınca zaten `confirmed: null` (fail-closed) üretir.
 *
 * SAF · yan etkisiz · throw ETMEZ · yeni bağımlılık/timer/abonelik YOK.
 */

import type { IgnitionEvidence } from './deepScanIgnitionSource';

/**
 * Motorun DÖNDÜĞÜNÜ kabul etmek için asgari RPM.
 * Gerekçe: marş/stall bölgesi ~200-300 RPM'dir; rölanti benzinli ~700-900, dizel ~750-800.
 * 400 iki bölgenin ARASINDADIR: dönen motoru kaçırmaz, marş anını/gürültüyü onaylamaz.
 * Politika sabiti — cihazda ayarlanabilir, saha doğrulamasına tabi (kütük #127).
 */
export const ENGINE_RUNNING_MIN_RPM = 400;

/**
 * Alternatörün BASTIĞINI kabul etmek için asgari 12V hat voltajı.
 * Gerekçe: dinlenmiş dolu akü 12.6-12.8 V; alternatör şarj gerilimi 13.5-14.7 V.
 * 13.2 iki bandın ARASINDADIR: dolu aküyü "motor çalışıyor" sanmaz, şarjı kaçırmaz.
 * (assistantSafetyKernel'in düşük-voltaj eşiği 11.8 V ile ÇELİŞMEZ; o AYRI bir karardır.)
 */
export const ALTERNATOR_MIN_VOLTS = 13.2;

/** Bu kanıtın güveni — VAL OBD base confidence (0.85) ile hizalı, iki-sinyal şartı gereği. */
export const ENGINE_RUNNING_CONFIDENCE = 0.85;

/** İmkânsız değer reddi (zero-trust telemetry — aftermarket adaptör çöp döndürebilir). */
const MAX_PLAUSIBLE_RPM   = 20_000;
const MAX_PLAUSIBLE_VOLTS = 36;   // 24V sistemlerde şarj ~28 V; üstü sensör bozukluğu

function _finitePositive(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

/** Adaptörün girdisi — servis importu YOK, yapısal tip (obdData ile uyumlu). */
export interface EngineRunningInput {
  /** Motor devri (1/dk). Yok/geçersiz/-1 → kanıt üretilmez. */
  readonly rpm?: number | null;
  /** 12V hat voltajı (V). Yok/geçersiz/-1 → kanıt üretilmez. */
  readonly batteryVoltage?: number | null;
  /** Ölçüm anı (`Date.now()` ms). Geçersizse kanıt üretilmez (tazelik hesaplanamaz). */
  readonly observedAt?: number | null;
}

/**
 * RPM + şarj voltajı kombinasyonundan AUTHORITATIVE `engine_running` kanıtı üretir.
 *
 * @returns İki sinyal de eşiği geçtiyse dondurulmuş kanıt; aksi hâlde `null` (SUS).
 *          `null` "kontak kapalı" ANLAMINA GELMEZ — yalnız "bu kaynaktan onay yok".
 */
export function deriveEngineRunningEvidence(
  input: EngineRunningInput | null | undefined,
): IgnitionEvidence | null {
  if (!input || typeof input !== 'object') return null;

  const rpm = _finitePositive(input.rpm, MAX_PLAUSIBLE_RPM);
  const volts = _finitePositive(input.batteryVoltage, MAX_PLAUSIBLE_VOLTS);
  const observedAt = typeof input.observedAt === 'number' && Number.isFinite(input.observedAt)
    && input.observedAt > 0 ? input.observedAt : null;

  // Üç şart da POZİTİF kanıt ister: eksik olan varsa SUSULUR (fail-closed).
  if (rpm === null || volts === null || observedAt === null) return null;
  if (rpm <= ENGINE_RUNNING_MIN_RPM) return null;
  if (volts < ALTERNATOR_MIN_VOLTS) return null;

  return Object.freeze({
    source: 'engine_running',
    value: true,          // Bu adaptör YALNIZ "açık" der; "kapalı" iddiası üretmez.
    confidence: ENGINE_RUNNING_CONFIDENCE,
    observedAt,
    authoritative: true,
    reason: 'rpm_and_alternator',
  });
}

/**
 * Deep Scan ignition kaynağına takılabilen pull-sağlayıcı üretir.
 * Okuyucu (ör. `onOBDData` senkron son-değer yakalama) çağıran tarafından verilir —
 * bu modül HİÇBİR servisi import ETMEZ. Okuyucu patlarsa `null` (fail-soft).
 */
export function createEngineRunningProvider(
  read: () => EngineRunningInput | null,
): () => IgnitionEvidence | null {
  return () => {
    try { return deriveEngineRunningEvidence(read()); } catch { return null; }
  };
}
