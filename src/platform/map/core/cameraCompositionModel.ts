/**
 * cameraCompositionModel — P0-NAV-03 · SÜRÜŞ KAMERASI KOMPOZİSYONU (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · MapLibre YOK.
 *
 * ── ÖLÇÜLEN KUSUR: İKİ PARALEL KOMPOZİSYON ────────────────────────────────
 * Aracın ekrandaki dikey yeri İKİ AYRI yerde tanımlıydı:
 *
 *   ① `cameraPolicyModel.SPEED_BANDS[*].anchorY` — sürümlü, histerezisli,
 *      yatay/dikey ekrana göre ayrı (0,50 durak → 0,68 otoyol).
 *   ② `cameraEngine.CAMERA_CFG.TOP_PAD_*` — ayrı bir doğrusal eğri
 *      (0,50 → 0,70), `padding.top` olarak uygulanır.
 *
 * Gerçek kamerayı ② sürüyordu; ① yalnız `cameraShadowRuntime` içinde GÖLGE
 * olarak hesaplanıp `anchorYDelta` ölçülüyordu. Yani depo, iki kompozisyon
 * arasındaki farkı ÖLÇMEK için bir gözlemci yazmış ama devralma yapılmamıştı.
 *
 * Bu modül ①'i ②'nin diline çevirir: **istenen `anchorY` → `padding.top`**.
 * Böylece kompozisyonun tek kaynağı `cameraPolicyModel` olur; ikinci bir
 * kamera otoritesi KURULMAZ ve `cameraFollowAuthority` (kameranın SAHİBİ)
 * hiç dokunulmadan yerinde kalır — o "kim sürüyor"a, bu "nasıl çerçeveleniyor"a
 * bakar.
 *
 * ── GEOMETRİ (MapLibre padding sözleşmesi) ────────────────────────────────
 * `padding.top = P` iken projeksiyon merkezi ekranda `y = (H + P) / 2`
 * noktasına düşer. Sürüş kamerası merkeze ARACI değil, aracın `lookAheadM`
 * metre ÖNÜNDEKİ noktayı koyar; araç bu merkezin `lookAheadPx` kadar ALTINDA
 * kalır:
 *
 *     vehicleY = (H + P) / 2 + lookAheadPx
 *     anchorY  = vehicleY / H
 *  ⟹  P = H · (2·anchorY − 1) − 2·lookAheadPx
 *
 * `lookAheadPx` METREdir → piksel karşılığı ekran yüksekliğinden BAĞIMSIZDIR;
 * bu yüzden sabit bir oran (eski `topPadFrac`) kısa ekranda aracı taşırıyordu
 * (kütükte kayıtlı telefon/head unit ayrışması). Anchor tabanlı çözüm bu
 * bağımlılığı yapısal olarak kaldırır: hedef ARACIN YERİ, padding türetilendir.
 */

/** Çerçeveleme güvenlik payı — araç asla ekranın son şeridine itilmez. */
export const ANCHOR_MIN = 0.42;
/**
 * Aracın inebileceği EN ALT oran. `cameraEngine.VEHICLE_MIN_BOTTOM_PX` piksel
 * tabanlı son savunmadır; bu oran ondan ÖNCE devreye giren yumuşak tavandır.
 */
export const ANCHOR_MAX = 0.78;

/** `padding.top` ekran yüksekliğinin bu oranını aşamaz (MapLibre kararlılığı). */
export const TOP_PAD_MAX_FRAC = 0.82;

/**
 * Tek karede izin verilen EN BÜYÜK anchor değişimi (oran).
 *
 * Görev şartı: *"ani zoom/bearing/pitch sıçramalarını engelle."* Hız bandı
 * atlaması (ör. CITY → CRUISE) anchor'ı bir karede 0,58 → 0,66 zıplatabilir;
 * bu, ekranda haritanın aniden kaymasıdır. Sınır, sönümlemeden AYRI ve ondan
 * ÖNCE gelen sert bir tavandır: sönümleme yumuşatır, bu ENGELLER.
 */
export const ANCHOR_MAX_STEP = 0.02;

/** Aynı sertlikte zoom/pitch/bearing tavanları (tek karede). */
export const ZOOM_MAX_STEP    = 0.22;
export const PITCH_MAX_STEP_DEG = 2.5;
export const BEARING_MAX_STEP_DEG = 12;

export const CAMERA_COMPOSITION_VERSION = 'CC-2026.08.23' as const;

/* ── Anchor → padding ─────────────────────────────────────────────────────── */

export interface AnchorPaddingInput {
  /** Politikanın istediği araç oranı (0..1, üstten). */
  readonly anchorY: number;
  /** Harita canvas yüksekliği (CSS px). */
  readonly containerHeight: number;
  /**
   * İleri bakış payı (px) — TAHMİN DEĞİL, `updateAnchorBias` ile ÖLÇÜLEREK
   * bulunan yanlılık. İlk karede 0 verilir; döngü birkaç karede yakınsar.
   */
  readonly lookAheadPx: number;
}

export interface AnchorPaddingResult {
  /** Uygulanacak `padding.top` (px). */
  readonly topPad: number;
  /** Kırpma sonrası GERÇEKTEN elde edilecek anchor — LAB/kilit için. */
  readonly effectiveAnchorY: number;
  /** İstenen anchor kırpıldı mı ve neden. */
  readonly clamped: boolean;
  readonly reason: string;
}

/**
 * İstenen anchor'ı `padding.top`a çevirir.
 *
 * FAIL-SOFT: ölçülemeyen girdide `topPad = 0` ve `clamped: true` döner —
 * çağıran bunu "kompozisyon uygulanamadı" olarak okur ve MEVCUT değerini
 * korur. Uydurma bir padding üretilmez.
 */
export function resolveTopPadForAnchor(input: AnchorPaddingInput): AnchorPaddingResult {
  const { anchorY, containerHeight: H, lookAheadPx } = input;

  if (!Number.isFinite(H) || H <= 0 || !Number.isFinite(anchorY)) {
    return { topPad: 0, effectiveAnchorY: 0.5, clamped: true, reason: 'ölçüm yok — kompozisyon uygulanmadı' };
  }
  const look = Number.isFinite(lookAheadPx) ? Math.max(0, lookAheadPx) : 0;

  const wanted = Math.max(ANCHOR_MIN, Math.min(ANCHOR_MAX, anchorY));
  const anchorClamped = wanted !== anchorY;

  const rawPad = H * (2 * wanted - 1) - 2 * look;
  const maxPad = H * TOP_PAD_MAX_FRAC;
  const topPad = Math.max(0, Math.min(maxPad, rawPad));
  const padClamped = topPad !== rawPad;

  /* Kırpma sonrası GERÇEK anchor geri hesaplanır: LAB'da "istenen" değil
     "elde edilen" gösterilmelidir; aksi hâlde ekranda görülenle sayı ayrışır. */
  const effectiveAnchorY = ((H + topPad) / 2 + look) / H;

  return {
    topPad,
    effectiveAnchorY,
    clamped: anchorClamped || padClamped,
    reason: anchorClamped
      ? 'anchor güvenlik bandına kırpıldı'
      : padClamped
        ? 'padding tavana kırpıldı (ileri bakış ekrana sığmıyor)'
        : 'uygulandı',
  };
}

/* ── ÖLÇÜLEN GERİ BESLEME (pitch/zoom'dan bağımsız) ──────────────────────────
 * `lookAheadPx`i analitik hesaplamak CAZİP ama YANLIŞ: düz Mercator formülü
 * pitch'i hesaba katmaz. 47° pitch'te araç kameraya YAKIN olduğu için ekranda
 * düz projeksiyonun öngördüğünden DAHA AŞAĞIDA görünür — yani analitik tahmin
 * hatayı tam da tehlikeli yönde (aracı ekran dışına doğru) yapar.
 *
 * Bu yüzden ileri bakış payı TAHMİN EDİLMEZ, ÖLÇÜLÜR: her karede `map.project`
 * ile bulunan gerçek araç konumu ile istenen anchor arasındaki fark küçük bir
 * kazançla `padding` yanlılığına (bias) işlenir. Birkaç karede yakınsar ve
 * pitch/zoom/ekran boyu değiştikçe kendini yeniden ayarlar.
 *
 * Kararlılık üç kapıyla korunur: (1) kazanç < 1 → aşım yok, (2) kare başına
 * mutlak adım sınırı, (3) bias'ın kendisi bantlı. */

/** Ölçülen hatanın kaçının bias'a işleneceği. <1 olmalı (aşım/salınım yok). */
export const ANCHOR_BIAS_GAIN = 0.35;
/** Kare başına bias değişimi (px) — ani düzeltme sıçraması olmasın. */
export const ANCHOR_BIAS_MAX_STEP_PX = 24;
/** Bias'ın ekran yüksekliğine oranla üst sınırı. */
export const ANCHOR_BIAS_MAX_FRAC = 1.2;
/** Bu oranın altındaki hata YOK SAYILIR — ölçüm gürültüsünde salınmayalım. */
export const ANCHOR_BIAS_DEADBAND = 0.006;

export interface AnchorBiasInput {
  /** Önceki bias (px). İlk karede 0 verilir. */
  readonly prevBiasPx: number;
  /** `map.project` ile ÖLÇÜLEN araç oranı (vehicleY / H). */
  readonly measuredAnchorY: number;
  /** Politikanın istediği oran. */
  readonly desiredAnchorY: number;
  readonly containerHeight: number;
}

export interface AnchorBiasResult {
  readonly biasPx: number;
  /** Ölçülen − istenen (oran). Gözlem için; LAB bunu gösterir. */
  readonly errorRatio: number;
  /** Ölü banda düştüğü için dokunulmadı mı. */
  readonly settled: boolean;
}

/**
 * Ölçülen araç konumundan `padding` yanlılığını günceller.
 *
 * FAIL-SOFT: ölçülemeyen girdide bias DEĞİŞMEZ (`settled: true`) — bozuk bir
 * ölçüm kamerayı iteklemez.
 */
export function updateAnchorBias(input: AnchorBiasInput): AnchorBiasResult {
  const { prevBiasPx, measuredAnchorY, desiredAnchorY, containerHeight: H } = input;
  const prev = Number.isFinite(prevBiasPx) ? prevBiasPx : 0;

  if (!Number.isFinite(H) || H <= 0 ||
      !Number.isFinite(measuredAnchorY) || !Number.isFinite(desiredAnchorY)) {
    return { biasPx: prev, errorRatio: 0, settled: true };
  }

  const errorRatio = measuredAnchorY - desiredAnchorY;
  if (Math.abs(errorRatio) <= ANCHOR_BIAS_DEADBAND) {
    return { biasPx: prev, errorRatio, settled: true };
  }

  /* TÜREV (işaret ve katsayı ÖLÇÜLEREK doğrulandı — ilk yazımda İKİSİ de
     yanlıştı ve döngü IRAKSIYORDU; testteki yakınsama kilidi yakaladı):
       P        = H·(2a − 1) − 2·bias      → ∂P/∂bias      = −2
       anchor   = ((H + P)/2 + look) / H   → ∂anchor/∂P    = 1/(2H)
     ⟹ ∂anchor/∂bias = −1/H
     Araç İSTENENDEN AŞAĞIDAYSA (hata > 0) anchor DÜŞMELİ → bias ARTMALI.
     Hatanın tamamını kapatmak için Δbias = hata·H; kazanç bunu <1 ölçekler. */
  const rawStep = errorRatio * H * ANCHOR_BIAS_GAIN;
  const step = Math.max(-ANCHOR_BIAS_MAX_STEP_PX, Math.min(ANCHOR_BIAS_MAX_STEP_PX, rawStep));

  const maxBias = H * ANCHOR_BIAS_MAX_FRAC;
  const biasPx = Math.max(-maxBias, Math.min(maxBias, prev + step));

  return { biasPx, errorRatio, settled: false };
}

/* ── Sıçrama sınırlayıcı ──────────────────────────────────────────────────── */

/**
 * Bir skaleri, önceki değerden en fazla `maxStep` kadar uzaklaştırır.
 *
 * Sönümlemenin YERİNE geçmez, ÖNÜNE geçer: sönümleme yumuşak bir yaklaşımdır
 * ama hedef bir karede büyük sıçrarsa ilk adım da büyük olur. Bu fonksiyon o
 * ilk adımı keser.
 *
 * `prev` yoksa (ilk kare) hedef aynen döner — açılışta yapay yavaşlama olmaz.
 */
export function limitStep(prev: number | null, next: number, maxStep: number): number {
  if (prev === null || !Number.isFinite(prev) || !Number.isFinite(next)) return next;
  const d = next - prev;
  if (Math.abs(d) <= maxStep) return next;
  return prev + Math.sign(d) * maxStep;
}

/** Açısal sürüm — 0/360 sarmasını doğru ele alır. */
export function limitAngleStep(prev: number | null, next: number, maxStepDeg: number): number {
  if (prev === null || !Number.isFinite(prev) || !Number.isFinite(next)) return next;
  const d = ((next - prev + 540) % 360) - 180;
  if (Math.abs(d) <= maxStepDeg) return next;
  return ((prev + Math.sign(d) * maxStepDeg) % 360 + 360) % 360;
}
