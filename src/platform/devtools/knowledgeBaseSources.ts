/**
 * knowledgeBaseSources.ts — CAROS LAB · Bilgi Tabanı Gezgini TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, kendi try/catch'i içinde.
 * HİÇBİR şey başlatmaz/yazmaz: kayıt EKLEMEZ, SİLMEZ, temizlemez, keşif
 * TETİKLEMEZ, araca sorgu GÖNDERMEZ. `startVehicleKnowledgeBase()` ÇAĞRILMAZ —
 * ekran açmak öğrenme başlatmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Depodaki kayıt HAM VIN taşır (`VehicleKnowledgeRecord.vin`). VIN bu katmandan
 * OLDUĞU GİBİ GEÇMEZ: yalnız WMI'ye kadar açık maske çıkar (`maskVinStrict`).
 * KATI sürüm bilinçli: `maskVin`/`maskVinForDisplay` maskeleyemediğinde dürüst
 * bir `'UNKNOWN'` döner ve bu bir GÖSTERİM kararıdır; burada ise ham değerin
 * sızma riskini sıfırlamak için `null` istiyoruz. Parmak izi hash'i de
 * kısaltılır (ilk 12) — tam hash
 * araç-arası eşleştirmeye izin verirdi. Firmware sürümleri ve ECU adresleri
 * ADET olarak taşınır; ham liste ekrana GELMEZ.
 */

import {
  vehicleKnowledgeBaseStore, vehicleStats, MAX_KNOWLEDGE_RECORDS,
} from '../vehicleKnowledgeBase';
import { maskVinStrict } from '../privacy/vinMask';

/** Tek aracın METİN-GÜVENLİ izdüşümü. */
export interface KnowledgeVehicleShape {
  /** Parmak izi ön eki (ilk 12) — tam hash TAŞINMAZ. */
  readonly fingerprintPrefix: string;
  /** Maskeli VIN (yalnız WMI açık: `ABC**…`) veya `null` = kayıtta VIN yok. */
  readonly vinMasked: string | null;
  readonly protocol: string | null;
  readonly profileHint: string | null;
  readonly pidCount: number;
  readonly didCount: number;
  readonly ecuCount: number;
  readonly totalDiscoveries: number;
  readonly totalConnections: number;
  readonly confidence: number;
  readonly firstSeenMs: number;
  readonly lastSeenMs: number;
  /** Görülen firmware sürümü ADEDİ — sürüm dizeleri TAŞINMAZ. */
  readonly firmwareCount: number;
  /** Desteklenen OBD modları — türetilmiş, PII değil (ör. '01', '22'). */
  readonly supportedModes: readonly string[];
}

export interface KnowledgeBaseRawSnapshot {
  readonly readAt: number;
  /** `null` = depo okuması HATA VERDİ ("kayıt yok" ile karıştırılmaz). */
  readonly vehicles: readonly KnowledgeVehicleShape[] | null;
  /** Depo tavanı (LRU) — eMMC yıpranmasına karşı sınır. */
  readonly maxRecords: number;
}

function _prefix(hash: unknown): string {
  return typeof hash === 'string' && hash.length > 0 ? hash.slice(0, 12) : '—';
}

function _str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function _num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Tek okuma turu — ASLA fırlatmaz.
 *
 * @param nowMs Çağıranın bastığı damga — bu katman `Date.now()` ÇAĞIRMAZ.
 */
export function readKnowledgeBaseSnapshot(nowMs: number): KnowledgeBaseRawSnapshot {
  let vehicles: readonly KnowledgeVehicleShape[] | null = null;
  try {
    vehicles = vehicleKnowledgeBaseStore.list().map((r) => {
      let stats = { totalPids: 0, totalDids: 0, totalEcus: 0, totalDiscoveries: 0 };
      try { stats = vehicleStats(r); } catch { /* fail-soft: özet hesaplanamadı */ }

      let vinMasked: string | null = null;
      try {
        const raw = _str(r.vin);
        /* VIN OLDUĞU GİBİ GEÇMEZ — maskeleme başarısızsa `null`, ham değer DEĞİL. */
        vinMasked = raw ? maskVinStrict(raw) : null;
      } catch { vinMasked = null; }

      return {
        fingerprintPrefix: _prefix(r.fingerprintHash),
        vinMasked,
        protocol: _str(r.protocol),
        profileHint: _str(r.profileHint),
        pidCount: stats.totalPids,
        didCount: stats.totalDids,
        ecuCount: stats.totalEcus,
        totalDiscoveries: stats.totalDiscoveries,
        totalConnections: _num(r.totalConnections),
        confidence: _num(r.confidence),
        firstSeenMs: _num(r.firstSeen),
        lastSeenMs: _num(r.lastSeen),
        firmwareCount: Array.isArray(r.firmwareVersions) ? r.firmwareVersions.length : 0,
        supportedModes: Array.isArray(r.supportedModes) ? [...r.supportedModes] : [],
      };
    });
  } catch { vehicles = null; }

  return { readAt: nowMs, vehicles, maxRecords: MAX_KNOWLEDGE_RECORDS };
}
