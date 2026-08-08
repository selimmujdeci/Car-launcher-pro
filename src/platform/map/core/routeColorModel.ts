/**
 * routeColorModel.ts — rota çizgisi RENGİNİN tek kanonik hakemi (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · harita API'si YOK · React YOK ·
 * global durum YOK. Girdi dışarıdan gelir → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (K1): TEHLİKE RENGİ SESSİZCE SİLİNİYORDU ────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `ROUTE_CASE.line-color` ve `ROUTE_GLOW_SEL.line-color` özelliklerini İKİ
 * ayrı blok yazıyordu ve her biri KENDİ önbelleğine bakıyordu:
 *
 *   · Manevra vurgusu  → `M.lastManeuverTier` değişince yazar
 *   · Dış risk uyarısı → `M.lastExternalRiskAlert` değişince yazar
 *
 * Aralarında hakem YOKTU ve manevra bloğu ÖNCE koşuyordu. Kanıtlanabilir dizi:
 *
 *   1. risk 0,6            → case+glow AMBER, `lastExternalRiskAlert = true`
 *   2. dönüşe yaklaşma     → kademe 0→1 → case AMBER (tesadüfen aynı)
 *   3. dönüş geçildi       → kademe 1→0 → case `#ffffff`, glow `#4285f4`
 *   4. risk HÂLÂ 0,6       → `_isHighRisk === lastExternalRiskAlert` →
 *                            risk bloğu HİÇ ÇALIŞMAZ
 *
 * → Tehlike aktifken rotanın amber uyarısı KALICI olarak kayboluyordu; risk
 *   0,5'in altına inip tekrar üstüne çıkmadan geri gelmiyordu.
 *
 * İKİNCİ YOL: `setRouteGeometry` yeniden çizimde `lastManeuverTier`ı sıfırlıyor
 * ama `lastExternalRiskAlert`i SIFIRLAMIYORDU. Risk yüksekken yeni rota
 * çizilirse kurulum case'i beyaza döndürüyor, bayrak `true` kaldığı için amber
 * bir daha uygulanmıyordu.
 *
 * ── ÇÖZÜM ─────────────────────────────────────────────────────────────────
 * Renk artık bir DURUM DEĞİŞİMİNDEN değil, ANLIK DURUMDAN türer. Karar tek
 * saf fonksiyondadır ve öncelik açıkça yazılıdır:
 *
 *        1) tehlike  >  2) manevra  >  3) normal
 *
 * Dedup, iki ayrı bayrak yerine tek bir KARAR ANAHTARI (`routeColorKey`) ile
 * yapılır: anahtar aynıysa hiçbir şey yazılmaz, farklıysa TÜM renkler birlikte
 * uygulanır. Bir katmanın diğerinden bağımsız güncellenmesi — kusurun kökü —
 * artık YAPISAL olarak imkânsızdır.
 *
 * ── BU MODEL RENK TASARLAMAZ ──────────────────────────────────────────────
 * Aşağıdaki üç değer bugün kodda olan değerlerin AYNISIDIR ve bu turda
 * DEĞİŞTİRİLMEZ. Bu dosya "hangi renk ne zaman kazanır" sorusunu cevaplar,
 * "hangi renk doğru" sorusunu DEĞİL.
 */

/** Politika sürümü — herhangi bir karar değişince yükselir, LAB'da görünür. */
export const ROUTE_COLOR_POLICY_VERSION = 'RC-2026.08.07' as const;

/* ── Palet: BUGÜNKÜ değerler, birebir taşındı ─────────────────────────────── */

/**
 * KOYU zemin kılıfı — beyaz kontrast sınırı.
 *
 * Gece haritasında ve uydu/hibrit görüntüde doğrudur: gece yolunda 10,37:1,
 * gece arka planında 17,06:1.
 */
export const ROUTE_CASING_NORMAL = '#ffffff';

/**
 * AÇIK zemin kılıfı (PR-3b) — ürünün KENDİ gündüz mürekkebi.
 *
 * Kaynak: `styles/day-mode.css` → `--oem-ink: #0A0C10`. Yeni renk İCAT
 * EDİLMEDİ; gündüz temasında zaten metin/kenarlık rengi olarak kullanılan
 * değer rota kılıfına taşındı.
 *
 * ── NEDEN GEREKLİ (ölçülen) ────────────────────────────────────────────────
 * Gündüz haritası ham OSM Carto raster'ıdır (`RASTER_PAINT_DAY`: contrast
 * 0,05 · brightness 0–1 · saturation −0,05 → neredeyse dokunulmamış). Beyaz
 * kılıf bu zeminde YOK HÜKMÜNDEDİR:
 *     konut/tersiyer `#ffffff` → **1,00:1**   · ikincil `#f7fabf` → 1,08:1
 *     arka plan `#f2efe9`      → 1,15:1       · birincil `#fcd6a4` → 1,37:1
 *     **otoyol `#e892a2`       → 2,32:1**  (rotanın en çok önemsendiği zemin)
 * WCAG 1.4.11 metin-dışı eşiği 3,0'dır; hiçbiri geçmiyor.
 *
 * `#0A0C10` ile aynı zeminlerde: **8,45 – 19,57**.
 *
 * ── ZİNCİRLEME KAZANÇ (ek token GEREKMEDEN) ────────────────────────────────
 * Kılıf koyulaşınca çekirdeğin zeminle savaşması GEREKMEZ; yalnız kılıftan
 * ayrışması yeter. Beyaz kılıfa karşı zayıf olan her şey koyu kılıfa karşı
 * güçlüdür:
 *     çekirdek sonu `#10b981`  2,54 → **7,72**
 *     amber sinyali `#f59e0b`  2,15 → **9,11**
 *     çekirdek başı `#1A73E8`  4,51 → **4,34**
 *     çekirdek ortası `#4F46E5` 6,29 → **3,11**
 *     trafik yeşil/kırmızı/mor      → 8,59 / 5,20 / 3,43
 * Bu yüzden gradient'e, amber'e ve trafik paletine DOKUNULMADI.
 *
 * ⚠️ Çekirdeği koyulaştırmak (ör. `#1A56C4`) ÖLÇÜLEREK REDDEDİLDİ: zeminle
 * kontrastı artırır ama koyu kılıfla iç kenarı 2,96'ya düşürür — rota tek
 * koyu bloğa dönüşür ve kılıf/çekirdek ayrımı kaybolur.
 */
export const ROUTE_CASING_LIGHT_BASEMAP = '#0A0C10';
/** Normal halo — Google mavisi. */
export const ROUTE_GLOW_NORMAL = '#4285f4';
/** Dikkat rengi: hem manevra vurgusu hem tehlike uyarısı bunu kullanır. */
export const ROUTE_ATTENTION_AMBER = '#f59e0b';

/**
 * Çekirdeğin vurgu kipi.
 *
 * `EMPHASIS` bugün yalnız "tam opaklık" demektir (`line-opacity: 1.0`) ve
 * `NORMAL` de zaten 1,0'dır → **iki kip bugün AYNI boyayı üretir**. Ayrım
 * bilerek korunuyor: eski kodda kritik kademede `line-opacity` yeniden 1,0
 * yazılıyordu ("Faz 3.2: lane clarity") ve bu niyet kaybolmasın. Kip, ileride
 * çekirdeğe ayrı bir vurgu verilecekse GENİŞLEME NOKTASIDIR; bugün davranış
 * değiştirmez.
 */
export type RouteCoreMode = 'NORMAL' | 'EMPHASIS';

/** Kararın gerekçesi — LAB'da okunur, kullanıcıya gösterilmez. */
export type RouteColorReason = 'HAZARD' | 'MANEUVER_CRITICAL' | 'MANEUVER_APPROACH' | 'NORMAL';

export const ROUTE_COLOR_REASON_LABEL: Readonly<Record<RouteColorReason, string>> = {
  HAZARD:            'TEHLİKE (öncelikli)',
  MANEUVER_CRITICAL: 'MANEVRA — kritik (<50 m)',
  MANEUVER_APPROACH: 'MANEVRA — yaklaşma (200–50 m)',
  NORMAL:            'NORMAL',
} as const;

export interface RouteColorInput {
  /**
   * Manevra kademesi: 0 = uzak/yok · 1 = yaklaşma (200–50 m) · 2 = kritik (<50 m).
   * `setDrivingView` içindeki mevcut `_mTier` hesabıyla BİREBİR aynı anlamdadır;
   * bu model kademeyi kendisi TÜRETMEZ (ikinci eşik otoritesi kurulmaz).
   */
  readonly maneuverTier: number;
  /** Dış risk eşiği aşıldı mı (`globalRiskScore > 0.5`). */
  readonly hazardHigh: boolean;
  /**
   * Rotanın üzerine çizildiği zemin AÇIK mı.
   *
   * ⚠️ BU "GÜNDÜZ MÜ" DEĞİLDİR — PR-3a'daki `dayMode` alanı BİLEREK daraltıldı.
   *
   * KÖK: `MapMode` (`'road' | 'hybrid' | 'satellite'`) ile `getMapNight()`
   * birbirinden BAĞIMSIZDIR. "Gündüz + uydu" gerçek bir kombinasyondur ve uydu
   * görüntüsü ORTA-KOYU bir yüzeydir; orada koyu kılıf rotayı zeminde yok
   * ederdi. Yani doğru girdi zamanın değil, ZEMİNİN parlaklığıdır.
   *
   * Türetme runtime'da yapılır (`MapLayerManager.syncRouteColor`):
   *     lightBasemap = !night && mode === 'road'
   * Bu model ikinci bir tema/mod otoritesi KURMAZ; yalnız boolean'ı alır.
   */
  readonly lightBasemap: boolean;
}

export interface RouteColorDecision {
  readonly casing: string;
  readonly glow: string;
  readonly coreMode: RouteCoreMode;
  /** Çekirdek opaklığı — bugün her iki kipte de 1,0 (davranış değişmez). */
  readonly coreOpacity: number;
  readonly reason: RouteColorReason;
  /**
   * Dedup anahtarı — İKİ ayrı bayrağın yerini alır.
   *
   * Anahtar kararın TÜM girdilerini taşır; aynı anahtar aynı boya demektir.
   * Böylece "bir katman güncellendi, diğeri eskide kaldı" durumu doğamaz.
   */
  readonly routeColorKey: string;
  readonly policyVersion: string;
}

/**
 * Rota renk kararı.
 *
 * FAIL-SOFT: bozuk/eksik kademe girdisi NORMAL sayılır — bilinmeyen bir sayı
 * yüzünden dikkat rengi uydurulmaz.
 */
export function resolveRouteColor(input: RouteColorInput): RouteColorDecision {
  const tierRaw = input.maneuverTier;
  const tier = Number.isFinite(tierRaw) ? Math.max(0, Math.min(2, Math.trunc(tierRaw))) : 0;
  const hazard = input.hazardHigh === true;
  /* FAIL-SOFT KUTUP: zemin parlaklığı ölçülemiyorsa AÇIK SAYILMAZ. Yanlış
     tarafa düşmenin bedeli simetrik değildir — koyu zeminde koyu kılıf rotayı
     YOK EDER, açık zeminde beyaz kılıf yalnız SİLİKtir. Bu yüzden varsayılan
     kutup, bugünkü (koyu zemin) davranışıdır. */
  const light = input.lightBasemap === true;

  /* Kılıf, KARAR DALLARINDAN BAĞIMSIZ olarak zemin kutbundan gelir: normal ·
     manevra · tehlike — üçünde de kılıfın işi rotayı zeminden AYIRMAKTIR.
     Dikkat rengi (amber) kılıfın kendisi olduğunda bu kural bozulurdu; o
     yüzden aşağıda amber dalları kılıfı AYRICA yazar. */
  const casingNeutral = light ? ROUTE_CASING_LIGHT_BASEMAP : ROUTE_CASING_NORMAL;

  /* ── ÖNCELİK — pazarlıksız sıra ────────────────────────────────────────────
   * Tehlike her zaman kazanır. Eski kodda böyle DEĞİLDİ: manevra bloğu sonradan
   * koşup tehlike rengini beyaza çeviriyordu (K1). Burada tehlike İLK dalda
   * olduğu için, kademe ne olursa olsun renk amber kalır. */
  let casing: string;
  let glow: string;
  let coreMode: RouteCoreMode;
  let reason: RouteColorReason;

  if (hazard) {
    casing = ROUTE_ATTENTION_AMBER;
    glow = ROUTE_ATTENTION_AMBER;
    coreMode = 'EMPHASIS';
    reason = 'HAZARD';
  } else if (tier >= 2) {
    // Kritik (<50 m): amber kılıf + amber halo — eski `_mTier === 2` dalıyla aynı.
    casing = ROUTE_ATTENTION_AMBER;
    glow = ROUTE_ATTENTION_AMBER;
    coreMode = 'EMPHASIS';
    reason = 'MANEUVER_CRITICAL';
  } else if (tier === 1) {
    /* Yaklaşma (200–50 m): YALNIZ kılıf amber olur, halo NORMAL kalır.
       Eski kod bu dalda glow'a hiç dokunmuyordu; o davranış birebir korunur —
       halonun burada da amber olması bir TASARIM değişikliği olurdu. */
    casing = ROUTE_ATTENTION_AMBER;
    glow = ROUTE_GLOW_NORMAL;
    coreMode = 'NORMAL';
    reason = 'MANEUVER_APPROACH';
  } else {
    casing = ROUTE_CASING_NORMAL;
    glow = ROUTE_GLOW_NORMAL;
    coreMode = 'NORMAL';
    reason = 'NORMAL';
  }

  /* ── AÇIK ZEMİN: KILIFIN İŞİ AYIRMAKTIR, SİNYAL TAŞIMAK DEĞİL ─────────────
   * Açık zeminde kılıf HER durumda koyu mürekkebe sabitlenir (normal · manevra
   * · tehlike). Gerekçe ölçümdür: amber açık zeminde 1,08–2,15:1'dir, yani
   * kılıf olarak amber ORADA ZATEN GÖRÜNMÜYOR — kaybedilen bir sinyal yoktur,
   * kazanılan görünür bir rota kenarlığı vardır.
   *
   * Sinyal kaybolmaz, KATMAN DEĞİŞTİRİR: tehlike ve kritik manevrada halo
   * amber kalır ve koyu kılıfa karşı **9,11:1** okunur — üstelik PR-3 halonun
   * en dış ve en geniş katman olmasını sağladı, yani sinyal artık gerçekten
   * görünür durumda.
   *
   * ⚠️ BİLİNÇLİ SONUÇ — cihazda gözlenmeli: **yaklaşma kademesi (tier 1)**
   * açık zeminde amber TAŞIMAZ, çünkü o kademede yalnız kılıf amber oluyordu.
   * Bugün de görünmüyordu (1,56–2,15:1), ama "hiç yok" ile "silik var"
   * arasındaki farkı ancak saha gösterir. Kütüğe ölçüt olarak yazıldı.
   * Bunu halo'ya taşımak K3'e (amber'in ikili anlamı) girmek olurdu — bu
   * turun kapsamı DIŞINDADIR. */
  if (light) casing = casingNeutral;

  /* Anahtar ZEMİN KUTBUNU taşır (gündüz/gece etiketini değil): tema aynı kalıp
     mod `road → satellite` değişirse de kılıf kutbu değişir ve dedup bunu
     görmek ZORUNDADIR; yoksa uydu görüntüsünde koyu kılıf asılı kalırdı. */
  const routeColorKey = `${reason}|${light ? 'light' : 'dark'}|${ROUTE_COLOR_POLICY_VERSION}`;

  return {
    casing,
    glow,
    coreMode,
    coreOpacity: 1.0,
    reason,
    routeColorKey,
    policyVersion: ROUTE_COLOR_POLICY_VERSION,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   KONTRAST ÖLÇÜMÜ — YALNIZ ÖLÇER, HİÇBİR ŞEYİ DEĞİŞTİRMEZ
   ══════════════════════════════════════════════════════════════════════════
   PR-3b'nin (gündüz paleti) kabul ölçütü sayısal olsun diye buraya konuldu.
   Ürün akışında ÇAĞRILMAZ; testler ve CAROS LAB okur. Renk seçmez, uyarı
   üretmez, davranışa dokunmaz. */

/** sRGB bileşen → doğrusal ışık (WCAG 2.x). */
function _linear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** `#rrggbb` → bağıl parlaklık [0,1]. Geçersiz girdi → `null` (uydurma YOK). */
export function relativeLuminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * _linear((n >> 16) & 255)
       + 0.7152 * _linear((n >> 8) & 255)
       + 0.0722 * (_linear(n & 255));
}

/**
 * İki renk arası WCAG kontrast oranı (1..21). Ölçülemezse `null`.
 * Metin-dışı öğe eşiği WCAG 1.4.11'e göre **3:1**'dir.
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
