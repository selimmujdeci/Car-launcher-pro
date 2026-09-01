/**
 * cddlInventorySources.ts — CDDL ENVANTERİ'nin TEK okuma noktası (P0-VDK-F3B).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. Araca/adaptöre tek bayt GİTMEZ.
 *  · Hiçbir profil YÜKLEMEZ/DEĞİŞTİRMEZ; mevcut kayıtları OKUR.
 *  · Her okuma try/catch içinde; kaynak patlarsa `null` → alan KAYNAK YOK.
 *  · Yeni store/singleton/registry KURULMAZ.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 *  VIN taşınmaz: `VariantPattern` kanıtı WMI (üretici öneki) ve VDS DESENİ
 *  içerir — ikisi de araca özgü değil, MODELE özgüdür. Ham VIN bu katmandan
 *  DIŞARI ÇIKMAZ.
 */

import {
  cddlDocumentFromLegacy, builtinServiceDefs,
} from '../obd/cddl/legacyAdapter';
import { validateCddlDocument } from '../obd/cddl/validate';
import { OEM_ECU_PROFILES, getProductOemProfiles } from '../obd/oem/oemProfileRegistry';
import { CDDL_SCHEMA_VERSION } from '../obd/cddl/schema';
import type { CddlIssue } from '../obd/cddl/validate';
import type { CddlSource } from '../obd/cddl/schema';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch { return null; }
}

/** Bir tanım türünün envanter özeti. */
export interface CddlKindCount {
  readonly kind: string;
  readonly count: number;
}

export interface CddlInventorySnapshot {
  readonly schemaVersion: string | null;
  /** Belge kurulabildi mi — kurulamadıysa TÜM sayaçlar `null` (sahte 0 YOK). */
  readonly documentBuilt: boolean;
  readonly counts: readonly CddlKindCount[] | null;
  /** Doğrulama geçti mi; `null` = doğrulama hiç çalışmadı. */
  readonly valid: boolean | null;
  /** İlk 8 doğrulama kusuru — sessiz eleme YOK. */
  readonly issues: readonly CddlIssue[] | null;
  /** Kaynak güven sınıfı dağılımı (builtin/learned/byod). */
  readonly sourceCounts: Readonly<Partial<Record<CddlSource, number>>> | null;
  /** Legacy profil sayısı ve ürün kapısından geçen sayı — kapı GEVŞEDİ mi. */
  readonly legacyProfileCount: number | null;
  readonly productEligibleCount: number | null;
  /** Servis beyaz listesindeki servis baytları. */
  readonly serviceBytes: readonly string[] | null;
}

const EMPTY: CddlInventorySnapshot = Object.freeze({
  schemaVersion: null, documentBuilt: false, counts: null, valid: null,
  issues: null, sourceCounts: null, legacyProfileCount: null,
  productEligibleCount: null, serviceBytes: null,
});

/**
 * Tek seferlik senkron okuma.
 *
 * Belge her çağrıda MEVCUT legacy kayıtlardan yeniden kurulur — CDDL'in ayrı
 * bir deposu YOKTUR ve olmaması bilinçlidir: iki yerde tutulan bir envanter,
 * birinin sessizce eskimesi demektir.
 */
export function readCddlInventorySnapshot(): CddlInventorySnapshot {
  const doc = _safe(() => cddlDocumentFromLegacy({
    documentId: 'legacy-bridge', oemProfiles: OEM_ECU_PROFILES,
  }));
  if (doc === null) return EMPTY;

  const validation = _safe(() => validateCddlDocument(doc));
  const sourceCounts: Partial<Record<CddlSource, number>> = {};
  try {
    const all = [
      ...doc.services.map((s) => s.provenance.source),
      ...doc.variants.map((v) => v.provenance.source),
      ...doc.patterns.map((p) => p.provenance.source),
      ...doc.dataObjects.map((o) => o.provenance.source),
    ];
    for (const s of all) sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
  } catch { /* fail-soft */ }

  return Object.freeze({
    schemaVersion: doc.schemaVersion,
    documentBuilt: true,
    counts: Object.freeze([
      { kind: 'ServiceDef', count: doc.services.length },
      { kind: 'EcuVariant', count: doc.variants.length },
      { kind: 'VariantPattern', count: doc.patterns.length },
      { kind: 'DataObjectProp', count: doc.dataObjects.length },
      { kind: 'ComParam', count: doc.comParams.length },
      { kind: 'ProcedureDef', count: doc.procedures.length },
      { kind: 'DtcCatalogEntry', count: doc.dtcCatalog.length },
    ]),
    valid: validation === null ? null : validation.valid,
    issues: validation === null || validation.valid ? [] : validation.issues.slice(0, 8),
    sourceCounts,
    legacyProfileCount: OEM_ECU_PROFILES.length,
    productEligibleCount: _safe(() => getProductOemProfiles(OEM_ECU_PROFILES).length),
    serviceBytes: _safe(() => builtinServiceDefs().map((s) => s.service)),
  });
}

export { CDDL_SCHEMA_VERSION };
