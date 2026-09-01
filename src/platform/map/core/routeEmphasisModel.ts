/**
 * routeEmphasisModel — P0-NAV-03 · AKTİF ROTA GÖRSEL DİLİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK ·
 * MapLibre importu YOK.
 *
 * ── BU MODÜLÜN SINIRLARI (mevcut otoritelere DOKUNMAZ) ────────────────────
 *  · **RENK** `routeColorModel`e aittir — burada hiçbir renk üretilmez.
 *  · **KALINLIK** `routeWidthModel`e aittir — burada hiçbir genişlik üretilmez.
 *  · **GİDİLEN BÖLÜM** `routeTrimGate` + `trimRouteGeometry`e aittir: geçilen
 *    kısım zaten geometriden ÇIKARILIR. Onu ayrıca "soluk çizen" ikinci bir
 *    katman EKLENMEDİ — aynı gerçeği iki yerden çizmek, sahada kayıtlı
 *    "iki otorite" kusur sınıfıdır. Bu modül yalnız o kararı BELGELER.
 *
 * Bu modül tek bir soruya cevap verir: **hangi rota katmanı ne kadar baskın
 * olmalı.** Yani opaklık hiyerarşisi ve "kesinlik iddiası".
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * 1. **Alternatif rota ana rotayla yarışıyordu.** Ölçüldü: `ALT_FILL`
 *    `line-opacity: 0.9`, genişlik z16'da 9 px — ana rotanın kasası 0.95 ile
 *    neredeyse aynı baskınlıkta. Sürücü hangi çizginin gidilecek rota
 *    olduğunu bir bakışta ayıramaz.
 * 2. **Görsel kesinlik veri güvenine BAĞLI DEĞİLDİ.** Düz-hat yedeği
 *    (`serverUsed: 'straight-line'`) gerçek bir rota gibi, aynı kalınlıkta ve
 *    aynı doygunlukta çiziliyordu. Motor onu dürüstçe etiketliyordu
 *    (`STRAIGHT_LINE_GUIDANCE`) ama **harita aynı kesinlikle boyuyordu**.
 *    Görev şartı: *"Kaynak/veri güveni düşükse görsel kesinlik uydurma."*
 * 3. **Akış animasyonu (marching-ants) her koşulda 0.85** — rehberlik yokken
 *    de dekoratif olarak yanıyordu.
 */

/** Rota verisinin GÜVEN sınıfı — çağıran MEVCUT otoritelerden türetir. */
export type RouteConfidence =
  /** Sağlayıcıdan gerçek rota geldi ve doğrulama kapısını geçti. */
  | 'CONFIRMED'
  /** Gerçek rota ama doğrulama uyarı verdi (`DEGRADED`) ya da hüküm yok. */
  | 'DEGRADED'
  /** Düz hat / yol ağına oturmamış tahmin — GERÇEK ROTA DEĞİLDİR. */
  | 'PROVISIONAL';

export const ROUTE_CONFIDENCE_LABEL: Readonly<Record<RouteConfidence, string>> = {
  CONFIRMED:   'Doğrulanmış rota',
  DEGRADED:    'Kusurlu rota (uygulandı)',
  PROVISIONAL: 'Düz hat tahmini — gerçek rota değil',
};

export const ROUTE_EMPHASIS_POLICY_VERSION = 'RE-2026.08.24-OEM' as const;

export interface RouteEmphasisInput {
  readonly confidence: RouteConfidence;
  /** Rehberlik sürüyor mu (`ACTIVE`/`REROUTING`). */
  readonly navActive: boolean;
  /** Açık zeminli harita mı (gündüz vektör / uydu) — kontrast yönü değişir. */
  readonly lightBasemap: boolean;
  /** Kaç alternatif çiziliyor (0 = yok). */
  readonly altCount: number;
}

export interface RouteEmphasisDecision {
  readonly policyVersion: string;
  readonly confidence: RouteConfidence;
  /** Ana rota çekirdeği. */
  readonly coreOpacity: number;
  /** Kasa (contrast border) — çekirdeği zeminden ayıran öğe. */
  readonly casingOpacity: number;
  /** Dış hale — dekoratif; kesinlik iddiası taşımaz. */
  readonly glowOpacity: number;
  /** Derinlik gölgesi. */
  readonly shadowOpacity: number;
  /** Akış animasyonu (marching-ants). 0 = çizilmez. */
  readonly flowOpacity: number;
  /** Alternatif rota — ana rotayla YARIŞMAMALI. */
  readonly altOpacity: number;
  /**
   * Ana rota kesikli mi çizilsin. `true` YALNIZ `PROVISIONAL`da: kesik çizgi,
   * evrensel olarak "bu kesin değil" anlamına gelir ve sürücüye yol ağına
   * oturmamış bir tahmini gerçek rota gibi sunmayı engeller.
   */
  readonly coreDashed: boolean;
  /** Kesikli desen (line-dasharray) — `coreDashed` false ise `null`. */
  readonly coreDashArray: readonly [number, number] | null;
  /** Ana rota ile alternatif arasındaki baskınlık oranı — kilitlenebilir ölçüm. */
  readonly mainOverAltRatio: number;
  readonly reason: string;
}

/* ── Sabitler (hepsi gerekçeli) ───────────────────────────────────────────── */

/**
 * Alternatif rotanın ana rotaya göre EN YÜKSEK opaklığı.
 *
 * Ölçüldü: eski değer 0,90 idi ve ana kasa 0,95'ti → oran 1,06. Bir bakışta
 * ayrım için baskınlık oranının en az **1,8** olması hedeflendi; alternatif
 * hâlâ tıklanabilir/görünür kalır ama "ikinci seçenek" olduğu okunur.
 */
export const ALT_MAX_OPACITY = 0.42;

/** Rehberlik başladığında alternatif daha da geri çekilir — karar verilmiştir. */
export const ALT_NAV_OPACITY = 0.26;

/** Ana rota ile alternatif arasında istenen ASGARİ baskınlık oranı. */
export const MIN_MAIN_OVER_ALT_RATIO = 1.8;

/** Düz-hat tahmininde kesik çizgi deseni (line-dasharray birimi = line-width). */
export const PROVISIONAL_DASH: readonly [number, number] = [1.6, 1.4];

function _core(confidence: RouteConfidence): number {
  switch (confidence) {
    case 'CONFIRMED':   return 1.00;
    /* Gerçek ve uygulanmış rota okunabilirliğini kaybetmez. Kusur hükmünü HUD'daki
       açık "ROTA KUSURLU" etiketi taşır; ana güvenlik çizgisini soldurmak aynı
       bilgiyi ikinci kez, üstelik rota/yol ayrımını bozarak kodluyordu. */
    case 'DEGRADED':    return 1.00;
    /* Düz hat: görünür olmalı (sürücünün tek yönlendirmesi bu) ama KESİN
       görünmemeli. Opaklık + kesik çizgi birlikte çalışır. */
    case 'PROVISIONAL': return 0.72;
  }
}

/**
 * Rota vurgu hükmü.
 *
 * Hiçbir renk/genişlik üretmez; yalnız opaklık hiyerarşisi ve kesinlik iddiası.
 */
export function resolveRouteEmphasis(input: RouteEmphasisInput): RouteEmphasisDecision {
  const coreOpacity = _core(input.confidence);

  /* Kasa çekirdekten bağımsızdır: açık zeminde koyu kasa, koyu zeminde beyaz
     kasa çizgiyi zeminden ayırır (renk kararı `routeColorModel`de). Kesinlik
     düşükken kasa da iner ki "keskin kenarlı gerçek yol" izlenimi doğmasın. */
  const casingOpacity = input.confidence === 'PROVISIONAL' ? 0.70 : 0.95;

  /* Hale dekoratiftir: gündüz açık zeminde işe yaramaz (kontrast kaybı),
     gece rotayı zeminden ayırmaya yardım eder. Rehberlik yokken kısılır. */
  const glowOpacity = input.lightBasemap
    ? 0.10
    : (input.navActive ? 0.20 : 0.14);

  const shadowOpacity = input.lightBasemap ? 0.14 : 0.20;

  /* Akış animasyonu YALNIZ rehberlik sürerken ve YALNIZ rota gerçekse anlamlı:
     düz hat üzerinde akan oklar, olmayan bir yolda ilerleme iddiasıdır. */
  /* Beyaz pulse katmanı çekirdeğin ÜSTÜNDEDİR. Eski gündüz 0,55 değeri mavi
     çekirdeği pastel/soluk gösteriyor ve routeLayerModel'in >=0,5 "flow masks
     core" kök uyarısını doğrudan tetikliyordu. Akış yalnız ince hareket ipucudur. */
  const flowOpacity = !input.navActive || input.confidence === 'PROVISIONAL'
    ? 0
    : (input.lightBasemap ? 0.22 : 0.34);

  const altOpacity = input.altCount <= 0
    ? 0
    : (input.navActive ? ALT_NAV_OPACITY : ALT_MAX_OPACITY);

  const coreDashed = input.confidence === 'PROVISIONAL';

  const mainOverAltRatio = altOpacity > 0
    ? Math.round((coreOpacity / altOpacity) * 100) / 100
    : Number.POSITIVE_INFINITY;

  const reason = input.confidence === 'PROVISIONAL'
    ? 'düz hat tahmini — kesik çizgi, akış YOK, kesinlik iddiası yok'
    : input.confidence === 'DEGRADED'
      ? 'rota doğrulamadan uyarıyla geçti — HUD etiketi dürüstlüğü taşır, rota okunaklı kalır'
      : (input.navActive ? 'rehberlik sürüyor — ana rota baskın' : 'önizleme — alternatifler okunabilir');

  return {
    policyVersion: ROUTE_EMPHASIS_POLICY_VERSION,
    confidence: input.confidence,
    coreOpacity,
    casingOpacity,
    glowOpacity,
    shadowOpacity,
    flowOpacity,
    altOpacity,
    coreDashed,
    coreDashArray: coreDashed ? PROVISIONAL_DASH : null,
    mainOverAltRatio,
    reason,
  };
}

/**
 * Mevcut otoritelerin çıktısından güven sınıfı türet.
 *
 * **Yeni hüküm ÜRETMEZ**: `serverUsed` `routingService`in, `verdict`
 * `routeValidationModel`in kararıdır. Burada yalnız GÖRSEL sınıfa eşlenir.
 */
export function routeConfidenceFrom(
  serverUsed: string | null | undefined,
  verdict: 'VALID' | 'DEGRADED' | 'REJECTED' | 'UNKNOWN' | null | undefined,
): RouteConfidence {
  /* Düz hat her şeyin önünde gelir: doğrulama hükmü ne derse desin, yol ağına
     oturmamış bir çizgi kesin çizilemez. */
  if (serverUsed === 'straight-line') return 'PROVISIONAL';
  if (verdict === 'VALID') return 'CONFIRMED';
  /* FAIL-CLOSED: hüküm yok / bilinmiyor da KESİN sayılmaz. */
  return 'DEGRADED';
}
