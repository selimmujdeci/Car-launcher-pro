/**
 * Trip Cost AI — Faz A saf modeller — TRIP-COST-A1.
 *
 * Bu dosya SAF, YAN ETKİSİZ tiplerden ve tek merkezi validasyon helper'ından
 * (`makeCostItem`) oluşur. Servis/ağ/UI/OBD/navigasyon/store/singleton YOK.
 *
 * ÇEKİRDEK ANAYASA (docs-local/TRIP_COST_AI_ARCHITECTURE.md bölüm 4-5):
 *   - Kaynağı olmayan fiyat UYDURULMAZ.
 *   - `status:'unknown'` kalem toplama girmez (bkz. confidenceLedger.ts).
 *   - Her kalem source + confidence + editable taşır — şeffaflık zorunlu.
 *   - Sahte kesin toplam YOK; belirsizlik dürüstçe bantlanır.
 *
 * Desen kardeşliği: bu dosya `tripRecommendationEngine.ts`teki
 * `SIGNAL_DEFS`/`resolveSignal` → NO_SOURCE deseninin maliyet tarafındaki
 * karşılığıdır (`unknown` = eski `NO_SOURCE`). Bağımlılık KURULMADI — yalnız
 * desen örnek alındı.
 */

/* ── Yolculuk planı ──────────────────────────────────────────────────────── */

/** Yolcu kompozisyonu — giriş ücreti/yemek gibi kişi-bazlı kalemler için (Faz B). */
export interface TravellerComposition {
  adults:    number;
  children:  number;
  /** Bebekler genelde ücretsiz/ayrı sayılır — opsiyonel. */
  infants?:  number;
}

/** Araç yakıt/EV profili — CostEngine bu değerleri SORGULAMAZ, OLDUĞU GİBİ kullanır.
 *  OBD/profil önceliklendirmesi bu katmanın SORUMLULUĞUNDA DEĞİL (wiring katmanı). */
export interface VehicleCostProfile {
  propulsion:          'fuel' | 'electric' | 'hybrid' | 'unknown';
  consumptionL100Km?:  number;   // yakıt/hibrit — L/100km
  consumptionKwh100Km?: number;  // elektrik/hibrit — kWh/100km
  fuelType?:           string;   // 'gasoline' | 'diesel' | 'lpg' | ... (serbest metin — Faz A'da doğrulanmaz)
  /** Römork/karavan çekerken tüketim çarpanı (ör. 1.3). Faz A'da yalnız taşınır, uygulanmaz. */
  trailerMultiplier?:  number;
}

/** Tek rota bacağı (gidiş, dönüş, ara durak arası…). */
export interface TripLeg {
  id:               string;
  distanceKm:       number;
  durationSeconds?: number;
  origin:           string;
  destination:      string;
}

/** Tam yolculuk planı — CostEngine'in tek girdisi. Salt-veri, davranış taşımaz. */
export interface TripPlan {
  id:             string;
  origin:         string;
  destination:    string;
  legs:           TripLeg[];
  nights:         number;
  travellers:     TravellerComposition;
  vehicleProfile: VehicleCostProfile;
  /** Raporun toplanacağı para birimi (ör. 'TRY'). Kalemler farklı para biriminde
   *  gelirse fail-closed dışlanır — bkz. confidenceLedger.ts. */
  currency:       string;
}

/* ── Maliyet kalemi ──────────────────────────────────────────────────────── */

/** Kalemin kaynağı — şeffaflık için ZORUNLU. */
export type CostItemSource =
  | 'live'        // gerçek zamanlı servis (Faz A'da KULLANILMAZ — BYOK gerektirir)
  | 'cached'      // önbelleklenmiş, TTL'li son bilinen değer
  | 'osm'         // OpenStreetMap statik veri (ör. toll=yes)
  | 'user'        // kullanıcının kendi girdiği/override ettiği değer
  | 'calculated'  // mesafe×tüketim×fiyat gibi türetilmiş hesap
  | 'unknown';    // kaynak yok — değer UYDURULMADI

/** Kalemin bilgi durumu. */
export type CostItemStatus =
  | 'known'    // geçerli, toplama girer
  | 'unknown'  // kaynaksız, toplama GİRMEZ (value her zaman null)
  | 'stale';   // geçerli AMA bayat (TTL aşmış) — toplama girer, ayrıca işaretlenir

/**
 * Tek bir maliyet kalemi (yakıt, toll, konaklama, otopark…).
 *
 * KURALLAR (bkz. `makeCostItem` — tek merkezi validasyon):
 *   - `value === null` YALNIZ `status === 'unknown'` iken geçerlidir.
 *   - `status ∈ {known, stale}` ise `value` finite VE `>= 0` olmalı (0 GEÇERLİ).
 *   - `confidence` daima `0..1` aralığında; `unknown` kalemde `0`'a normalize edilir.
 */
export interface CostItem {
  id:          string;
  /** Serbest metin kategori kimliği (ör. 'fuel', 'toll', 'lodging'). Faz A yalnız
   *  'fuel' için gerçek provider üretir; model bilerek AÇIK bırakıldı. */
  category:    string;
  value:       number | null;
  currency:    string;
  source:      CostItemSource;
  confidence:  number;
  /** Kullanıcı bu kalemi override edebilir mi? */
  editable:    boolean;
  status:      CostItemStatus;
  /** Şeffaflık: hesabın nasıl türetildiği (ör. mesafe×tüketim×fiyat). Provider'a özgü şekil. */
  breakdown?:  Record<string, unknown>;
  /** i18n anahtarı — kullanıcıya gösterilecek kısa açıklama (ör. 'fuel_price_unknown'). */
  noteKey?:    string;
}

/* ── Rapor (ledger çıktısı) — davranış confidenceLedger.ts'te ────────────── */

/** ConfidenceLedger çıktısı — dürüst toplam + eksik/bayat/uyumsuz kalem dökümü. */
export interface CostReport {
  /** status ∈ {known, stale} VE currency uyumlu — toplama giren kalemler. */
  knownItems:         CostItem[];
  /** status === 'unknown' — kaynak yok, toplama GİRMEDİ. */
  missingItems:        CostItem[];
  /** status === 'stale' alt kümesi (knownItems içinde de yer alır — toplamda TUTULUR). */
  staleItems:          CostItem[];
  /** reportCurrency'den FARKLI para biriminde gelen known/stale kalemler — fail-closed
   *  DIŞLANDI, toplama katılmadı. Sessiz toplama YASAK. */
  mismatchedItems:     CostItem[];
  /** Yalnız knownItems toplamı (mismatchedItems ASLA dahil değil). */
  knownTotal:          number;
  /** knownItems üzerinden DEĞER-ağırlıklı ortalama confidence (num/den; den=0→0). */
  weightedConfidence:  number;
  currency:            string;
  /** missingItems boş VE mismatchedItems boşsa true. */
  isComplete:           boolean;
  /** Dürüst alt sınır — her zaman knownTotal. */
  lowerBound:           number;
  /** Üst sınır UYDURULMAZ — Faz A'da her zaman null. */
  upperBound:           number | null;
}

/* ── Merkezi validasyon — tek kaynak, tüm provider'lar burayı kullanır ───── */

/** `makeCostItem` girdisi — `status` opsiyonel: verilmezse `value===null → 'unknown'`,
 *  aksi halde `'known'` varsayılır (stale'i açıkça belirtmek gerekir). */
export interface CostItemInput {
  id:          string;
  category:    string;
  value:       number | null;
  currency:    string;
  source:      CostItemSource;
  confidence:  number;
  editable:    boolean;
  status?:     CostItemStatus;
  breakdown?:  Record<string, unknown>;
  noteKey?:    string;
}

/**
 * TEK merkezi `CostItem` kurucusu/doğrulayıcısı. Tüm provider'lar VE CostEngine
 * kendi savunma katmanında bunu kullanır — dağınık doğrulama mantığı YOK.
 *
 * Sözleşme ihlalinde (aşağıdaki invaryantlardan biri kırılırsa) THROW eder —
 * bu bilinçli bir tasarım: provider'ın kendi programlama hatası SESSİZCE
 * yutulmaz, CostEngine'in provider-izolasyon katmanı (bkz. costEngine.ts) bu
 * hatayı yakalayıp o TEK provider için bounded `unknown` kaleme çevirir; rapor
 * bütünü ÇÖKMEZ. Yani: "model katmanı SIKI, orkestrasyon katmanı DAYANIKLI".
 *
 * İnvaryantlar:
 *   1. `status:'unknown'` iken `value` MUTLAKA `null` olmalı (aksi halde throw —
 *      çelişkili girdi: hem "kaynak yok" hem "sayı var" olamaz).
 *   2. `status:'unknown'` DEĞİLKEN `value` `null` OLAMAZ (throw).
 *   3. `status ∈ {known, stale}` iken `value` finite VE `>= 0` olmalı (throw).
 *      0 GEÇERLİDİR (ör. ücretsiz otopark, source:'user'/'live' → known).
 *   4. `confidence` `0..1` dışındaysa throw (NaN dahil — `Number.isFinite` kullanılır).
 *   5. `unknown` kalemin confidence'ı GİRDİDEN BAĞIMSIZ `0`'a normalize edilir
 *      (throw değil — bilinçli normalizasyon, çünkü "kaynaksız ama %80 eminim"
 *      anlamsızdır).
 */
export function makeCostItem(input: CostItemInput): CostItem {
  const status: CostItemStatus = input.status ?? (input.value === null ? 'unknown' : 'known');

  if (status === 'unknown') {
    if (input.value !== null) {
      throw new RangeError(
        `makeCostItem: status 'unknown' iken value null OLMALI (kategori: '${input.category}', gelen değer: ${input.value}).`,
      );
    }
    return {
      id:         input.id,
      category:   input.category,
      value:      null,
      currency:   input.currency,
      source:     input.source,
      confidence: 0, // unknown → daima 0'a normalize
      editable:   input.editable,
      status:     'unknown',
      breakdown:  input.breakdown,
      noteKey:    input.noteKey,
    };
  }

  // status ∈ {known, stale}
  if (input.value === null) {
    throw new RangeError(
      `makeCostItem: status '${status}' iken value null OLAMAZ (kategori: '${input.category}').`,
    );
  }
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new RangeError(
      `makeCostItem: geçersiz maliyet değeri (${input.value}) — finite VE >=0 olmalı (kategori: '${input.category}').`,
    );
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new RangeError(
      `makeCostItem: confidence 0..1 aralığında olmalı, alınan: ${input.confidence} (kategori: '${input.category}').`,
    );
  }

  return {
    id:         input.id,
    category:   input.category,
    value:      input.value,
    currency:   input.currency,
    source:     input.source,
    confidence: input.confidence,
    editable:   input.editable,
    status,
    breakdown:  input.breakdown,
    noteKey:    input.noteKey,
  };
}

/**
 * `makeCostItem`in takma adı — zaten var olan bir `CostItem`-şekilli nesneyi
 * yeniden doğrulamak/normalize etmek için kullanılır (ör. CostEngine'in
 * provider çıktısını kabul etmeden önceki savunma katmanı). Davranış BİREBİR
 * aynıdır — iki isim, tek uygulama (kod tekrarı YOK).
 */
export const normalizeCostItem = makeCostItem;
