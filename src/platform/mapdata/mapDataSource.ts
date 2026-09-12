/**
 * mapDataSource.ts — MAP DATA PLATFORM · F0 · KAYNAK SÖZLÜĞÜ (SAF).
 *
 * SAF: I/O YOK · timer YOK · ağ YOK · global durum YOK · React YOK ·
 * `Date.now`/`performance.now` YOK. Zaman DIŞARIDAN gelir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE İŞE YARAR ──────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu paket L1 `MapStore`'un **ALTINDA** çalışan veri üretim/normalizasyon
 * katmanının sözleşmeleridir. Ham veri sağlayıcıları (OSM · Overture ·
 * OpenFreeMap · kamu/belediye açık verisi · gelecekte lisanslı sağlayıcılar)
 * burada normalize edilir, kökeni ve lisansı taşınır, sonra canonical çözüme
 * girer. L1 ve üstü katmanlar bu paketi DEĞİL, yalnız canonical çıktıyı görür.
 *
 * ── İKİNCİ OTORİTE DEĞİLDİR (bağlayıcı) ───────────────────────────────────
 *  · Kanıt sınıfı sözlüğü ÜRETMEZ — `navEvidence.EvidenceGrade` kullanılır.
 *  · `mapProvenance.MapSourceMask` ile KARIŞTIRILMAZ. Maske "veri hangi FİZİKSEL
 *    düzlemden geldi?" sorusunu yanıtlar (paketlenmiş graf · çevrimiçi karo ·
 *    cihaz önbelleği). `MapDataSourceId` bambaşka bir soruyu yanıtlar:
 *    **"veriyi kim ÜRETTİ?"** (OSM · Overture · belediye). Aynı fiziksel karo
 *    farklı üreticilerden beslenebilir; aynı üretici farklı düzlemlerden
 *    taşınabilir. İki eksen birbirinin yerine geçmez.
 *  · Rota/karo/POI çalışma zamanı davranışını DEĞİŞTİRMEZ — yalnız veri üretim
 *    hattının tipleridir.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) KAYNAK KİMLİĞİ — "veriyi kim üretti"
   ══════════════════════════════════════════════════════════════════════════ */

export type MapDataSourceId =
  /** OpenStreetMap upstream (ana API / planet türevi). */
  | 'OSM'
  /** OSM türevi vektör karo sağlayıcısı — bugünkü üretim karosu. */
  | 'OPENFREEMAP'
  /** Overture Maps Foundation sürümlü veri kümesi. */
  | 'OVERTURE'
  /** Türkiye Ulusal Coğrafi Bilgi Sistemi / kamu açık veri servisleri. */
  | 'TUCBS'
  /** Belediye açık verisi (kaynak başına ayrı lisans kaydı gerektirir). */
  | 'MUNICIPALITY'
  /** Gelecekte sözleşmeyle bağlanacak ticari sağlayıcı (bugün BAĞLI DEĞİL). */
  | 'LICENSED_PROVIDER'
  /** CarOS'un kendi cihaz/saha gözlemi. */
  | 'FIELD_OBSERVATION'
  /** Yalnız başka gözlemlerden türetilmiş (kendi ham kaynağı yok). */
  | 'DERIVED';

export const MAP_DATA_SOURCE_IDS: readonly MapDataSourceId[] = [
  'OSM', 'OPENFREEMAP', 'OVERTURE', 'TUCBS', 'MUNICIPALITY',
  'LICENSED_PROVIDER', 'FIELD_OBSERVATION', 'DERIVED',
] as const;

export function isMapDataSourceId(v: unknown): v is MapDataSourceId {
  return typeof v === 'string' && (MAP_DATA_SOURCE_IDS as readonly string[]).includes(v);
}

/* ══════════════════════════════════════════════════════════════════════════
   2) NESNE TÜRÜ VE ALANLARI — alan düzeyinde çözüm için
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Gerçek dünya nesne türü. Dört çözücü (resolver) bu dört tür üzerinedir:
 * Building · Road · Address · Place.
 */
export type MapFeatureKind = 'BUILDING' | 'ROAD' | 'ADDRESS' | 'PLACE';

export const MAP_FEATURE_KINDS: readonly MapFeatureKind[] = [
  'BUILDING', 'ROAD', 'ADDRESS', 'PLACE',
] as const;

/**
 * Çözümün ALAN düzeyinde yapıldığı öznitelikler. **Kritik:** aynı nesnenin
 * geometrisi bir kaynaktan, adı başka bir kaynaktan otoriter olabilir
 * (Tarsus ölçümü: geometri OSM'de VAR, ad YOK). Bu yüzden çözüm nesne
 * düzeyinde "kazanan kaynak" seçmez; her alanı ayrı çözer.
 */
export type MapFeatureField =
  | 'geometry'
  | 'name'
  | 'height'
  | 'levels'
  | 'housenumber'
  | 'street'
  | 'postcode'
  | 'roadClass'
  | 'oneway'
  | 'speedLimit'
  | 'category';

export const MAP_FEATURE_FIELDS: readonly MapFeatureField[] = [
  'geometry', 'name', 'height', 'levels', 'housenumber', 'street',
  'postcode', 'roadClass', 'oneway', 'speedLimit', 'category',
] as const;

/** Bir tür için ANLAMLI alanlar. Tanımsız alan çözüme ALINMAZ (fail-closed). */
export const FIELDS_BY_KIND: Readonly<Record<MapFeatureKind, readonly MapFeatureField[]>> = {
  BUILDING: ['geometry', 'name', 'height', 'levels', 'housenumber', 'street', 'postcode'],
  ROAD: ['geometry', 'name', 'roadClass', 'oneway', 'speedLimit'],
  ADDRESS: ['geometry', 'housenumber', 'street', 'postcode'],
  PLACE: ['geometry', 'name', 'category', 'housenumber', 'street'],
} as const;

export function fieldAppliesToKind(kind: MapFeatureKind, field: MapFeatureField): boolean {
  const list = FIELDS_BY_KIND[kind];
  return Array.isArray(list) && list.includes(field);
}

/* ══════════════════════════════════════════════════════════════════════════
   3) VERİ KÜMESİ SÜRÜMÜ — "hangi paketten geldi"
   ══════════════════════════════════════════════════════════════════════════ */

/** Mutlak (duvar saati) epoch ms. Monotonik zamandan BİLİNÇLİ olarak ayrıdır. */
export type EpochMs = number;

/**
 * Bir kaynağın SÜRÜMLÜ anlık görüntüsü. Ölçüm tekrar üretilebilir olmalı:
 * "Overture dedi" yetmez, HANGİ sürüm dediği yazılır.
 */
export interface MapDatasetRelease {
  readonly sourceId: MapDataSourceId;
  /** Sağlayıcının kendi sürüm etiketi (`2026-08-19.0`, `20260830_080001_pt`…). */
  readonly releaseId: string;
  /**
   * Sürümün yayın anı (epoch ms). `null` = BİLİNMİYOR — bugünün tarihi
   * varsayılmaz, tazelik hesaplanmaz.
   */
  readonly publishedAtEpochMs: EpochMs | null;
  /**
   * Verinin gerçek dünya kesim anı (replication cut-off). Yayın anından
   * ÖNCEDİR ve çoğu sağlayıcıda ilan edilmez → `null` yaygın ve dürüst.
   */
  readonly dataCutoffEpochMs: EpochMs | null;
  /** Ölçümün alındığı adres (kanıt izlenebilirliği). Boş string YASAK. */
  readonly retrievedFrom: string | null;
}

/** Hiç ölçülmemiş sürüm — fail-closed varsayılan. */
export function unknownRelease(sourceId: MapDataSourceId): MapDatasetRelease {
  return {
    sourceId,
    releaseId: 'UNKNOWN',
    publishedAtEpochMs: null,
    dataCutoffEpochMs: null,
    retrievedFrom: null,
  };
}

export function isReleaseIdentified(r: MapDatasetRelease | null | undefined): boolean {
  return !!r && typeof r.releaseId === 'string'
    && r.releaseId.length > 0 && r.releaseId !== 'UNKNOWN';
}
