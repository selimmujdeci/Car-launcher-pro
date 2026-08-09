/**
 * Trip Cost Composition — rota → plan → rapor SAF wiring — TRIP-COST-B3.
 *
 * ── KAPATILAN BOŞLUK ────────────────────────────────────────────────────────
 * B2 (`tripCostRouteAdapter`) dönüşümü yazmıştı ama **çağıranı yoktu**: rota
 * modeli yalnız mesafe/süre taşır; `origin` · `destination` · `nights` ·
 * `travellers` · `vehicleProfile` orada **HİÇ YOKTUR** ve B2 haklı olarak
 * bunları zorunlu kılıp uydurmayı reddediyordu. Kimse de sağlamıyordu.
 * Bu dosya o boşluğu kapatır: alanların nereden geldiğini **açıkça beyan
 * ettirir**, beyan edilmeyeni **doldurmaz** ve sonucun neden eksik olduğunu
 * makine-okunur biçimde söyler.
 *
 * ── İKİ FARKLI "YOK" — KARIŞTIRILMASI YASAK ─────────────────────────────────
 *   1. **Kategori HİÇ AÇILMAZ** — o kaleme ait plan girdisi beyan edilmedi
 *      (kaç gece kalınacağı bilinmiyorsa "konaklama" diye bir kalem YOKTUR).
 *      Rapora kalem GİRMEZ. Varsayılan değerle doldurma YASAK: "1 yolcu" ya da
 *      "1 gece" varsayımı da bir uydurmadır.
 *   2. **Kategori AÇILIR ama değer BİLİNMİYOR** — girdi var, fiyat kaynağı yok
 *      (2 gece biliniyor, gecelik TL bilinmiyor). Kalem doğar, `value: null`,
 *      `status: 'unknown'`, toplama GİRMEZ ve raporda "bilinmiyor" der.
 * Bu ayrım LAB'da da ayrı ayrı okunur; ikisi tek "—" altında birleştirilmez.
 *
 * ── FİYAT KAYNAĞI OLMADAN DA ÇALIŞIR (tasarım şartı) ────────────────────────
 * Hiçbir fiyat kaynağı bağlanmamışken bile plan üretilir: mesafe, süre ve
 * yakıt kalemi doğar; tutar `null` kalır. Sıfır YAZILMAZ, tahmin ÜRETİLMEZ.
 * Fiyat kaynakları (TRIP-COST P2–P5) sonradan takılınca bu dosya DEĞİŞMEZ —
 * yalnız kategori girdileri dolu gelmeye başlar.
 *
 * ── SAFLIK ──────────────────────────────────────────────────────────────────
 * Bu dosya SAF: store/servis/ağ/timer/`Date.now` YOK, React importu YOK.
 * Canlı rota ve hedef okuma işi ÇAĞIRANA aittir (LAB tarafında
 * `tripCostSources.ts`). Sözleşme ihlalinde THROW eder (programlama hatası
 * sessizce yutulmaz); I/O katmanı kendi try/catch'ini uygular.
 */
import type {
  TripPlan, CostReport, TravellerComposition, VehicleCostProfile,
} from './models';
import {
  buildTripPlanFromActiveRoute,
  metersToKm,
  type RouteDistanceDuration,
  type TripPlanMetadata,
} from './tripCostRouteAdapter';
import { runTripCostPipeline } from './tripCostPipeline';
import type {
  TripFuelCategoryInput, TripTollCategoryInput,
  TripLodgingCategoryInput, TripParkingCategoryInput,
} from './tripCostAdapters';

/* ── Girdi 1: rotanın SAĞLADIĞI ─────────────────────────────────────────── */

/**
 * Canlı rotadan okunan alanlar. `hasToll` maliyet HESABINA girmez; yalnız
 * "rota ücretli ama elimizde segment/tarife yok" durumunu ayırt etmek için
 * taşınır (bkz. `ROTA_UCRETLI_AMA_SEGMENT_YOK`).
 */
export interface RouteCostSnapshot extends RouteDistanceDuration {
  readonly hasToll: boolean;
}

/* ── Girdi 2: rotada OLMAYAN, beyan edilmesi gereken ─────────────────────── */

/**
 * Rota modelinde karşılığı OLMAYAN alanlar. Hepsi opsiyoneldir ve
 * **opsiyonel olması "varsayılanı var" demek DEĞİLDİR** — verilmeyen alan
 * "BEYAN EDİLMEDİ"dir ve bağlı olduğu kategori açılmaz.
 *
 * Bugünkü kaynakları (2026-08-09):
 *   · `destination` → navigasyon hedefinin ADI (üründe VAR, canlı okunur)
 *   · `origin`      → **kaynağı YOK.** Yolculuk başlangıcının adı hiçbir yerde
 *                     tutulmuyor; ters-geokodlama ağ işidir ve bu katmanın
 *                     kapsamı dışında. Çağıran beyan etmezse plan KURULMAZ.
 *   · `nights` · `travellers` → **kaynağı YOK.** Bunları toplayacak bir ürün
 *                     yüzeyi (yolculuk planlama ekranı) henüz yok; geldiğinde
 *                     buraya beyan olarak akar.
 *   · `vehicleProfile` → araç profili/OBD tüketimi bağlanınca gelir (P2).
 */
export interface TripCostDeclaration {
  readonly planId?:         string;
  readonly currency?:       string;
  readonly origin?:         string;
  readonly destination?:    string;
  readonly nights?:         number;
  readonly travellers?:     TravellerComposition;
  readonly vehicleProfile?: VehicleCostProfile;
}

/** Kategori verisi — fiyat kaynakları bağlandıkça dolar (bugün hepsi boş). */
export interface TripCostCategoryData {
  readonly fuel?:    TripFuelCategoryInput;
  readonly toll?:    TripTollCategoryInput;
  readonly lodging?: TripLodgingCategoryInput;
  readonly parking?: TripParkingCategoryInput;
}

/* ── Çıktı ───────────────────────────────────────────────────────────────── */

/** Beyan edilmeyen alan — makine-okunur. */
export type TripCostGap =
  | 'PLAN_KIMLIGI_BEYAN_EDILMEDI'
  | 'PARA_BIRIMI_BEYAN_EDILMEDI'
  | 'BASLANGIC_BEYAN_EDILMEDI'
  | 'HEDEF_BEYAN_EDILMEDI'
  | 'GECE_SAYISI_BEYAN_EDILMEDI'
  | 'YOLCU_BEYAN_EDILMEDI'
  | 'ARAC_PROFILI_BEYAN_EDILMEDI'
  | 'ROTA_YOK';

export const TRIP_COST_GAP_LABEL: Readonly<Record<TripCostGap, string>> = {
  PLAN_KIMLIGI_BEYAN_EDILMEDI: 'plan kimliği beyan edilmedi',
  PARA_BIRIMI_BEYAN_EDILMEDI:  'para birimi beyan edilmedi',
  BASLANGIC_BEYAN_EDILMEDI:    'başlangıç beyan edilmedi (rotada yok)',
  HEDEF_BEYAN_EDILMEDI:        'hedef beyan edilmedi (rotada yok)',
  GECE_SAYISI_BEYAN_EDILMEDI:  'gece sayısı beyan edilmedi (rotada yok)',
  YOLCU_BEYAN_EDILMEDI:        'yolcu sayısı beyan edilmedi (rotada yok)',
  ARAC_PROFILI_BEYAN_EDILMEDI: 'araç profili beyan edilmedi',
  ROTA_YOK:                    'aktif rota yok',
};

export type TripCostCategory = 'fuel' | 'toll' | 'lodging' | 'parking';

/** Kategorinin neden açıldığı/açılmadığı. */
export type TripCostCategoryReason =
  | 'ACIK'                          // açıldı, girdisi tam
  | 'ACIK_DEGER_BILINMIYOR'         // açıldı ama fiyat/tüketim kaynağı yok
  | 'ROTA_UCRETLI_AMA_SEGMENT_YOK'  // rota ücretli geçiş içeriyor, tarife elimizde yok
  | 'UCRETLI_SEGMENT_VERISI_YOK'
  | 'GECE_SAYISI_BEYAN_EDILMEDI'
  | 'KONAKLAMA_KAYDI_YOK'
  | 'OTOPARK_KAYDI_YOK';

export const TRIP_COST_CATEGORY_REASON_LABEL:
Readonly<Record<TripCostCategoryReason, string>> = {
  ACIK:                         'açık — girdisi tam',
  ACIK_DEGER_BILINMIYOR:        'açık — tutar BİLİNMİYOR (fiyat kaynağı yok)',
  ROTA_UCRETLI_AMA_SEGMENT_YOK: 'AÇILMADI — rota ücretli geçiş içeriyor ama tarife verisi yok',
  UCRETLI_SEGMENT_VERISI_YOK:   'AÇILMADI — ücretli geçiş verisi yok',
  GECE_SAYISI_BEYAN_EDILMEDI:   'AÇILMADI — gece sayısı beyan edilmedi',
  KONAKLAMA_KAYDI_YOK:          'AÇILMADI — konaklama kaydı yok',
  OTOPARK_KAYDI_YOK:            'AÇILMADI — otopark kaydı yok',
};

export interface TripCostCategoryState {
  readonly category: TripCostCategory;
  readonly opened:   boolean;
  readonly reason:   TripCostCategoryReason;
}

export interface TripCostOutcome {
  /** Plan kuruldu mu? `false` ise `blockedBy` doludur ve rapor `null`dır. */
  readonly planBuilt:  boolean;
  /** Planı ENGELLEYEN eksikler (yalnız zorunlu alanlar). */
  readonly blockedBy:  readonly TripCostGap[];
  /** Beyan edilmeyen TÜM alanlar (engelleyen + engellemeyen). */
  readonly gaps:       readonly TripCostGap[];
  readonly plan:       TripPlan | null;
  readonly report:     CostReport | null;
  readonly categories: readonly TripCostCategoryState[];
  /** Rota ölçüsü — plan kurulamasa bile okunabilir (fiyattan bağımsız). */
  readonly totalDistanceKm:      number | null;
  readonly totalDurationSeconds: number | null;
}

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function isValidRoute(route: RouteCostSnapshot | null | undefined): route is RouteCostSnapshot {
  return !!route
    && Number.isFinite(route.distanceM) && route.distanceM >= 0
    && Number.isFinite(route.durationS) && route.durationS >= 0;
}

/**
 * Beyan edilmeyen alanlar için TİP-ZORUNLU dolgu.
 *
 * `TripPlan.nights`/`travellers`/`vehicleProfile` tipte ZORUNLUDUR, oysa bugün
 * kaynakları yok. Dolgular bilinçli olarak **etkisiz** seçildi:
 *   · `nights: 0` + konaklama kategorisi KAPALI → hiçbir tüketici okumaz;
 *   · `travellers: {0,0}` → "1 yolcu" gibi bir VARSAYIM değil, boş beyan;
 *   · `vehicleProfile: {propulsion:'unknown'}` → modelin KENDİ dürüst değeri.
 * Ölçüldü (2026-08-09): hiçbir cost provider `plan.nights` · `plan.travellers`
 * · `plan.vehicleProfile` okumaz — lodging kendi `stays[].nights`'ını kullanır.
 * Yani bu dolgular bir maliyet ÜRETEMEZ. Yine de her biri `gaps`e yazılır ve
 * LAB "0 gece" DEĞİL "beyan edilmedi" gösterir.
 */
const UNDECLARED_TRAVELLERS: TravellerComposition = { adults: 0, children: 0 };
const UNDECLARED_VEHICLE: VehicleCostProfile = { propulsion: 'unknown' };

/* ── Ana giriş ───────────────────────────────────────────────────────────── */

/**
 * Rota + beyan + (varsa) kategori verisi → `TripCostOutcome`.
 *
 * FAIL-CLOSED: `origin` · `destination` · `planId` · `currency` beyan
 * edilmemişse ya da rota geçersizse plan KURULMAZ (`planBuilt:false`) ve rapor
 * üretilmez — eksik alan varsayılanla DOLDURULMAZ.
 */
export function buildTripCostOutcome(
  route: RouteCostSnapshot | null | undefined,
  declaration: TripCostDeclaration,
  categoryData: TripCostCategoryData = {},
): TripCostOutcome {
  const d = declaration ?? {};

  /* 1 · Eksik beyan envanteri — engelleyen ve engellemeyen ayrı ayrı. */
  const blockedBy: TripCostGap[] = [];
  const gaps: TripCostGap[] = [];

  const routeOk = isValidRoute(route);
  if (!routeOk)                     { blockedBy.push('ROTA_YOK'); gaps.push('ROTA_YOK'); }
  if (!isNonEmpty(d.planId))        { blockedBy.push('PLAN_KIMLIGI_BEYAN_EDILMEDI'); gaps.push('PLAN_KIMLIGI_BEYAN_EDILMEDI'); }
  if (!isNonEmpty(d.currency))      { blockedBy.push('PARA_BIRIMI_BEYAN_EDILMEDI'); gaps.push('PARA_BIRIMI_BEYAN_EDILMEDI'); }
  if (!isNonEmpty(d.origin))        { blockedBy.push('BASLANGIC_BEYAN_EDILMEDI'); gaps.push('BASLANGIC_BEYAN_EDILMEDI'); }
  if (!isNonEmpty(d.destination))   { blockedBy.push('HEDEF_BEYAN_EDILMEDI'); gaps.push('HEDEF_BEYAN_EDILMEDI'); }

  const nightsDeclared = Number.isFinite(d.nights) && (d.nights as number) >= 0;
  if (!nightsDeclared)              gaps.push('GECE_SAYISI_BEYAN_EDILMEDI');
  if (!d.travellers)                gaps.push('YOLCU_BEYAN_EDILMEDI');
  if (!d.vehicleProfile)            gaps.push('ARAC_PROFILI_BEYAN_EDILMEDI');

  /* 2 · Kategori kapıları — beyan yoksa kategori HİÇ AÇILMAZ. */
  const categories = resolveCategories(route, categoryData, nightsDeclared, routeOk);

  const totalDistanceKm      = routeOk ? metersToKm(route.distanceM) : null;
  const totalDurationSeconds = routeOk ? route.durationS : null;

  /* 3 · Fail-closed: zorunlu beyan eksikse plan YOK. */
  if (blockedBy.length > 0) {
    return {
      planBuilt: false, blockedBy, gaps,
      plan: null, report: null, categories,
      totalDistanceKm, totalDurationSeconds,
    };
  }

  /* 4 · Plan — B2 adaptörü TEK dönüşüm otoritesidir (burada km/leg hesabı
        TEKRARLANMAZ; ikinci uygulama = ikinci gerçek). */
  const metadata: TripPlanMetadata = {
    id:             d.planId as string,
    currency:       d.currency as string,
    origin:         d.origin as string,
    destination:    d.destination as string,
    nights:         nightsDeclared ? (d.nights as number) : 0,
    travellers:     d.travellers ?? UNDECLARED_TRAVELLERS,
    vehicleProfile: d.vehicleProfile ?? UNDECLARED_VEHICLE,
  };
  const plan = buildTripPlanFromActiveRoute(route as RouteCostSnapshot, metadata);

  /* 5 · Rapor — YALNIZ açılan kategoriler pipeline'a girer. Fiyat kaynağı
        yoksa yakıt kalemi yine doğar ve `value:null` kalır (şart gereği). */
  const opened = new Set(categories.filter((c) => c.opened).map((c) => c.category));
  const report = runTripCostPipeline({
    plan,
    fuel:    opened.has('fuel')    ? (categoryData.fuel    ?? { enabled: true }) : undefined,
    toll:    opened.has('toll')    ? categoryData.toll    : undefined,
    lodging: opened.has('lodging') ? categoryData.lodging : undefined,
    parking: opened.has('parking') ? categoryData.parking : undefined,
  });

  return {
    planBuilt: true, blockedBy: [], gaps,
    plan, report, categories,
    totalDistanceKm, totalDurationSeconds,
  };
}

/* ── Kategori kapıları ───────────────────────────────────────────────────── */

function resolveCategories(
  route: RouteCostSnapshot | null | undefined,
  data: TripCostCategoryData,
  nightsDeclared: boolean,
  routeOk: boolean,
): readonly TripCostCategoryState[] {
  /* YAKIT: rota varsa AÇILIR — mesafe zaten elimizde. Tüketim/fiyat yoksa
     kalem yine doğar ve `unknown` olur ("bilinmiyor" der, 0 yazmaz). Bu,
     "fiyat kaynağı olmadan da plan üretilebilmeli" şartının taşıyıcısıdır. */
  const fuelHasInputs = data.fuel?.consumptionL100Km != null && data.fuel?.pricePerLiter != null;
  const fuel: TripCostCategoryState = {
    category: 'fuel',
    opened:   routeOk,
    reason:   !routeOk ? 'ACIK_DEGER_BILINMIYOR'
      : fuelHasInputs ? 'ACIK' : 'ACIK_DEGER_BILINMIYOR',
  };

  /* ÜCRETLİ GEÇİŞ: segment/tarife listesi YOKSA açılmaz. Boş listeyle açmak
     `value:0, status:'known'` üretirdi — yani "ücretli geçiş yok" YALANI.
     Rota ücretli geçiş içeriyorsa bu ayrıca işaretlenir: eksikliğin bilindiği
     bir eksikliktir, sessiz geçilmez. */
  const tollReady = !!data.toll && data.toll.segments.length > 0;
  const toll: TripCostCategoryState = {
    category: 'toll',
    opened:   tollReady,
    reason:   tollReady ? 'ACIK'
      : (routeOk && route?.hasToll) ? 'ROTA_UCRETLI_AMA_SEGMENT_YOK'
        : 'UCRETLI_SEGMENT_VERISI_YOK',
  };

  /* KONAKLAMA: gece sayısı beyan edilmeden "konaklama" diye bir kalem YOKTUR.
     Beyan var ama kayıt yoksa da açılmaz (hangi konaklama olduğu bilinmiyor). */
  const lodgingReady = !!data.lodging && data.lodging.stays.length > 0;
  const lodging: TripCostCategoryState = {
    category: 'lodging',
    opened:   lodgingReady,
    reason:   lodgingReady ? 'ACIK'
      : !nightsDeclared ? 'GECE_SAYISI_BEYAN_EDILMEDI'
        : 'KONAKLAMA_KAYDI_YOK',
  };

  const parkingReady = !!data.parking && data.parking.stops.length > 0;
  const parking: TripCostCategoryState = {
    category: 'parking',
    opened:   parkingReady,
    reason:   parkingReady ? 'ACIK' : 'OTOPARK_KAYDI_YOK',
  };

  return [fuel, toll, lodging, parking];
}
