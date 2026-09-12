/**
 * routeProjectionModel.ts — ölü hesaplamanın ROTA BOYUNCA ilerletilmesi (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · harita API'si YOK · React YOK ·
 * global durum YOK. Tüm girdiler dışarıdan → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (#451) ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * GPS kaybolunca `navigationSessionRuntime._drTick` konum üretiyor (bu KISIM
 * ÇALIŞIYOR — kütük #451'in "konum DR'si yok" ifadesi eskimiştir). Kusur
 * projeksiyonun EKSENİNDE: `interpolation.projectDeadReckon` son heading
 * doğrultusunda **DÜZ ÇİZGİ** atar, rota geometrisini hiç kullanmaz.
 *
 * Yarıçapı R olan bir virajda, yol boyunca s metre gidildiğinde düz
 * projeksiyonun yanal sapması ≈ **s² / (2R)**. Eşleştirme koridoru
 * `CORRIDOR_BASE_M(55) + min(doğruluk, 40)` → **55–95 m**
 * (`core/mapMatchModel.ts:90-92, 216`). Türetilen çıkış süreleri (90 km/h):
 *
 *     R =  400 m → 210 m yol →  **~8 sn**
 *     R = 1000 m → 331 m yol →  **~13 sn**
 *     R = 3000 m → 574 m yol →  **~23 sn**
 *
 * Yani DR, 60 sn'lik `DR_MAX_DT_SEC` tavanına ULAŞAMADAN koridordan çıkıyor →
 * `mapMatchState` `OFF_NETWORK` → `distanceToNextTurnSource` `STRAIGHT_LINE`
 * (`routingService.ts:1279`) → kalan mesafe ARTABİLİYOR. Kütükte kayıtlı saha
 * gözlemi (`lateralM` max 1496 m · `STRAIGHT_LINE` 92 örnek) bu mekanizmayla
 * tutarlıdır. Düz tünelde 60 sn dayanır — bu yüzden bazen "çalışıyor" görünür.
 *
 * ⚠️ Yukarıdaki süreler GEOMETRİDEN TÜRETİLMİŞTİR, saha ölçümü DEĞİLDİR.
 *
 * ── BU MODELİN İŞİ ────────────────────────────────────────────────────────
 * Rota üzerindeki bir çapadan başlayıp polyline BOYUNCA `advanceM` metre
 * ilerletmek. Rota geometrisi virajı zaten taşıdığı için yanal sapma
 * yapısal olarak DOĞMAZ.
 *
 * ── BU MODELİN YAPMADIĞI (pazarlıksız) ────────────────────────────────────
 *  · Rota UYDURMAZ: geometri yoksa/bozuksa `null` döner, çağıran eski heading
 *    projeksiyonuna düşer (fail-closed).
 *  · GERİYE ilerletmez: `advanceM <= 0` çapayı aynen döndürür.
 *  · Rota bitince UZATMAZ: son noktada durur ve `exhausted: true` İLAN EDER.
 *  · Hız/zaman/güven kararı VERMEZ — onlar çağıranın (runtime) işidir.
 */

/** Bir derece enlem ≈ metre (WGS84 yaklaşık) — `interpolation.ts` ile aynı çıpa. */
const METERS_PER_DEG_LAT = 111_320;

export interface RouteAdvanceResult {
  /** İlerletilmiş konum. */
  readonly lat: number;
  readonly lon: number;
  /** Ulaşılan segmentin başlangıç indeksi (`geometry[segIdx] → geometry[segIdx+1]`). */
  readonly segIdx: number;
  /**
   * GERÇEKTEN tüketilen rota mesafesi (m).
   *
   * `advanceM`den KÜÇÜK olabilir: rota bitmişse fazlası yutulmaz, dürüstçe
   * eksik raporlanır. Çağıran bu farktan "rota bitti"yi anlayabilir.
   */
  readonly consumedM: number;
  /** Rota geometrisi tükendi mi — `true` ise son noktada DURULDU. */
  readonly exhausted: boolean;
}

/** Ekvatoral-düzeltmeli düzlemsel mesafe (m). Kısa segmentlerde haversine ile
 *  farkı ihmal edilebilir; DR segmentleri onlarca metredir. */
function _distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const cosLat = Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const dLat = (bLat - aLat) * METERS_PER_DEG_LAT;
  const dLon = (bLon - aLon) * METERS_PER_DEG_LAT * cosLat;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function _finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Geometri noktası kullanılabilir mi (`[lon, lat]`). */
function _validPoint(p: unknown): p is readonly [number, number] {
  return Array.isArray(p) && p.length >= 2 && _finite(p[0]) && _finite(p[1]);
}

/**
 * Rota çapasından polyline BOYUNCA `advanceM` metre ilerlet.
 *
 * @param geometry  Tam rota — `[lon, lat][]` (`routingService` sözleşmesi).
 * @param segIdx    Çapanın üzerinde bulunduğu segmentin başlangıç indeksi.
 * @param fromLat   Çapa enlemi (rota üzerine oturtulmuş nokta).
 * @param fromLon   Çapa boylamı.
 * @param advanceM  İlerletilecek yol-boyu mesafe (m). `<= 0` → çapa korunur.
 * @returns         Sonuç, ya da girdi KULLANILAMAZ ise `null` (fail-closed →
 *                  çağıran eski heading projeksiyonuna düşer).
 */
export function advanceAlongRoute(
  geometry: readonly (readonly [number, number])[] | null | undefined,
  segIdx: number,
  fromLat: number,
  fromLon: number,
  advanceM: number,
): RouteAdvanceResult | null {
  /* ── FAIL-CLOSED KAPILARI — rota UYDURULMAZ ─────────────────────────────── */
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  if (!_finite(fromLat) || !_finite(fromLon)) return null;
  if (!_finite(segIdx)) return null;

  const n = geometry.length;
  /* Çapa segmenti aralık dışıysa ilerletme YAPILMAZ. Kırpmak, aracı rotanın
     bilinmeyen bir yerine ışınlamak olurdu. */
  const startIdx = Math.trunc(segIdx);
  if (startIdx < 0 || startIdx >= n - 1) return null;

  /* GERİYE İLERLEME YOK: ölçülemeyen/negatif mesafe çapayı DEĞİŞTİRMEZ.
     (`NaN` de buraya düşer — sessizce ileri atmaktansa yerinde kalmak doğrudur.) */
  if (!_finite(advanceM) || advanceM <= 0) {
    return { lat: fromLat, lon: fromLon, segIdx: startIdx, consumedM: 0, exhausted: false };
  }

  let curLat = fromLat;
  let curLon = fromLon;
  let idx = startIdx;
  let remaining = advanceM;
  let consumed = 0;

  /* Her tur bir segmenti tüketir; `idx` monotonik artar → sonsuz döngü YOK. */
  while (idx < n - 1) {
    const nextPt = geometry[idx + 1];
    if (!_validPoint(nextPt)) {
      /* Bozuk nokta: buraya kadar ilerlenen KORUNUR, ötesi UYDURULMAZ.
         Rota fiilen burada bitmiştir. */
      return { lat: curLat, lon: curLon, segIdx: idx, consumedM: consumed, exhausted: true };
    }
    const nLon = nextPt[0];
    const nLat = nextPt[1];
    const segRemain = _distM(curLat, curLon, nLat, nLon);

    if (segRemain <= 0) {
      // Sıfır uzunlukta segment (tekrarlanan nokta) — atla, mesafe tüketme.
      idx++;
      curLat = nLat; curLon = nLon;
      continue;
    }

    if (remaining < segRemain) {
      const t = remaining / segRemain;
      return {
        lat: curLat + (nLat - curLat) * t,
        lon: curLon + (nLon - curLon) * t,
        segIdx: idx,
        consumedM: consumed + remaining,
        exhausted: false,
      };
    }

    // Segment tamamen tüketildi → bir sonrakine geç.
    remaining -= segRemain;
    consumed  += segRemain;
    curLat = nLat; curLon = nLon;
    idx++;
  }

  /* ── ROTA BİTTİ ─────────────────────────────────────────────────────────
   * Son noktada DURULUR. Uzatmak, sürücüyü var olmayan bir yolda ilerliyor
   * göstermek olurdu; varış da UYDURULMAZ — yalnız ilan edilir. */
  return {
    lat: curLat, lon: curLon,
    segIdx: Math.max(0, n - 2),
    consumedM: consumed,
    exhausted: true,
  };
}
