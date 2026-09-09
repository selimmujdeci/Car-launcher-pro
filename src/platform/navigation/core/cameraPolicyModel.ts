/**
 * cameraPolicyModel.ts — takip kamerasının KANONİK politikası (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · harita API'si YOK · React YOK.
 *
 * ── KAPSAM SINIRI (bilinçli) ────────────────────────────────────────────────
 * Bu dosya zoom/pitch EĞRİLERİNİ YENİDEN YAZMAZ. O eğriler `cameraEngine.ts`
 * içindeki `CAMERA_CFG` + `computeCameraTarget`tedir ve sahada tek tek
 * ölçülerek ayarlanmıştır (araç ekran-içi garantisi, durakta yön dondurma,
 * ısınma düzeltmeleri). Onları değiştirmek doğrudan regresyon riskidir.
 *
 * Buradaki katman EKSİK OLANI kurar:
 *   1. **Durum makinesi** — kamera hangi rejimde (şehir · seyir · manevra…).
 *      Bugün bu bilgi yalnız sayıların içinde örtükydü; gözlenemiyordu.
 *   2. **Hız/manevra bantları + histerezis** — profil sınırında salınım yok.
 *      Ölçülen kusur: zoom eğrisi süreklidir ama profil değişimi yoktu; bant
 *      kavramı olmadan "titreşimi önle" kuralı denetlenemezdi.
 *   3. **Yön-duyarlı çapa (anchor)** — dikey tam ekranda aracın ekranda nerede
 *      duracağı. Bugün yalnız yataya göre ayarlı tek bir oran vardı.
 *   4. **Asgari güncelleme aralığı** — güncelleme fırtınası sayacı.
 *
 * ── ÇAPA YORUMU (görev §9, açıkça belirtiliyor) ─────────────────────────────
 * Görev "dikeyde araç alt %55–65, yatayda alt %35–40" diyor. Bu ifade iki türlü
 * okunabilir. Burada **`anchorY` = aracın ekranın ÜSTÜNDEN aşağı doğru oranı**
 * olarak alındı (0 = üst kenar, 1 = alt kenar) çünkü navigasyonda amaç aracın
 * ÖNÜNDEKİ yolu göstermektir: araç ne kadar aşağıdaysa ileri yol o kadar uzun
 * görünür. Yatay değerler bugünkü sahada ayarlı davranışa (TOP_PAD 0.50→0.70)
 * yakın tutuldu → regresyon yok; dikeyde ekstra dikey alan ileri yola verildi.
 */

/** Kameranın hangi rejimde olduğu. */
export type CameraState =
  /** Şehir içi takip — ayrıntı öncelikli. */
  | 'FOLLOW_CITY'
  /** Seyir/otoyol takibi — bağlam öncelikli, kamera geri çekilir. */
  | 'FOLLOW_CRUISE'
  /** Manevraya yaklaşılıyor — kavşak kadraja alınmaya başlanır. */
  | 'APPROACH_MANEUVER'
  /** Manevra anı — kavşak geometrisi kadrajda. */
  | 'IN_MANEUVER'
  /** Manevra bitti — seyir profiline dönülüyor. */
  | 'POST_MANEUVER'
  /** Kullanıcı haritayı sürüklüyor. */
  | 'USER_PANNING'
  /** Kullanıcı bıraktı; kamera bıraktığı yerde DURUYOR. */
  | 'FOLLOW_SUSPENDED'
  /** Ortalama uygulanıyor. */
  | 'RECENTERING'
  /** GPS bozuk — kamera araca aşırı yaklaşmaz, yön kovalanmaz. */
  | 'GPS_DEGRADED'
  | 'UNKNOWN';

export const CAMERA_STATE_LABEL: Readonly<Record<CameraState, string>> = {
  FOLLOW_CITY:       'ŞEHİR TAKİBİ',
  FOLLOW_CRUISE:     'SEYİR TAKİBİ',
  APPROACH_MANEUVER: 'MANEVRAYA YAKLAŞMA',
  IN_MANEUVER:       'MANEVRA ANI',
  POST_MANEUVER:     'MANEVRA SONRASI',
  USER_PANNING:      'KULLANICI SÜRÜKLÜYOR',
  FOLLOW_SUSPENDED:  'TAKİP ASKIDA',
  RECENTERING:       'ORTALANIYOR',
  GPS_DEGRADED:      'GPS BOZUK',
  UNKNOWN:           'BİLİNMİYOR',
} as const;

/** Hız bandı — profil seçimi bantla yapılır ki sınırda salınım olmasın. */
export type SpeedBand = 'STOPPED' | 'CITY' | 'SUBURBAN' | 'CRUISE' | 'HIGHWAY';
/** Manevra bandı — yol-boyu mesafeden türer (kuş uçuşu DEĞİL). */
export type ManeuverBand = 'NONE' | 'FAR' | 'APPROACH' | 'IMMINENT';
/** Ekran yönü. */
export type ViewportOrientation = 'LANDSCAPE' | 'PORTRAIT';
/** Hangi görünüm — çapa ve asgari zoom bundan da etkilenir. */
export type ViewportProfile = 'MINI' | 'FULL';

/* ── Versiyonlu profil tablosu ──────────────────────────────────────────────
 * Sayılar dağınık sabit olarak koda serpiştirilmez; tek tabloda ve versiyonlu
 * durur. Sürüm herhangi bir satır değişince yükselir ve CAROS LAB'da görünür. */

export const CAMERA_POLICY_VERSION = 'CAM-2026.09.09' as const;

export interface SpeedBandProfile {
  readonly id: SpeedBand;
  /** Banda GİRİŞ hızı (km/sa). */
  readonly enterKmh: number;
  /** Banttan ÇIKIŞ hızı (km/sa) — histerezis payı içerir. */
  readonly exitKmh: number;
  /** Aracın ekrandaki dikey çapası (üstten oran) — yataya göre. */
  readonly anchorYLandscape: number;
  /** Aracın ekrandaki dikey çapası — dikeye göre. */
  readonly anchorYPortrait: number;
  readonly note: string;
}

/**
 * Hız bantları. Giriş/çıkış eşikleri AYRIDIR (histerezis): bir banda 62 km/sa'te
 * girilir, 55 km/sa'e düşünce çıkılır → 60 km/sa civarında gidip gelen araçta
 * profil salınmaz.
 */
/* ── ÇAPA DEĞERLERİ ÖLÇÜLEREK YÜKSELTİLDİ (2026-09-09) ──────────────────────
 * `field-runs/nav-visual-20260909/camera-sweep.mjs` · üretim stili · gerçek
 * OMT karoları · 904×406 · z16,7 şehir sürüş zoom'u:
 *
 *     anchorY 0,58 · pitch 30 → ileri görüş 193 m   (MEVCUT)
 *     anchorY 0,66 · pitch 30 → 229 m
 *     anchorY 0,58 · pitch 45 → 299 m
 *     anchorY 0,66 · pitch 45 → **373 m**  · karo 1 · parlak %4,67
 *
 * Çapa yükselmesi aracı aşağı iter; kazanılan piksel doğrudan İLERİ YOLA
 * gider ve karo yükü ARTMAZ. Araç ekran-içi garantisi bozulmaz: en yüksek
 * değer (0,74) `ANCHOR_MAX` (0,78) altındadır ve `cameraEngine`in piksel
 * tabanlı son savunması (`VEHICLE_MIN_BOTTOM_PX = 72`) 406 px yüzeyde
 * 0,82'ye karşılık gelir. Kare başı sıçrama tavanı (`ANCHOR_MAX_STEP`)
 * bant atlamasını zaten yumuşatır.
 *
 * DİKEY (portrait) değerler yataydan DÜŞÜK kalır: dikey ekranda aynı oran
 * aracı fiziksel olarak daha aşağı taşır. */
export const SPEED_BANDS: readonly SpeedBandProfile[] = [
  { id: 'STOPPED',  enterKmh: 0,   exitKmh: 0,
    anchorYLandscape: 0.52, anchorYPortrait: 0.52,
    note: 'park/dur — araç merkeze yakın, ileri bakış yok' },
  { id: 'CITY',     enterKmh: 3,   exitKmh: 2,
    anchorYLandscape: 0.65, anchorYPortrait: 0.61,
    note: 'şehir içi — sürüş koridoru öncelikli (ölçüm: 193 m → 373 m)' },
  { id: 'SUBURBAN', enterKmh: 55,  exitKmh: 48,
    anchorYLandscape: 0.69, anchorYPortrait: 0.65,
    note: 'şehirlerarası — ön yol uzar' },
  { id: 'CRUISE',   enterKmh: 90,  exitKmh: 82,
    anchorYLandscape: 0.72, anchorYPortrait: 0.68,
    note: '90–110 km/sa — kamera belirgin geri çekilir' },
  { id: 'HIGHWAY',  enterKmh: 115, exitKmh: 105,
    anchorYLandscape: 0.74, anchorYPortrait: 0.70,
    note: 'otoyol — rota bağlamı ve bağlantı yolu görünür' },
] as const;

/** Manevra bantları — YOL-BOYU mesafeden (kuş uçuşu değil). */
export const MANEUVER_BANDS = {
  /** Bu mesafenin üstünde manevra kamerayı etkilemez. */
  FAR_M: 400,
  /** Kavşağı kadraja almaya başlama mesafesi. */
  APPROACH_M: 180,
  /** Manevra anı sayılan mesafe. */
  IMMINENT_M: 60,
  /** Manevradan sonra seyir profiline dönüş için gereken mesafe. */
  POST_EXIT_M: 90,
} as const;

/**
 * GPS bozuk/bayatken kamera zoom TAVANI.
 *
 * Şehir profilinin altına inilmez: bozuk konumda yakın zoom hatayı BÜYÜTEREK
 * gösterir ve sürücüyü yanıltır (araç yanlış şeritte/yolda duruyormuş gibi
 * görünür). Sayı bu modelin İÇİNDE tanımlıdır ve HEM `decideCameraPolicy`
 * (gölge) HEM üretim kamerası AYNI sabiti okur — ikinci eşik YOKTUR.
 */
export const GPS_DEGRADED_MAX_ZOOM = 16.5;

/**
 * Hareket durumuna göre zoom tavanı. **SAF.** `null` = tavan YOK.
 *
 * `decideCameraPolicy` bu fonksiyonu KULLANIR; üretim kamerası da onu
 * kullanır → kural TEK yerde uygulanır, sürüklenme yapısal olarak imkânsız.
 */
export function resolveMaxZoomHint(
  motionState: CameraPolicyInput['motionState'],
): number | null {
  return (motionState === 'GPS_DEGRADED' || motionState === 'STALE')
    ? GPS_DEGRADED_MAX_ZOOM
    : null;
}

/** Kamera güncellemeleri arasındaki asgari süre (ms) — güncelleme fırtınası yok. */
export const CAMERA_MIN_UPDATE_MS = 120;
/** Bu km/sa altındaki hız değişimi profil DEĞİŞTİRMEZ. */
export const CAMERA_SPEED_EPS_KMH = 1.5;

/* ── Karar ──────────────────────────────────────────────────────────────────*/

export interface CameraPolicyInput {
  /** Doğrulanmış hız (km/sa). */
  readonly speedKmh: number;
  /** Bir önceki karar döngüsündeki hız bandı — histerezis için. */
  readonly prevBand: SpeedBand | null;
  /** Sonraki manevraya YOL-BOYU mesafe (m). `null` = bilinmiyor. */
  readonly nextManeuverM: number | null;
  /** Mesafenin kaynağı — `ALONG_ROUTE` değilse manevra kamerası UYGULANMAZ. */
  readonly maneuverDistanceSource: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN';
  /** İkinci manevraya mesafe (m) — iki manevra yakınsa ikisi de gösterilir. */
  readonly secondManeuverM: number | null;
  /** Takip durumu (kullanıcı pan / ortalama) — kanonik otoriteden gelir. */
  readonly followState: 'FOLLOWING' | 'USER_PANNING' | 'FOLLOW_SUSPENDED' | 'RECENTERING' | 'UNKNOWN';
  /** İşaret hareket durumu — GPS bozuksa kamera yaklaşmaz. */
  readonly motionState: 'INTERPOLATING' | 'TRACKING' | 'SNAP_CORRECTION' | 'GPS_DEGRADED' | 'STALE' | 'UNKNOWN';
  readonly orientation: ViewportOrientation;
  readonly viewport: ViewportProfile;
  /** Manevra az önce geçildi mi (POST_MANEUVER için). */
  readonly justPassedManeuver?: boolean;
}

export interface CameraPolicyDecision {
  readonly state: CameraState;
  readonly profileId: SpeedBand;
  readonly policyVersion: string;
  readonly speedBand: SpeedBand;
  readonly maneuverBand: ManeuverBand;
  /** Aracın ekrandaki dikey çapası (üstten oran, 0..1). */
  readonly anchorY: number;
  /** Yatay çapa — bugün her zaman merkez; alan gelecekteki şerit görünümü için. */
  readonly anchorX: number;
  /** Kamera SÜRÜLEBİLİR mi (pan/askı durumunda `false`). */
  readonly cameraDriveAllowed: boolean;
  /** Manevra kamerası uygulanmalı mı — `turnApproachM` bu kapıdan geçer. */
  readonly applyManeuverCamera: boolean;
  /** GPS bozukken kamera zoom'una üst sınır (aşırı yaklaşma yasağı). */
  readonly maxZoomHint: number | null;
  readonly updateReason: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   SORUMLULUK SINIRI — `cameraFollowAuthority` İLE İLİŞKİ (kanıtlı sözleşme)
   ══════════════════════════════════════════════════════════════════════════
   İki sistem AYNI gerçeği iki kez ÜRETMEZ; FARKLI SORU sorarlar:

   · `cameraFollowAuthority.canDriveCamera()` — **ÜRETİM OTORİTESİ**:
     *"RUTİN bir GPS fix'i kamerayı sürebilir mi?"* Yalnız `FOLLOWING` iken
     `true` (fail-closed). Üretim tüketicileri: `FullMapView` · `MiniMapWidget`.

   · `decideCameraPolicy(...).cameraDriveAllowed` — **PROJEKSİYON**:
     *"Kamera ŞU AN sistemin denetiminde mi (kullanıcının değil)?"*
     Takip durumunu HESAPLAMAZ; `followState` GİRDİ olarak kanonik otoriteden
     gelir (`cameraShadowRuntime._mapFollow` — "birebir eşleme, yeni durum YOK").

   ── TEK GERÇEK FARK: `RECENTERING` ────────────────────────────────────────
   Ortalama uygulanırken (`beginRecenter` → `enterNavigationView` →
   `completeRecenter`, hepsi SENKRON) kamerayı ORTALAMA İŞLEMİ sürer:
     · "sistem sürüyor mu?"        → EVET → `cameraDriveAllowed: true`
     · "rutin fix sürebilir mi?"   → HAYIR → `canDriveCamera(): false`
       (uçuştaki ortalama animasyonuyla yarışmamalı)
   İkisi de DOĞRUdur. Bu fark BİLİNÇLİDİR ve aşağıdaki projeksiyonla
   açıkça ifade edilir — gölge karşılaştırması artık elmayla elmayı ölçer.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Politika kararının `canDriveCamera()` ile KARŞILAŞTIRILABİLİR izdüşümü:
 * *"rutin bir GPS fix'i kamerayı sürebilir mi?"*
 *
 * **SAF.** Yeni otorite DEĞİLDİR — kararın zaten taşıdığı iki alanı
 * (`cameraDriveAllowed` + `state`) tek soruya indirger. `RECENTERING`
 * dışlanır: o pencerede kamerayı ortalama işlemi sürer, rutin fix DEĞİL.
 */
export function routineFixMayDriveCamera(decision: CameraPolicyDecision): boolean {
  return decision.cameraDriveAllowed === true && decision.state !== 'RECENTERING';
}

/** Hız → bant (histerezisli). */
export function resolveSpeedBand(speedKmh: number, prev: SpeedBand | null): SpeedBand {
  const v = Number.isFinite(speedKmh) && speedKmh > 0 ? speedKmh : 0;
  // Yukarı geçiş: giriş eşiği. Aşağı geçiş: çıkış eşiği (daha düşük) → salınım yok.
  let band: SpeedBand = 'STOPPED';
  for (const b of SPEED_BANDS) {
    if (v >= b.enterKmh) band = b.id;
  }
  if (!prev || prev === band) return band;

  const prevIdx = SPEED_BANDS.findIndex((b) => b.id === prev);
  const nextIdx = SPEED_BANDS.findIndex((b) => b.id === band);
  if (nextIdx < prevIdx) {
    // Düşüş: ancak ÇIKIŞ eşiğinin altına inilirse banttan çık.
    const prevProfile = SPEED_BANDS[prevIdx];
    if (v >= prevProfile.exitKmh) return prev;
  }
  return band;
}

/** Yol-boyu mesafe → manevra bandı. */
export function resolveManeuverBand(
  distanceM: number | null,
  source: CameraPolicyInput['maneuverDistanceSource'],
): ManeuverBand {
  /* Kuş uçuşu mesafe virajlı yaklaşımda gerçek yol mesafesinden KISA çıkar →
     kamera erken kavşağa girer. Kaynak yol-boyu değilse manevra kamerası YOK. */
  if (source !== 'ALONG_ROUTE') return 'NONE';
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM <= 0) return 'NONE';
  if (distanceM <= MANEUVER_BANDS.IMMINENT_M) return 'IMMINENT';
  if (distanceM <= MANEUVER_BANDS.APPROACH_M) return 'APPROACH';
  if (distanceM <= MANEUVER_BANDS.FAR_M) return 'FAR';
  return 'NONE';
}

function _profile(band: SpeedBand): SpeedBandProfile {
  return SPEED_BANDS.find((b) => b.id === band) ?? SPEED_BANDS[0];
}

/**
 * Kamera kararı.
 *
 * FAIL-CLOSED: takip durumu bilinmiyorsa veya kullanıcı haritayı incelerken
 * kamera SÜRÜLMEZ; GPS bozuksa araca aşırı yaklaşılmaz.
 */
export function decideCameraPolicy(input: CameraPolicyInput): CameraPolicyDecision {
  const speedBand = resolveSpeedBand(input.speedKmh, input.prevBand);
  const maneuverBand = resolveManeuverBand(input.nextManeuverM, input.maneuverDistanceSource);
  const p = _profile(speedBand);
  const anchorY = input.orientation === 'PORTRAIT' ? p.anchorYPortrait : p.anchorYLandscape;

  const base = {
    profileId: speedBand,
    policyVersion: CAMERA_POLICY_VERSION,
    speedBand,
    maneuverBand,
    anchorY,
    anchorX: 0.5,
  } as const;

  /* ── Kullanıcı otoritesi her şeyin ÜSTÜNDEDİR ─────────────────────────── */
  if (input.followState === 'USER_PANNING') {
    return { ...base, state: 'USER_PANNING', cameraDriveAllowed: false,
      applyManeuverCamera: false, maxZoomHint: null,
      updateReason: 'kullanıcı haritayı sürüklüyor — kamera sürülmez' };
  }
  if (input.followState === 'FOLLOW_SUSPENDED') {
    return { ...base, state: 'FOLLOW_SUSPENDED', cameraDriveAllowed: false,
      applyManeuverCamera: false, maxZoomHint: null,
      updateReason: 'takip askıda — kamera kullanıcının bıraktığı yerde' };
  }
  if (input.followState === 'RECENTERING') {
    return { ...base, state: 'RECENTERING', cameraDriveAllowed: true,
      applyManeuverCamera: maneuverBand !== 'NONE', maxZoomHint: null,
      updateReason: 'ortalama uygulanıyor' };
  }
  if (input.followState === 'UNKNOWN') {
    return { ...base, state: 'UNKNOWN', cameraDriveAllowed: false,
      applyManeuverCamera: false, maxZoomHint: null,
      updateReason: 'takip durumu bilinmiyor — fail-closed' };
  }

  /* ── GPS bozuk: araca AŞIRI YAKLAŞMA ve gürültülü yönü kovalama YOK ────── */
  if (input.motionState === 'GPS_DEGRADED' || input.motionState === 'STALE') {
    return { ...base, state: 'GPS_DEGRADED', cameraDriveAllowed: true,
      applyManeuverCamera: false,
      /* Tavan KANONİK sabitten — üretim kamerası da AYNI sayıyı okur. */
      maxZoomHint: resolveMaxZoomHint(input.motionState),
      updateReason: 'GPS bozuk/bayat — zoom sınırlı, manevra kamerası kapalı' };
  }

  /* ── Manevra rejimleri ─────────────────────────────────────────────────── */
  if (maneuverBand === 'IMMINENT') {
    return { ...base, state: 'IN_MANEUVER', cameraDriveAllowed: true,
      applyManeuverCamera: true, maxZoomHint: null,
      updateReason: 'manevra anı — kavşak geometrisi kadrajda' };
  }
  if (maneuverBand === 'APPROACH') {
    return { ...base, state: 'APPROACH_MANEUVER', cameraDriveAllowed: true,
      applyManeuverCamera: true, maxZoomHint: null,
      updateReason: 'kavşağa yaklaşılıyor — kadraj açılıyor' };
  }
  if (input.justPassedManeuver === true) {
    return { ...base, state: 'POST_MANEUVER', cameraDriveAllowed: true,
      applyManeuverCamera: false, maxZoomHint: null,
      updateReason: 'manevra tamamlandı — seyir profiline dönülüyor' };
  }

  /* ── Seyir rejimleri ───────────────────────────────────────────────────── */
  const cruising = speedBand === 'CRUISE' || speedBand === 'HIGHWAY' || speedBand === 'SUBURBAN';
  return {
    ...base,
    state: cruising ? 'FOLLOW_CRUISE' : 'FOLLOW_CITY',
    cameraDriveAllowed: true,
    applyManeuverCamera: maneuverBand === 'FAR' ? false : false,
    maxZoomHint: null,
    updateReason: cruising
      ? `seyir profili (${speedBand}) — ön yol bağlamı`
      : `şehir profili (${speedBand}) — ayrıntı öncelikli`,
  };
}

/**
 * Kamera güncellemesi ŞİMDİ uygulanmalı mı — güncelleme fırtınası kapısı.
 *
 * `true` dönerse çağıran kamerayı sürer; `false` dönerse güncelleme BASTIRILIR
 * (LAB'da sayılır). Profil/durum değişimi eşiği ATLAR — rejim değişimi
 * gecikmemelidir.
 */
export function shouldApplyCameraUpdate(input: {
  readonly nowMs: number;
  readonly lastAppliedMs: number;
  readonly prevDecision: CameraPolicyDecision | null;
  readonly nextDecision: CameraPolicyDecision;
  readonly prevSpeedKmh: number;
  readonly speedKmh: number;
}): boolean {
  const { nowMs, lastAppliedMs, prevDecision, nextDecision, prevSpeedKmh, speedKmh } = input;
  if (!nextDecision.cameraDriveAllowed) return false;
  if (prevDecision === null) return true;
  // Rejim değişimi gecikemez.
  if (prevDecision.state !== nextDecision.state) return true;
  if (prevDecision.profileId !== nextDecision.profileId) return true;
  if (prevDecision.maneuverBand !== nextDecision.maneuverBand) return true;
  // Asgari aralık dolmadıysa uygulama.
  if (nowMs - lastAppliedMs < CAMERA_MIN_UPDATE_MS) return false;
  // Küçük hız değişimi profil değiştirmez → gereksiz kamera işi yapma.
  if (Math.abs(speedKmh - prevSpeedKmh) < CAMERA_SPEED_EPS_KMH) return false;
  return true;
}
