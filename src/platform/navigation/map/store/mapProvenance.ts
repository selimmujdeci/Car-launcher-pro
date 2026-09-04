/**
 * mapProvenance.ts — NAV v3 · L1 · HARİTA KÖKEN MASKESİ (SAF · F1).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F1/4 · v2 §2.4 (`srcMask`).
 *
 * SAF: I/O YOK · timer YOK · global durum YOK · React YOK · saat YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KÖKEN MASKESİ ≠ KANIT SINIFI (bağlayıcı ayrım) ────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `EvidenceGrade` (F0) şu soruyu yanıtlar: **"bu değere ne kadar güvenilir?"**
 * (`OBSERVED · DERIVED · UNAVAILABLE · STALE`).
 *
 * `MapSourceMask` bambaşka bir soruyu yanıtlar: **"bu değer HANGİ fiziksel
 * kaynaklardan geldi?"** — ve bir değer AYNI ANDA birden çok kaynaktan
 * beslenebilir (paketlenmiş graf + çevrimiçi karo gibi). Bu yüzden bitset'tir.
 *
 * **İKİNCİ KANIT SİSTEMİ DEĞİLDİR.** `EvidenceGrade` kopyalanmaz, sarılmaz,
 * yeniden adlandırılmaz. Maske `Evidenced<T>` ile BİRLİKTE taşınır
 * (`MapDatasetStatus.provenance`), onun YERİNE geçmez. Kilit test bu ayrımı
 * denetler (`navV3MapStoreF1.test.ts` → "köken maskesi kanıt sınıfını
 * KOPYALAMAZ").
 */

/**
 * Harita köken bitleri. Değerler 2'nin kuvvetidir ve **DEĞİŞMEZ** (kalıcı
 * kayıtlara ve LAB'a yazılabilir); yeni kaynak eklenirse yeni bit alınır.
 */
export const MAP_SRC = {
  /** Cihaza paketlenmiş yol ağı grafiği (`/maps/routing-graph.bin`). */
  PACKAGED_GRAPH: 1 << 0,
  /** Cihaza paketlenmiş POI veritabanı (`/maps/poi.db`). */
  PACKAGED_POI: 1 << 1,
  /** Cihaza paketlenmiş / yerel karo dosyaları (`/maps/{z}/{x}/{y}`). */
  PACKAGED_TILES: 1 << 2,
  /** Cihaz önbelleğinde tutulan karo (service worker / Cache API). */
  DEVICE_CACHE: 1 << 3,
  /** Çevrimiçi karo sağlayıcısı. */
  ONLINE_TILES: 1 << 4,
  /** Çevrimiçi rota sağlayıcısı (OSRM vb.). */
  ONLINE_ROUTE_PROVIDER: 1 << 5,
  /** Yerel native rota daemon'u. */
  LOCAL_ROUTE_DAEMON: 1 << 6,
  /** Yalnız geometriden türetilmiş (kendi ham kaynağı yok). */
  DERIVED_GEOMETRY: 1 << 7,
} as const;

export type MapSourceBit = (typeof MAP_SRC)[keyof typeof MAP_SRC];

/** Köken maskesi — sıfır = "hiçbir kaynak bilinmiyor" (fail-closed). */
export type MapSourceMask = number;

export const MAP_SRC_NONE: MapSourceMask = 0;

/** Tanımlı tüm bitlerin birleşimi — bilinmeyen bit tespiti için. */
export const MAP_SRC_ALL: MapSourceMask =
  Object.values(MAP_SRC).reduce((acc, b) => acc | b, 0);

export const MAP_SRC_LABEL: Readonly<Record<MapSourceBit, string>> = {
  [MAP_SRC.PACKAGED_GRAPH]: 'paketlenmiş graf',
  [MAP_SRC.PACKAGED_POI]: 'paketlenmiş POI',
  [MAP_SRC.PACKAGED_TILES]: 'yerel karo',
  [MAP_SRC.DEVICE_CACHE]: 'cihaz önbelleği',
  [MAP_SRC.ONLINE_TILES]: 'çevrimiçi karo',
  [MAP_SRC.ONLINE_ROUTE_PROVIDER]: 'çevrimiçi rota sağlayıcı',
  [MAP_SRC.LOCAL_ROUTE_DAEMON]: 'yerel rota daemon',
  [MAP_SRC.DERIVED_GEOMETRY]: 'türetilmiş geometri',
} as const;

/* ── Saf yardımcılar ────────────────────────────────────────────────────── */

/** Maske geçerli mi (sonlu, negatif olmayan tam sayı, bilinmeyen bit yok). */
export function isValidMask(mask: unknown): mask is MapSourceMask {
  return typeof mask === 'number' && Number.isInteger(mask)
    && mask >= 0 && (mask & ~MAP_SRC_ALL) === 0;
}

/** Maske bu kaynağı içeriyor mu. Geçersiz maske → `false` (fail-closed). */
export function hasSource(mask: MapSourceMask, bit: MapSourceBit): boolean {
  if (!isValidMask(mask)) return false;
  return (mask & bit) === bit;
}

/** Kaynak ekler (saf — yeni maske döner). Geçersiz girdi → `MAP_SRC_NONE`. */
export function addSource(mask: MapSourceMask, bit: MapSourceBit): MapSourceMask {
  if (!isValidMask(mask) || !isValidMask(bit)) return MAP_SRC_NONE;
  return (mask | bit) >>> 0;
}

/** İki maskeyi birleştirir. Geçersiz taraf → `MAP_SRC_NONE`. */
export function mergeMasks(a: MapSourceMask, b: MapSourceMask): MapSourceMask {
  if (!isValidMask(a) || !isValidMask(b)) return MAP_SRC_NONE;
  return (a | b) >>> 0;
}

/** Maskede hiç kaynak yok mu — "köken bilinmiyor" hâli. */
export function isUnknownProvenance(mask: MapSourceMask): boolean {
  return !isValidMask(mask) || mask === MAP_SRC_NONE;
}

/**
 * Maskenin okunur dökümü (LAB / log). Kaynak yoksa `'KÖKEN BİLİNMİYOR'` —
 * boş metin ya da uydurma kaynak adı ÜRETİLMEZ.
 */
export function describeMask(mask: MapSourceMask): string {
  if (isUnknownProvenance(mask)) return 'KÖKEN BİLİNMİYOR';
  const parts: string[] = [];
  for (const bit of Object.values(MAP_SRC)) {
    if ((mask & bit) === bit) parts.push(MAP_SRC_LABEL[bit]);
  }
  return parts.length > 0 ? parts.join(' + ') : 'KÖKEN BİLİNMİYOR';
}

/** Maskedeki bitleri liste hâlinde döndürür (deterministik sıra). */
export function maskToBits(mask: MapSourceMask): readonly MapSourceBit[] {
  if (!isValidMask(mask)) return [];
  return Object.values(MAP_SRC).filter((bit) => (mask & bit) === bit);
}
