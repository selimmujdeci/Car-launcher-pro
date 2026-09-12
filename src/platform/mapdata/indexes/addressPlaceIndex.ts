/**
 * addressPlaceIndex.ts — MAP DATA PLATFORM · F5 · ADRES/PLACE INDEX DİKİŞİ (SAF).
 *
 * SAF: I/O YOK · ağ YOK · timer YOK · saat YOK · global durum YOK · React YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE OLDUĞU ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu dosya bir **PORT TANIMIDIR**, çalışan bir index DEĞİLDİR. Gelecekte
 * canonical bir adres/place index'i kurulduğunda (Overture places · kamu adres
 * verisi · lisanslı sağlayıcı) o index BU arayüzün arkasına takılır.
 *
 * ── İKİNCİ ARAMA OTORİTESİ DEĞİLDİR (bağlayıcı) ───────────────────────────
 * Ürünün arama gerçeği bugün `geocodingService` · `mapService.searchPlaces` ·
 * `offlinePoiService` zincirindedir ve hükmü `geo/searchChainModel` verir.
 * **Bu port o zinciri ELE GEÇİRMEZ, kopyalamaz, paralel çalıştırmaz.**
 * Farkı katman farkıdır:
 *
 *   · `searchChainModel` → "hangi SAĞLAYICI ne yaptı" (çalışma zamanı hükmü)
 *   · `AddressIndexPort`  → "canonical VERİ KÜMESİ ne biliyor" (veri katmanı)
 *
 * Bir gün canonical index gerçek olursa, arama zincirine **yeni bir aşama**
 * olarak eklenir — zincirin sahibi yine `searchChainModel`dir.
 *
 * ── NEDEN ŞİMDİ (ölçülmüş gerekçe) ────────────────────────────────────────
 * `field-runs/map-data-coverage-20260907` §6 ve `mapdata-shootout-20260907`:
 *   · Üretim karosunun `housenumber` katmanı bir ADRES VERİTABANI DEĞİLDİR:
 *     merkez karoda 7 kayıt vardır ve tam adresin cadde/mahalle/şehir
 *     bileşenleri render karosundan GERİ KURULAMAZ.
 *   · Overture `addresses` teması aynı bbox'ta **0 kayıt** döndürdü.
 *   · Overture `places` teması **337 kayıt** döndürdü ve kayıt lisansları
 *     permissive (CDLA-Permissive-2.0 · CC0-1.0 · Apache-2.0).
 * Yani adres için bugün kaynak YOK, place için VAR ama arama zinciri ayrı bir
 * domaindir. Doğru hamle: **dikişi tanımla, veriyi uydurma.**
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * Bağlı sağlayıcı yoksa sonuç `UNAVAILABLE`dır — boş liste "sonuç yok"
 * ANLAMINA GELMEZ. `NULL_ADDRESS_INDEX`/`NULL_PLACE_INDEX` tam olarak bunu
 * söyler ve varsayılan budur.
 */

import type { EvidenceGrade } from '../../navigation/contracts/navEvidence';
import type { LonLat } from '../mapDataObservation';
import type { MapDataSourceId, MapDatasetRelease } from '../mapDataSource';
import type { LicenseGateResult, MapDataUseIntent } from '../mapDataLicense';
import { evaluateFusionLicenseGate } from '../mapDataLicense';

/* ══════════════════════════════════════════════════════════════════════════
   1) CANONICAL KAYITLAR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Canonical adres. **Her bileşen ayrı ayrı bilinmeyebilir** — tek bir
 * `formatted` string TAŞIMAZ, çünkü birleştirilmiş metin eksik bileşeni
 * gizler ve "No:17" ile "17. Sokak"ı ayırt edilemez hâle getirir
 * (ölçülmüş kusur: audit §6 — ikisi farklı gerçeklerdir).
 */
export interface CanonicalAddress {
  readonly id: string;
  readonly housenumber: string | null;
  readonly street: string | null;
  readonly neighbourhood: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly position: LonLat | null;
  readonly sourceId: MapDataSourceId;
  readonly release: MapDatasetRelease;
}

/** Canonical yer/POI kaydı. Kategori sağlayıcının sözlüğünde kalır. */
export interface CanonicalPlace {
  readonly id: string;
  readonly name: string | null;
  readonly category: string | null;
  readonly position: LonLat | null;
  readonly address: CanonicalAddress | null;
  /** Sağlayıcının ilan ettiği güven [0,1]; bildirmiyorsa `null`. */
  readonly providerConfidence: number | null;
  readonly sourceId: MapDataSourceId;
  readonly release: MapDatasetRelease;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SORGU VE SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export interface AddressQuery {
  /** Serbest metin (opsiyonel — yapılandırılmış alanlarla birlikte kullanılır). */
  readonly text?: string;
  readonly street?: string;
  readonly housenumber?: string;
  readonly city?: string;
  /** Yakınlık yanlılığı — sonuçları sıralamak için, filtre DEĞİL. */
  readonly near?: LonLat;
  readonly limit?: number;
}

export interface PlaceQuery {
  readonly text?: string;
  readonly category?: string;
  readonly near?: LonLat;
  /** Metre cinsinden yarıçap; `undefined` = sağlayıcı varsayılanı. */
  readonly radiusM?: number;
  readonly limit?: number;
}

/** Sonucun neden boş/eksik olduğu. Boş liste tek başına ANLAM TAŞIMAZ. */
export type IndexUnavailableReason =
  /** Hiçbir sağlayıcı bağlı değil — index KURULMADI. */
  | 'NO_PROVIDER'
  /** Sağlayıcı var ama bu bölge için kapsamı yok. */
  | 'NO_COVERAGE'
  /** Lisans kapısı bu kullanım için veriyi engelledi. */
  | 'LICENSE_BLOCKED'
  /** Sağlayıcı hata döndürdü. */
  | 'PROVIDER_ERROR'
  /** Sorgu bu index için anlamlı değil (boş/geçersiz). */
  | 'INVALID_QUERY';

export const INDEX_UNAVAILABLE_REASONS: readonly IndexUnavailableReason[] = [
  'NO_PROVIDER', 'NO_COVERAGE', 'LICENSE_BLOCKED', 'PROVIDER_ERROR', 'INVALID_QUERY',
] as const;

/**
 * Index sonucu. `grade === 'UNAVAILABLE'` iken `items` DAİMA boştur ve
 * `unavailableReason` DAİMA doludur — "boş sonuç" ile "cevap yok" karışmaz.
 */
export interface IndexResult<T> {
  readonly items: readonly T[];
  readonly grade: EvidenceGrade;
  readonly unavailableReason: IndexUnavailableReason | null;
  /** Sonuca katkı veren kaynaklar (atıf ve share-alike için). */
  readonly contributingSources: readonly MapDataSourceId[];
  readonly license: LicenseGateResult;
}

export function unavailableIndexResult<T>(
  reason: IndexUnavailableReason,
  intent: MapDataUseIntent = 'ONLINE_RUNTIME',
): IndexResult<T> {
  return {
    items: [],
    grade: 'UNAVAILABLE',
    unavailableReason: reason,
    contributingSources: [],
    license: evaluateFusionLicenseGate([], intent),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) PORTLAR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Adres index portu. **Senkron değildir** (gerçek index disk/ağ okur) ama
 * bu dosya hiçbir uygulama İÇERMEZ — yalnız sözleşmedir.
 */
export interface AddressIndexPort {
  readonly providerId: MapDataSourceId | null;
  lookup(query: AddressQuery, intent: MapDataUseIntent): Promise<IndexResult<CanonicalAddress>>;
  /** Koordinattan adrese (ters kodlama). */
  reverse(position: LonLat, intent: MapDataUseIntent): Promise<IndexResult<CanonicalAddress>>;
}

export interface PlaceIndexPort {
  readonly providerId: MapDataSourceId | null;
  search(query: PlaceQuery, intent: MapDataUseIntent): Promise<IndexResult<CanonicalPlace>>;
}

/**
 * Varsayılan adres index'i: **bağlı sağlayıcı YOK.**
 * Bu bir eksiklik değil, ölçülmüş gerçeğin beyanıdır — Overture `addresses`
 * teması Tarsus bbox'ında 0 kayıt döndürdü ve render karosu adres veritabanı
 * değildir. Sahte sonuç üretmek yerine yokluğu ilan eder.
 */
export const NULL_ADDRESS_INDEX: AddressIndexPort = {
  providerId: null,
  lookup: async (_q, intent) => unavailableIndexResult<CanonicalAddress>('NO_PROVIDER', intent),
  reverse: async (_p, intent) => unavailableIndexResult<CanonicalAddress>('NO_PROVIDER', intent),
};

export const NULL_PLACE_INDEX: PlaceIndexPort = {
  providerId: null,
  search: async (_q, intent) => unavailableIndexResult<CanonicalPlace>('NO_PROVIDER', intent),
};

/* ══════════════════════════════════════════════════════════════════════════
   4) SAF YARDIMCILAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Sorgu bu index için anlamlı mı — hepsi boşsa sağlayıcı ÇAĞRILMAZ. */
export function isMeaningfulAddressQuery(q: AddressQuery | null | undefined): boolean {
  if (!q) return false;
  const filled = [q.text, q.street, q.housenumber, q.city]
    .some((v) => typeof v === 'string' && v.trim().length > 0);
  return filled || Array.isArray(q.near);
}

export function isMeaningfulPlaceQuery(q: PlaceQuery | null | undefined): boolean {
  if (!q) return false;
  const filled = [q.text, q.category].some((v) => typeof v === 'string' && v.trim().length > 0);
  return filled || Array.isArray(q.near);
}

/**
 * Adres kaydının **karar için yeterli** olup olmadığı: rota kurabilmek için
 * konum ŞARTTIR. Konumsuz adres bir metin parçasıdır, hedef değildir.
 */
export function isRoutableAddress(a: CanonicalAddress | null | undefined): boolean {
  return !!a && Array.isArray(a.position);
}

/**
 * İnsan okunur adres — **eksik bileşen UYDURULMAZ**, yalnız var olanlar
 * birleştirilir. Hiçbir bileşen yoksa `null` (boş string DEĞİL).
 */
export function formatAddress(a: CanonicalAddress | null | undefined): string | null {
  if (!a) return null;
  const line1 = [a.street, a.housenumber].filter((v) => typeof v === 'string' && v.length > 0);
  const line2 = [a.neighbourhood, a.district, a.city].filter((v) => typeof v === 'string' && v.length > 0);
  const parts = [line1.join(' No:'), line2.join(', ')].filter((v) => v.length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}
