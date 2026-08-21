/**
 * deepScanObservationSources.ts — CAROS LAB · Derin Tarama TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, kendi try/catch'i içinde.
 * HİÇBİR şey başlatmaz: `startScan()` · `triggerDeepScanOfflinePass()` ·
 * `startPlatformCoreDeepScanWiring()` · `reset()` · `cancel()` ÇAĞRILMAZ.
 * Ekranı AÇMAK tarama BAŞLATMAZ ve araca tek bir sorgu bile göndermez.
 *
 * ── NEDEN ŞİMDİ BAĞLANABİLDİ ────────────────────────────────────────────────
 * Katalog `deep-scan`'i şu gerekçeyle PLACEHOLDER tutuyordu: *"Tek ve güvenli
 * bir giriş noktası yok: deepScanOrchestrator (singleton) ve
 * platformCoreDeepScanWiring (ignition-tetikli, fail-closed) iki ayrı akış.
 * Yeni akış üretmemek için bağlanmadı."*
 *
 * Bu gerekçe TARAMAYI ÇALIŞTIRMAK için geçerlidir — GÖZLEMLEMEK için değil.
 * LAB kuralı zaten aktif komutu yasaklar; dolayısıyla iki akışı da SALT-OKUNUR
 * göstermek yeni akış ÜRETMEZ, tam tersine "hangi akış otorite" sorusunu ilk
 * kez görünür kılar. Yeni bir üçüncü giriş noktası AÇILMADI.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * VIN, ham ECU adres listesi, ham PID/DID listesi ve ham rapor metni BU
 * KATMANDAN GEÇMEZ — yalnız ADET · durum enum'u · faz · yüzde · damga.
 * Parmak izi hash'i yalnız ÖN EK olarak (ilk 12) taşınır.
 */

import { deepScanRuntimeService } from '../deepScan/deepScanRuntimeService';
import {
  getDeepScanWiringStatus, getDeepScanOfflinePassStatus,
} from '../system/platformCoreDeepScanWiring';

type RuntimeSnapshot = ReturnType<typeof deepScanRuntimeService.getSnapshot>;
type WiringStatus = ReturnType<typeof getDeepScanWiringStatus>;
type OfflinePassStatus = ReturnType<typeof getDeepScanOfflinePassStatus>;

/** Runtime anlık görüntüsünün GİZLİLİK-GÜVENLİ izdüşümü. */
export interface DeepScanRuntimeShape {
  readonly scanId: string | null;
  /** Parmak izi ÖN EKİ (ilk 12) — tam hash TAŞINMAZ. */
  readonly fingerprintPrefix: string | null;
  readonly status: RuntimeSnapshot['status'];
  readonly mode: RuntimeSnapshot['mode'];
  readonly phase: RuntimeSnapshot['phase'];
  readonly progressPercent: number;
  readonly startedAtMs: number | null;
  readonly updatedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly isFirstScan: boolean;
  readonly ignitionRequired: boolean;
  readonly ignitionConfirmed: boolean | null;
  readonly ecuCount: number;
  readonly pidCount: number;
  readonly didCount: number;
  readonly newDiscoveryCount: number;
  readonly changedFirmware: boolean;
  readonly changedEcu: boolean;
  readonly warningCount: number;
  readonly errorCode: string | null;
}

export interface DeepScanObservationRawSnapshot {
  readonly readAt: number;
  /** Akış 1 — runtime durum makinesi. `null` = okuma HATA VERDİ. */
  readonly runtime: DeepScanRuntimeShape | null;
  /** Akış 2 — SystemBoot wiring (ignition-tetikli, fail-closed). */
  readonly wiring: WiringStatus | null;
  /** Akış 2'nin çevrimdışı geçiş ucu. */
  readonly offlinePass: OfflinePassStatus | null;
}

function _prefix(hash: unknown): string | null {
  return typeof hash === 'string' && hash.length > 0 ? hash.slice(0, 12) : null;
}

function _num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function _stamp(v: unknown): number | null {
  /* `0` bir damga DEĞİLDİR ("1970" göstermeyiz) — null'a düşer. */
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Tek okuma turu — ASLA fırlatmaz, hiçbir şey tetiklemez.
 *
 * @param nowMs Çağıranın bastığı damga — bu katman `Date.now()` ÇAĞIRMAZ.
 */
export function readDeepScanObservation(nowMs: number): DeepScanObservationRawSnapshot {
  let runtime: DeepScanRuntimeShape | null = null;
  try {
    const s = deepScanRuntimeService.getSnapshot();
    runtime = {
      scanId: typeof s.scanId === 'string' && s.scanId.length > 0 ? s.scanId : null,
      fingerprintPrefix: _prefix(s.vehicleFingerprintHash),
      status: s.status,
      mode: s.mode,
      phase: s.phase,
      progressPercent: _num(s.progressPercent),
      startedAtMs: _stamp(s.startedAt),
      updatedAtMs: _stamp(s.updatedAt),
      completedAtMs: _stamp(s.completedAt),
      isFirstScan: s.isFirstScan === true,
      ignitionRequired: s.ignitionRequired === true,
      ignitionConfirmed: typeof s.ignitionConfirmed === 'boolean' ? s.ignitionConfirmed : null,
      ecuCount: _num(s.discoveredEcuCount),
      pidCount: _num(s.discoveredPidCount),
      didCount: _num(s.discoveredDidCount),
      newDiscoveryCount: _num(s.newDiscoveriesCount),
      changedFirmware: s.changedFirmware === true,
      changedEcu: s.changedEcu === true,
      /* Uyarı METİNLERİ taşınmaz — yalnız ADET. */
      warningCount: Array.isArray(s.warnings) ? s.warnings.length : 0,
      errorCode: typeof s.errorCode === 'string' && s.errorCode.length > 0 ? s.errorCode : null,
    };
  } catch { runtime = null; }

  let wiring: WiringStatus | null = null;
  try { wiring = getDeepScanWiringStatus(); } catch { wiring = null; }

  let offlinePass: OfflinePassStatus | null = null;
  try { offlinePass = getDeepScanOfflinePassStatus(); } catch { offlinePass = null; }

  return { readAt: nowMs, runtime, wiring, offlinePass };
}
