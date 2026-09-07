/**
 * mapDataLabModel.ts — CAROS LAB · Harita Veri Platformu · SAF MODEL.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK ·
 * ağ YOK. Yalnız `mapDataSources` anlık görüntüsünden alan/hüküm türetir.
 *
 * ── İKİNCİ OTORİTE DEĞİLDİR (bağlayıcı) ───────────────────────────────────
 * Burada hesaplanan hiçbir değer üretim kararına GERİ BESLENMEZ. Lisans
 * hükmü `mapDataLicense` kapısından, fusion politikası `mapDataResolution`
 * ve `buildingResolver` sabitlerinden AYNEN okunur; LAB kendi eşiğini,
 * kendi hakkını veya kendi sağlık kararını ÜRETMEZ.
 *
 * Gözlemlenebilirlik sınıflandırması `sessionInspectorModel.Observability`
 * sözlüğünü KULLANIR — paralel sözlük kurulmaz.
 */

import type { InspectorField, Observability } from './sessionInspectorModel';
import type {
  MapDataRawSnapshot, MapDataPortRow, MapDataSourceRow,
} from './mapDataSources';

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Platformun bütünsel hükmü.
 *
 *  · `CONTRACTS_ONLY`   — sözleşmeler kurulu, HİÇBİR sağlayıcı bağlı değil.
 *                         **Bugünkü doğru hâl budur ve bir arıza DEĞİLDİR.**
 *  · `PARTIALLY_BOUND`  — bazı portlara sağlayıcı bağlanmış.
 *  · `FULLY_BOUND`      — üç portun üçü de bağlı.
 *  · `UNAVAILABLE`      — okuma yapılamadı (gerçek arıza).
 */
export type MapDataLabVerdict =
  | 'CONTRACTS_ONLY' | 'PARTIALLY_BOUND' | 'FULLY_BOUND' | 'UNAVAILABLE';

export const MAP_DATA_LAB_VERDICT_LABEL: Readonly<Record<MapDataLabVerdict, string>> = {
  CONTRACTS_ONLY: 'YALNIZ SÖZLEŞME — sağlayıcı bağlı değil',
  PARTIALLY_BOUND: 'KISMEN BAĞLI',
  FULLY_BOUND: 'TÜM PORTLAR BAĞLI',
  UNAVAILABLE: 'OKUNAMADI',
};

export function deriveMapDataVerdict(snap: MapDataRawSnapshot | null | undefined): MapDataLabVerdict {
  if (!snap || !snap.readOk) return 'UNAVAILABLE';
  const ports = snap.ports ?? [];
  if (ports.length === 0) return 'UNAVAILABLE';
  const bound = ports.filter((p) => p.bound).length;
  if (bound === 0) return 'CONTRACTS_ONLY';
  if (bound === ports.length) return 'FULLY_BOUND';
  return 'PARTIALLY_BOUND';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) LİSANS ÖZETİ — offline paket kapısı ürün kararıdır
   ══════════════════════════════════════════════════════════════════════════ */

export interface LicenseSummary {
  /** Offline pakete girebilen kaynak sayısı. */
  readonly offlineAllowed: number;
  /** Offline pakette REDDEDİLEN kaynak sayısı (çoğu için doğru hâl budur). */
  readonly offlineDenied: number;
  /** Share-alike yükümlülüğü taşıyan kaynak sayısı. */
  readonly shareAlike: number;
  /** Atıf ZORUNLU ama metni BİLİNMEYEN kaynak sayısı — bu bir RİSKTİR. */
  readonly attributionMissing: number;
}

export function summarizeLicenses(
  sources: readonly MapDataSourceRow[] | null | undefined,
): LicenseSummary {
  const rows = sources ?? [];
  let offlineAllowed = 0, offlineDenied = 0, shareAlike = 0, attributionMissing = 0;
  for (const r of rows) {
    const v = r.gates?.OFFLINE_PACKAGING;
    if (v === 'DENY') offlineDenied += 1;
    else if (v === 'ALLOW' || v === 'ALLOW_WITH_ATTRIBUTION') offlineAllowed += 1;
    if (r.shareAlike) shareAlike += 1;
    if (r.attributionRequired && !r.hasAttributionText) attributionMissing += 1;
  }
  return { offlineAllowed, offlineDenied, shareAlike, attributionMissing };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ALANLAR — `InspectorField` sözleşmesi
   ══════════════════════════════════════════════════════════════════════════ */

const SRC = 'platform/mapdata (sözleşme katmanı)';

function field(
  id: string, label: string, value: string | null, klass: Observability, note: string,
  source = SRC,
): InspectorField {
  return {
    id, label,
    value: value === null || value === '' ? '—' : value,
    klass, source,
    /* Sözleşme katmanının duvar-saati damgası YOKTUR: değerler kod
       sabitleridir, bir ölçümün yaşı değildir. Sahte damga üretilmez. */
    updatedAt: null,
    note,
  };
}

function ms(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  const days = v / (24 * 60 * 60 * 1000);
  if (days >= 1) return `${Number(days.toFixed(1))} gün`;
  const minutes = v / 60000;
  return `${Number(minutes.toFixed(1))} dk`;
}

export function buildMapDataFields(
  snap: MapDataRawSnapshot | null | undefined,
): readonly InspectorField[] {
  if (!snap || !snap.readOk) {
    return [field('read', 'Okuma', null, 'UNAVAILABLE',
      'Sözleşme katmanı okunamadı — bu gerçek bir arızadır.')];
  }

  const lic = summarizeLicenses(snap.sources);
  const bound = (snap.ports ?? []).filter((p) => p.bound).length;
  const out: InspectorField[] = [];

  out.push(field('sourceCount', 'Tanımlı kaynak', String(snap.sources.length), 'OBSERVED',
    'Kaynak sözlüğü kod sabitidir; kaynağın VERİSİ olduğu anlamına GELMEZ.'));

  out.push(field('boundProviders', 'Bağlı sağlayıcı', `${bound}/${(snap.ports ?? []).length}`,
    bound === 0 ? 'UNAVAILABLE' : 'OBSERVED',
    bound === 0
      ? 'Bugün hiçbir porta sağlayıcı BAĞLI DEĞİL — bu beyandır, arıza değil.'
      : 'En az bir port bağlı; kapsam ve lisans ayrıca doğrulanmalıdır.'));

  out.push(field('offlineAllowed', 'Offline pakete girebilen kaynak',
    `${lic.offlineAllowed} / ${snap.sources.length}`, 'DERIVED',
    'Lisans kapısı GERÇEKTEN çalıştırıldı (evaluateLicenseGate); sabit metin değil.'));

  out.push(field('offlineDenied', 'Offline pakette REDDEDİLEN',
    String(lic.offlineDenied), lic.offlineDenied > 0 ? 'DERIVED' : 'OBSERVED',
    'RED çoğu kaynak için DOĞRU hâldir: hak kanıtlanmadıysa fail-closed.'));

  out.push(field('shareAlike', 'Share-alike yükümlülüğü olan kaynak',
    String(lic.shareAlike), 'DERIVED',
    'ODbL türevleri: dağıtılan VERİ paketi aynı lisansla yayımlanmalıdır (uygulama kodu etkilenmez).'));

  out.push(field('attributionRisk', 'Atıf zorunlu ama metni BİLİNMEYEN',
    String(lic.attributionMissing),
    lic.attributionMissing > 0 ? 'DERIVED' : 'OBSERVED',
    'Bu sayı 0 değilse ilgili kaynak üretim niyetlerinde ZATEN reddedilir.'));

  const f = snap.fusion;
  out.push(field('fusionWeights', 'Fusion ağırlıkları (tazelik/mutabakat/kalite/yetki)',
    f ? `${f.weightFreshness} · ${f.weightAgreement} · ${f.weightQuality} · ${f.weightAuthority}` : null,
    f ? 'OBSERVED' : 'UNAVAILABLE',
    'Dördü eşittir: yetki önseli TEK BAŞINA karar vermez (sabit öncelik listesi yasağı).'));

  out.push(field('buildingMatch', 'Bina eşleştirme (merkez mesafesi · alan oranı · içerme)',
    f ? `${f.buildingMaxCentroidDistanceM} m · ${f.buildingMinAreaRatio} · ${f.buildingRequireContainment ? 'ZORUNLU' : 'opsiyonel'}` : null,
    f ? 'OBSERVED' : 'UNAVAILABLE',
    'Gerçek poligon kesişimi HESAPLANMAZ; üç ölçülebilir kanıt taşınır.'));

  out.push(field('spdxKnown', 'Tanınan lisans etiketi',
    snap.recognizedSpdxLabels.length > 0 ? snap.recognizedSpdxLabels.join(' · ') : null,
    'OBSERVED',
    'Listede OLMAYAN etiket UNKNOWN sayılır ve kapıdan geçemez (fail-closed).'));

  const traffic = (snap.liveBudgets ?? []).find((b) => b.kind === 'TRAFFIC_SPEED');
  out.push(field('liveBudget', 'Canlı trafik tazelik bütçesi',
    traffic ? ms(traffic.budgetMs) : null,
    traffic ? 'OBSERVED' : 'UNAVAILABLE',
    'Bayat canlı veri STALE değil UNAVAILABLE olur — yanlış karar ürettirmez.'));

  out.push(field('readErrors', 'Okuma hatası', String(snap.readErrors),
    snap.readErrors > 0 ? 'STALE' : 'OBSERVED',
    '0 değilse bazı alanlar eksik okunmuştur; gösterilen değerler kısmidir.'));

  return out;
}

function countRows(rows: readonly { value: string; count: number }[]): string | null {
  return rows.length > 0 ? rows.map((r) => `${r.value}:${r.count}`).join(' · ') : null;
}

/** Gap Detector'ın kanonik salt-okunur projeksiyonunu UI alanlarına çevirir. */
export function buildBuildingGapFields(
  snap: MapDataRawSnapshot | null | undefined,
): readonly InspectorField[] {
  const gaps = snap?.buildingGaps;
  const available = gaps?.availability === 'OBSERVED';
  return [
    field('gap-total', 'PotentialBuildingGap toplamı', available ? String(gaps.total) : null,
      available ? 'OBSERVED' : 'UNAVAILABLE',
      available ? 'BuildingGapDetector çıktısının sayımıdır.' : 'Gap evidence akışı bağlı değil; 0 UYDURULMAZ.',
      'BuildingGapDetector'),
    field('gap-source', 'Kaynak', available ? countRows(gaps.sources) : null,
      available ? 'OBSERVED' : 'UNAVAILABLE', 'Kaynak kimliği doğrudan gap provenance içinden okunur.',
      'BuildingGapDetector'),
    field('gap-source-family', 'Kalite ailesi', available ? countRows(gaps.sourceFamilies) : null,
      available ? 'OBSERVED' : 'UNAVAILABLE', 'Provenance sınıfı doğrudan gap evidence içinden okunur.',
      'BuildingGapDetector'),
    field('gap-reasons', 'Reason dağılımı', available ? countRows(gaps.reasons) : null,
      available ? 'DERIVED' : 'UNAVAILABLE', 'Yeni gap hükmü üretilmez; mevcut reason değerleri sayılır.',
      'BuildingGapDetector'),
    field('gap-grade', 'Evidence sınıfı', available ? countRows(gaps.evidenceGrades) : null,
      available ? 'OBSERVED' : 'UNAVAILABLE', 'Mevcut EvidenceGrade sözlüğü kullanılır.',
      'BuildingGapDetector'),
    field('gap-confidence', 'Confidence', available
      ? `${gaps.confidenceKnown}/${gaps.total} bilinen · medyan ${gaps.medianConfidence === null
        ? 'UNKNOWN' : gaps.medianConfidence.toFixed(2)}` : null,
      available ? 'OBSERVED' : 'UNAVAILABLE', 'Kaynak confidence vermediyse UNKNOWN kalır.',
      'BuildingGapDetector'),
    field('gap-release-freshness', 'Dataset release / freshness', available
      ? `${countRows(gaps.releases) ?? 'UNKNOWN'} · ${countRows(gaps.freshness) ?? 'UNKNOWN'}` : null,
    available ? 'OBSERVED' : 'UNAVAILABLE', 'Release ve freshness gap provenance içinden gelir.',
    'BuildingGapDetector'),
    field('gap-distance', 'Canonical mesafe medyanı', available && gaps.medianDistanceM !== null
      ? `${gaps.medianDistanceM.toFixed(1)} m (${gaps.distanceMeasured}/${gaps.total})` : null,
    available && gaps.medianDistanceM !== null ? 'DERIVED' : 'UNAVAILABLE',
    'Yalnız ölçülebilen centroid mesafeleri özetlenir.', 'BuildingGapDetector'),
    field('gap-overlap', 'Overlap / containment', available
      ? `${gaps.overlapMeasured}/${gaps.total} ölçüldü · containment ${gaps.withContainment ?? 0}`
        + ` · medyan alan oranı ${gaps.medianAreaRatio === null ? 'UNKNOWN' : gaps.medianAreaRatio.toFixed(2)}` : null,
    available ? 'DERIVED' : 'UNAVAILABLE', 'Kanonik overlap kanıtının salt-okunur sayımıdır.',
    'BuildingGapDetector'),
    field('gap-license', 'Offline lisans eligibility', available ? countRows(gaps.licenseEligibility) : null,
      available ? 'DERIVED' : 'UNAVAILABLE', 'Mevcut mapDataLicense kapısı her kayıt için çalıştırılır.',
      'mapDataLicense'),
    field('gap-publishable', 'Publishable building', 'FALSE', 'OBSERVED',
      'GAP EVIDENCE ≠ MAP TRUTH. MapStore/renderer/routing/CEH için bina değildir.',
      'BuildingGapDetector contract'),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   4) PORT AÇIKLAMALARI — "neden bağlı değil" sorusunun ölçülmüş cevabı
   ══════════════════════════════════════════════════════════════════════════ */

export const PORT_LABEL: Readonly<Record<MapDataPortRow['portId'], string>> = {
  ADDRESS_INDEX: 'Adres index',
  PLACE_INDEX: 'Yer/POI index',
  LIVE_ROAD_CONDITIONS: 'Canlı yol koşulu',
};

/**
 * Portun bağlı OLMAMA gerekçesi — uydurma değil, ölçüme dayalı.
 * Ölçüm kaynağı: `field-runs/mapdata-shootout-20260907/REPORT.md`.
 */
export const PORT_UNBOUND_REASON: Readonly<Record<MapDataPortRow['portId'], string>> = {
  ADDRESS_INDEX:
    'Kaynak YOK: Overture addresses teması Tarsus bbox\'ında 0 kayıt döndürdü; '
    + 'render karosu adres veritabanı değildir (merkez karoda 7 housenumber).',
  PLACE_INDEX:
    'Kaynak VAR (Overture places 337 kayıt, permissive lisans) ama arama zinciri '
    + 'ayrı bir domaindir; canonical index kurulmadan bağlanmaz.',
  LIVE_ROAD_CONDITIONS:
    'Lisanslı sağlayıcı BAĞLANMADI (bilinçli). Sağlayıcı yokken statik '
    + 'navigasyon tam çalışır — canlı koşul zenginleştirmedir, bağımlılık değil.',
};

/** Ekranın üst satırı için tek cümlelik dürüst özet. */
export function mapDataHeadline(verdict: MapDataLabVerdict, snap: MapDataRawSnapshot | null): string {
  if (verdict === 'UNAVAILABLE') return 'Sözleşme katmanı okunamadı.';
  const n = snap?.sources.length ?? 0;
  if (verdict === 'CONTRACTS_ONLY') {
    return `${n} kaynak TANIMLI · sağlayıcı BAĞLI DEĞİL · üretim davranışı etkilenmiyor.`;
  }
  return `${n} kaynak tanımlı; en az bir sağlayıcı bağlı — kapsam ve lisans ayrıca doğrulanmalı.`;
}
