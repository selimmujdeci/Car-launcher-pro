/**
 * dtcDataSource — DTC veri kaynağı soyutlaması (büyümeye hazır, bundle-güvenli).
 *
 * NEDEN (PR-DTC-1, Faz 2 iskelesi):
 *   dtcService'in tek DTC çözümleme noktasını (lookupDtc) çoklu kaynağa açar:
 *     (1) paketlenmiş "hot core" — dtcService.DTC_DB (~49 kod), anlık/offline;
 *     (2) ileride LAZY yüklenecek geniş kataloglar (P0 uzun kuyruk, P1/B/C/U).
 *   Lazy kataloglar YALNIZ registerLazyDtcSource + ensureExtendedDtcLoaded çağrılınca
 *   indirilir; aksi halde JS bundle'ına HİÇ girmez → Mali-400 ilk-yükleme bütçesi korunur.
 *
 * DAVRANIŞ SÖZLEŞMESİ:
 *   - resolveDtcRecord SENKRON'dur ve yalnız YÜKLENMİŞ kaynaklara bakar.
 *   - Bu PR hiçbir lazy kaynak KAYIT ETMEZ → mevcut 49 kodun davranışı birebir korunur.
 *   - Yeni AI-teşhis alanları (trDescription/driveSafe/estimatedCost/repairSuggestions/
 *     relatedPids) OPSİYONEL'dir → eski kayıtlar bunları taşımaz, tip bozulmaz.
 *
 * Bu modül React/Capacitor importu içermez (saf, kök vitest paketinden test edilebilir).
 */

/* ── Tipler ──────────────────────────────────────────────── */

export type DTCSeverity = 'critical' | 'warning' | 'info';

/** Sürüşe devam güvenliği — AI teşhis kartı için (severity'den bağımsız somut tavsiye). */
export type DriveSafety = 'safe' | 'caution' | 'unsafe' | 'unknown';

/** Tahmini onarım maliyeti — kaba kademe ve/veya TRY aralığı (ikisi de opsiyonel). */
export interface EstimatedCost {
  tier?:   'low' | 'medium' | 'high';
  minTRY?: number;
  maxTRY?: number;
}

/**
 * Bir DTC kaydının kod-dışı gövdesi. Zorunlu alanlar mevcut 49 kodla birebir uyumlu;
 * opsiyonel alanlar ileride AI teşhis motoru tarafından doldurulacak (Faz 4).
 */
export interface DtcRecord {
  description:        string;
  system:            string;
  severity:          DTCSeverity;
  possibleCauses:    string[];
  // ── AI teşhis genişleme alanları (opsiyonel — default davranışı bozmaz) ──
  /** Uzun/zengin Türkçe açıklama (kısa `description`'a ek). */
  trDescription?:    string;
  /** Sürüşe devam edilir mi? */
  driveSafe?:        DriveSafety;
  /** Tahmini onarım maliyeti. */
  estimatedCost?:    EstimatedCost;
  /** Somut çözüm önerileri (possibleCauses'tan ayrı — "ne yapılmalı"). */
  repairSuggestions?: string[];
  /** Bu arızayla ilişkili canlı PID'ler (ör. ['0C','05']) — DTC↔PID köprüsü. */
  relatedPids?:      string[];
}

/** Tam DTC kodu (gövde + kod). */
export interface DTCCode extends DtcRecord {
  code: string;
}

/** Kod → kayıt eşlemesi (bir veri kaynağının içeriği). */
export type DtcCatalog = Record<string, DtcRecord>;

/* ── Kayıt defteri (module singleton) ────────────────────── */

// Yüklenmiş (senkron erişilebilir) kayıtlar. Anahtar HER ZAMAN büyük harf.
const _loaded = new Map<string, DtcRecord>();

// Henüz çalıştırılmamış lazy yükleyiciler (geniş katalog dinamik import'ları).
const _lazyLoaders: Array<() => Promise<DtcCatalog>> = [];
let _lazyDone = false;
let _lazyPromise: Promise<void> | null = null;

/**
 * Paketlenmiş bir kataloğu (hot core dahil) senkron kayıt defterine ekler.
 * Aynı kod tekrar kaydedilirse ÜZERİNE yazar (son kaynak kazanır).
 */
export function registerDtcCatalog(catalog: DtcCatalog): void {
  for (const code in catalog) {
    _loaded.set(code.toUpperCase().trim(), catalog[code]);
  }
}

/**
 * Geniş bir kataloğu LAZY (talep üzerine) yüklemek için yükleyici kaydeder.
 * Yükleyici, ensureExtendedDtcLoaded() çağrılana dek ÇALIŞTIRILMAZ → bundle'a girmez.
 * Tipik kullanım (gelecek PR): registerLazyDtcSource(() =>
 *   import('./data/dtcP0Catalog').then(m => m.default));
 */
export function registerLazyDtcSource(loader: () => Promise<DtcCatalog>): void {
  _lazyLoaders.push(loader);
  _lazyDone = false;     // yeni yükleyici → tekrar yüklenebilir duruma dön
  _lazyPromise = null;
}

/** Senkron çözümleme — yalnız YÜKLENMİŞ kaynaklara bakar. Yoksa undefined. */
export function resolveDtcRecord(code: string): DtcRecord | undefined {
  return _loaded.get(code.toUpperCase().trim());
}

/**
 * Kayıtlı tüm lazy kaynakları BİR KEZ yükler (memoize) ve senkron kayıt defterine
 * birleştirir. Fail-soft: bir katalog yüklenemezse hot-core ile sessizce devam eder.
 * Hiç lazy kaynak yoksa anında çözülür (bu PR'da durum budur).
 */
export function ensureExtendedDtcLoaded(): Promise<void> {
  if (_lazyDone) return Promise.resolve();
  if (_lazyPromise) return _lazyPromise;

  const pending = [..._lazyLoaders];
  _lazyPromise = Promise.all(
    pending.map(async (load) => {
      try {
        registerDtcCatalog(await load());
      } catch {
        /* fail-soft: lazy katalog yüklenemezse hot-core ile devam */
      }
    }),
  ).then(() => {
    _lazyDone = true;
  });

  return _lazyPromise;
}

/** Geniş katalog yüklendi mi? (UI "tam katalog hazır" göstergesi için.) */
export function isExtendedDtcLoaded(): boolean {
  return _lazyDone;
}

/** Yüklü (senkron erişilebilir) DTC kaydı sayısı — tanı/telemetri için. */
export function loadedDtcCount(): number {
  return _loaded.size;
}
