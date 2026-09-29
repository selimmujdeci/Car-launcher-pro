/**
 * fuelPricePack — Trip Cost YAKIT kaleminin fiyat + tüketim girdisi (SAF).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Hesap motoru (`fuelCostProvider`) yazılıydı ama kimse ona fiyat/tüketim
 * vermiyordu → yakıt kalemi her zaman "bilinmiyor" çıkıyordu. Bu dosya o
 * girdiyi, vizyon belgesinin fiyat kaynağı ilkesine (2026-08-09) uyarak kurar:
 *   · Fiyat VERİDİR, kod değil: `data/fuelPrices.tr.json` — kaynağı ve gözlem
 *     tarihi BEYANLI, elle derlenmiş tablo. Fiyat değişince yalnız o dosya
 *     güncellenir. Otomatik fiyat çekme YOK.
 *   · Tablo kaynaklı kalem bir TAHMİNDİR (`source: 'estimate'`), ölçüm değil.
 *   · Tablo tazelik süresini aşarsa kalem ölmez, `stale` olur.
 *
 * ── TÜKETİM: İKİNCİ SAYI YOK ────────────────────────────────────────────────
 * Tüketim `vehicleAssumptions.DEFAULT_FUEL_L_PER_100KM` (tek otorite) — yolculuk
 * kaydı ve rota tahmini de aynı sayıyı kullanır. Burada ayrı bir varsayım
 * yazmak aynı olgu için ikinci gerçek olurdu (E-05 denetimi).
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Bozuk/eksik tablo, bilinmeyen yakıt türü ya da gelecek tarihli gözlem → fiyat
 * VERİLMEZ; kalem "bilinmiyor" der, 0 YAZMAZ. Neden `priceState` ile beyan edilir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK (zaman çağırandan gelir).
 */
import { DEFAULT_FUEL_L_PER_100KM } from '../../vehicleAssumptions';
import { fuelTypeFromVehicle } from '../ecoReportModel';
import type { TripFuelCategoryInput } from './tripCostAdapters';
import rawFuelPrices from './data/fuelPrices.tr.json';

/** Tablonun fiyat taşıdığı yakıt türleri (araç profili eşlemesi: ecoReportModel). */
export type PackFuelType = 'petrol' | 'diesel';

export interface FuelPricePack {
  readonly currency:      string;
  /** Fiyatın nereden okunduğu (ör. "Opet Adana pompa fiyatı") — boş olamaz. */
  readonly source:        string;
  /** Gözlem günü, `YYYY-MM-DD`. */
  readonly observedOn:    string;
  readonly observedAtMs:  number;
  readonly pricePerLiter: Readonly<Partial<Record<PackFuelType, number>>>;
}

/** Tablo bu kadar günden eskiyse fiyat BAYAT sayılır — pompa fiyatı ayda birkaç kez değişir. */
export const FUEL_PRICE_STALE_AFTER_DAYS = 14;

/**
 * Tablo kaynaklı kalemin güveni. Tüketim bir varsayımdır (araçtan ölçülmedi)
 * ve en zayıf halka tavanı belirler → hesaplanan kalemin varsayılanı (0.7)
 * ALTINDA tutulur.
 */
export const FUEL_ESTIMATE_CONFIDENCE = 0.5;

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Birim fiyat makul aralığı (TL/L) — dışı yazım hatasıdır, fiyat VERİLMEZ. */
const PRICE_RANGE = { min: 1, max: 1_000 } as const;

function parseDay(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  // 2026-02-31 gibi taşan günler reddedilir.
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1
    || d.getUTCDate() !== Number(m[3])) return null;
  return ms;
}

function validPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
    && v >= PRICE_RANGE.min && v <= PRICE_RANGE.max;
}

/**
 * Ham tabloyu doğrular. Kaynak, tarih, para birimi ya da en az bir geçerli
 * fiyat yoksa `null` — yarım tablo "fiyat var" sayılmaz.
 */
export function parseFuelPricePack(raw: unknown): FuelPricePack | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schema !== 1) return null;
  if (typeof r.currency !== 'string' || r.currency.trim() === '') return null;
  if (typeof r.source !== 'string' || r.source.trim() === '') return null;
  const observedAtMs = parseDay(r.observedOn);
  if (observedAtMs === null) return null;
  const prices = r.pricePerLiter;
  if (!prices || typeof prices !== 'object') return null;
  const p = prices as Record<string, unknown>;
  const pricePerLiter: Partial<Record<PackFuelType, number>> = {};
  if (validPrice(p.petrol)) pricePerLiter.petrol = p.petrol;
  if (validPrice(p.diesel)) pricePerLiter.diesel = p.diesel;
  if (Object.keys(pricePerLiter).length === 0) return null;
  return {
    currency:     r.currency.trim().toUpperCase(),
    source:       r.source.trim(),
    observedOn:   r.observedOn as string,
    observedAtMs,
    pricePerLiter,
  };
}

/** Uygulamayla gelen tablo (doğrulanmış; geçersizse `null`). */
export const BUNDLED_FUEL_PRICE_PACK: FuelPricePack | null = parseFuelPricePack(rawFuelPrices);

/** Fiyatın neden verildiği/verilmediği — makine-okunur. */
export type FuelPriceState =
  | 'OK'                  // tablodan fiyat verildi
  | 'STALE'               // fiyat verildi ama tablo tazelik süresini aştı
  | 'NO_PACK'             // tablo yok/geçersiz
  | 'FUTURE_DATE'         // tablonun gözlem tarihi gelecekte — saat ya da tablo hatalı
  | 'CURRENCY_MISMATCH'   // tablo para birimi rapor para biriminden farklı
  | 'FUEL_TYPE_UNKNOWN'   // araç profili yok / yakıt türü bilinmiyor
  | 'NOT_FUEL_VEHICLE'    // elektrikli araç — litre fiyatı anlamsız
  | 'NO_PRICE_FOR_TYPE';  // tabloda bu yakıt türü yok

export const FUEL_PRICE_STATE_LABEL: Readonly<Record<FuelPriceState, string>> = {
  OK:                'fiyat tablodan (tahmin)',
  STALE:             'fiyat tablodan ama BAYAT',
  NO_PACK:           'fiyat tablosu yok',
  FUTURE_DATE:       'tablo tarihi gelecekte — fiyat verilmedi',
  CURRENCY_MISMATCH: 'tablo para birimi uyuşmuyor',
  FUEL_TYPE_UNKNOWN: 'aracın yakıt türü bilinmiyor',
  NOT_FUEL_VEHICLE:  'elektrikli araç — yakıt fiyatı uygulanmaz',
  NO_PRICE_FOR_TYPE: 'tabloda bu yakıt türünün fiyatı yok',
};

export interface FuelCategoryResolution {
  readonly input:        TripFuelCategoryInput;
  readonly priceState:   FuelPriceState;
  /** Fiyat verildiyse tablonun künyesi; verilmediyse `null`. */
  readonly priceSource:  string | null;
  readonly observedOn:   string | null;
  readonly ageDays:      number | null;
}

/**
 * Araç türü + tablo + an → yakıt kategorisi girdisi.
 *
 * Tüketim HER ZAMAN beyanlı varsayımdır; fiyat yalnız tablo geçerliyse verilir.
 * Fiyat verilmezse `pricePerLiter` boş kalır ve sağlayıcı kalemi `unknown`
 * üretir (`fuel_price_unknown`).
 */
export function resolveFuelCategory(p: {
  vehicleType: string | null | undefined;
  pack: FuelPricePack | null;
  nowMs: number;
  reportCurrency: string;
}): FuelCategoryResolution {
  const base: TripFuelCategoryInput = {
    enabled:           true,
    consumptionL100Km: DEFAULT_FUEL_L_PER_100KM,
    source:            'estimate',
    confidence:        FUEL_ESTIMATE_CONFIDENCE,
  };
  const none = (priceState: FuelPriceState): FuelCategoryResolution => ({
    input: base, priceState, priceSource: null, observedOn: null, ageDays: null,
  });

  const fuelType = fuelTypeFromVehicle(p.vehicleType);
  if (fuelType === 'ev') return none('NOT_FUEL_VEHICLE');
  if (fuelType === 'unknown') return none('FUEL_TYPE_UNKNOWN');

  const pack = p.pack;
  if (pack === null) return none('NO_PACK');
  if (pack.currency !== p.reportCurrency.trim().toUpperCase()) return none('CURRENCY_MISMATCH');
  const price = pack.pricePerLiter[fuelType];
  if (price === undefined) return none('NO_PRICE_FOR_TYPE');

  if (!Number.isFinite(p.nowMs)) return none('NO_PACK');
  const ageMs = p.nowMs - pack.observedAtMs;
  // Gözlem gününün kendisi (0..1 gün) geçerlidir; daha ilerisi saat/tablo hatasıdır.
  if (ageMs < -DAY_MS) return none('FUTURE_DATE');
  const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));
  const stale = ageDays > FUEL_PRICE_STALE_AFTER_DAYS;

  return {
    input:       { ...base, pricePerLiter: price, stale },
    priceState:  stale ? 'STALE' : 'OK',
    priceSource: pack.source,
    observedOn:  pack.observedOn,
    ageDays,
  };
}
