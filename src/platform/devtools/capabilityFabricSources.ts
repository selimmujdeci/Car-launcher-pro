/**
 * capabilityFabricSources — CAROS LAB · Capability Fabric TEK OKUMA KATMANI.
 *
 * ── SÖZLEŞME (A3–A8 turlarıyla AYNI desen) ──────────────────────────────────
 *  · TEK okuma katmanı · SENKRON · her getter kendi `try/catch`i içinde.
 *  · **HİÇBİR KOMUT GÖNDERMEZ:** capability çalıştırmaz, kapıyı zorlayıcı kipe
 *    almaz, katalogu değiştirmez, sayaç sıfırlamaz, timer kurmaz.
 *  · **GİZLİLİK:** parametre DEĞERİ · transkript · kişi adı · adres · sensör
 *    metni · VIN · konum bu katmana GİRMEZ. Yalnız katalog sabitleri (kimlik,
 *    işlem adı, enum) ve ADET taşınır.
 *  · Okuma düşerse `null` döner — model bunu `UNAVAILABLE` gösterir, sahte
 *    sıfır ÜRETMEZ.
 */

import {
  getCapabilityFabricDiagnostics, isCapabilityFabricEnforcing, readAvailability,
  type CapabilityFabricDiagnostics,
} from '../capability/fabric/capabilityFabric';
import {
  CAROS_CAPABILITY_CATALOG, brainExposedIntents,
} from '../capability/fabric/carosCapabilityCatalog';
import { inspectCatalogIntegrity } from '../capability/fabric/capabilityResolver';
import type { CatalogIntegrityReport } from '../capability/fabric/capabilityResolver';
/* MAVI-F7: gözlem defteri — YENİ EKRAN AÇILMADI, mevcut Capability Fabric
   yüzeyi genişletildi (LAB ekran enflasyonu yasağı). Okuma bekleyen kayıtları
   da süpürür → ekranda sonsuza dek "bekliyor" görünmez. */
import {
  readObservationDiagnostics, type ObservationDiagnostics,
} from '../capability/observation/observationLedger';

/** Ekranda gösterilecek TEK katalog satırı — **PII TAŞIMAZ**. */
export interface CatalogRowSource {
  readonly capabilityId: string;
  readonly operation: string;
  readonly domain: string;
  readonly safetyClass: string;
  readonly requiresConfirmation: boolean;
  readonly observationCeiling: string;
  readonly exposedToBrain: boolean;
  readonly legacyIntent: string | null;
  /** `capabilityRegistry`den okunan CANLI availability kanıtı. */
  readonly availability: string;
  /** Availability kanıtı istenen registry kimlikleri (boş = kanıt istenmiyor). */
  readonly requiredCapabilities: readonly string[];
}

export interface CapabilityFabricSources {
  readonly diagnostics: CapabilityFabricDiagnostics | null;
  /** MAVI-F7 · gözlem/uzlaştırma tanısı (okunamazsa `null`). */
  readonly observation: ObservationDiagnostics | null;
  readonly enforcing: boolean | null;
  readonly rows: readonly CatalogRowSource[] | null;
  readonly integrity: CatalogIntegrityReport | null;
  readonly brainIntentCount: number | null;
}

export function readCapabilityFabricSources(): CapabilityFabricSources {
  let diagnostics: CapabilityFabricDiagnostics | null = null;
  try { diagnostics = getCapabilityFabricDiagnostics(); } catch { diagnostics = null; }

  let observation: ObservationDiagnostics | null = null;
  try { observation = readObservationDiagnostics(Date.now()); } catch { observation = null; }

  let enforcing: boolean | null = null;
  try { enforcing = isCapabilityFabricEnforcing(); } catch { enforcing = null; }

  let rows: readonly CatalogRowSource[] | null = null;
  try {
    rows = Object.freeze(CAROS_CAPABILITY_CATALOG.map((d) => Object.freeze({
      capabilityId: d.capabilityId,
      operation: d.operation,
      domain: d.domain as string,
      safetyClass: d.safetyClass as string,
      requiresConfirmation: d.requiresConfirmation,
      observationCeiling: d.observationCeiling as string,
      exposedToBrain: d.exposedToBrain,
      legacyIntent: d.legacyIntent,
      /* CANLI okuma — katalog sabiti DEĞİL. Registry kanıt toplamamışsa
         `UNKNOWN` görünür ve bu bir kusur değil, dürüst bir bildirimdir. */
      availability: readAvailability(d) as string,
      requiredCapabilities: d.requiredCapabilities,
    })));
  } catch { rows = null; }

  let integrity: CatalogIntegrityReport | null = null;
  try { integrity = inspectCatalogIntegrity(); } catch { integrity = null; }

  let brainIntentCount: number | null = null;
  try { brainIntentCount = brainExposedIntents().length; } catch { brainIntentCount = null; }

  return Object.freeze({ diagnostics, observation, enforcing, rows, integrity, brainIntentCount });
}
