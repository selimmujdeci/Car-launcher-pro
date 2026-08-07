/**
 * navigationSessionRuntime.ts — navigasyon oturumunun GÖRÜNÜMDEN BAĞIMSIZ tick sahibi.
 *
 * ── ÇÖZDÜĞÜ ARIZA (NAVIGATION_MINI_MAP_SESSION_CONTINUITY_P0) ───────────────
 * Rota ilerlemesi (`updateRouteProgress` + `updateNavigationProgress`) YALNIZ
 * `FullMapView`'ın kendi `onGPSLocation` aboneliğinden besleniyordu. Tam ekran
 * kapanınca bileşen unmount olur, abonelik ölür ve TEK bir kullanıcı hareketiyle
 * şunların HEPSİ birden donardı:
 *   • kalan mesafe · ETA · adım sayacı (sıradaki manevra)
 *   • kademeli sesli yönlendirme
 *   • sapma tespiti / reroute tetiklemesi
 *   • varış (ARRIVED) tespiti
 * Yani "tam ekranı kapat" fiilen "navigasyonu dondur" demekti; ürün de bu yüzden
 * kapatmayı iptalle eş tutmak zorunda kalıyordu.
 *
 * Bu modül aynı çağrıları uygulama ömrü boyunca yaşayan TEK abonelikten yapar.
 * Görünüm (tam ekran / mini harita) artık yalnız ÇİZER; ilerlemeyi HESAPLAMAZ.
 *
 * ── SINIRLAR (bilinçli) ─────────────────────────────────────────────────────
 * • Yeni rota motoru YOK, yeni eşik YOK, yeni durum YOK — yalnız SAHİPLİK taşındı.
 * • Reroute · map matching · route validation · varış eşikleri bu modülde
 *   OKUNMAZ ve DEĞİŞTİRİLMEZ; hepsi çağrılan mevcut fonksiyonların içinde kalır.
 * • Timer YOK — kadans GPS fix'inin kendi kadansıdır (motor eskiden de bu
 *   kadanstaydı; frekans değişmedi).
 * ── NAVIGATION_DELIVERY_CORE_P0 EKİ (2026-08-04) ────────────────────────────
 * Yukarıdaki başlık "kademeli sesli yönlendirme"nin de çözüldüğünü yazıyordu
 * ama ÇÖZÜLMEMİŞTİ: motor yalnız store'u güncelliyordu; sesi tetikleyen efekt
 * hâlâ `NavigationHUD` içindeydi ve o bileşen yalnız `FullMapView`'da mount
 * ediliyordu → tam ekran kapanınca **anonslar susuyordu**. Aynı şekilde ölü
 * hesaplama (DR) beslemesi de `FullMapView`'ın RAF döngüsündeydi → mini
 * haritadayken tünelde mesafe/ETA/adım DONUYORDU.
 *
 * Bu turda ikisi de buraya alındı:
 *   • Sesli yönlendirme → `voiceGuidanceRuntime` (bu modül besler).
 *   • DR ilerleme beslemesi → aşağıdaki `_drTimer` (GPS fix YOKKEN 1 Hz).
 * Görünüm artık yalnız ÇİZER. Timer sahipliği TEK yerdedir: bu modül.
 */

import { onGPSLocation } from '../gpsService';
import { getRouteState, updateRouteProgress } from '../routingService';
import {
  NavStatus,
  getNavigationState,
  updateNavigationProgress,
  getNavSessionId,
} from '../navigationService';
import { markFirstNewInstruction } from './core/routeRequestLedger';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import {
  projectDeadReckon, resolveDrSpeed, DR_MAX_DT_SEC,
} from '../../utils/interpolation';
import {
  noteVoiceGuidanceTick, resetVoiceGuidance,
} from './voiceGuidanceRuntime';
import {
  noteMotionSample, resetMarkerMotion, registerMotionFeeder,
} from './navMarkerMotionRuntime';
import { logError } from '../crashLogger';

/* ── Gözlem sayaçları (CAROS LAB · salt-okunur, koordinat TAŞIMAZ) ─────────── */

let _unsub: (() => void) | null = null;
let _tickCount        = 0;
let _lastTickAtMs: number | null = null;   // performance.now()
let _lastObservedStatus: string | null = null;
let _skippedNoFix     = 0;
let _skippedInactive  = 0;
let _errorCount       = 0;
let _lastErrorAtMs: number | null = null;
let _startedAtMs: number | null = null;

/* ── Ölü hesaplama (DR) sahipliği ───────────────────────────────────────────
 * GPS fix'i KESİLDİĞİNDE geri çağrı gelmez → bu yolu bir zamanlayıcı sürmek
 * zorundadır. Zamanlayıcı YALNIZ burada vardır (tek sahiplik); `FullMapView`
 * kendi RAF'ında yalnız MARKER/KAMERA çizer, ilerleme BESLEMEZ. */

/** DR beslemesi kadansı — eski `FullMapView` davranışıyla aynı (1 Hz). */
const DR_FEED_INTERVAL_MS = 1_000;
/** Son fix bu süreden eskiyse GPS bayat sayılır (eski davranışla aynı). */
const GPS_STALE_MS = 5_000;

export type DrRuntimeState =
  /** GPS taze — DR gerekmiyor. */
  | 'GPS_FRESH'
  /** GPS bayat, DR ilerlemeyi sürüyor. */
  | 'DR_ACTIVE'
  /** GPS bayat ama hız yok/güven bitti → ilerleme DURDU (sahte ilerleme yok). */
  | 'DR_EXPIRED'
  /** Navigasyon aktif değil. */
  | 'IDLE';

export const DR_RUNTIME_STATE_LABEL: Readonly<Record<DrRuntimeState, string>> = {
  GPS_FRESH:  'GPS TAZE',
  DR_ACTIVE:  'DR SÜRÜYOR',
  DR_EXPIRED: 'DR GÜVENİ BİTTİ (ilerleme durdu)',
  IDLE:       'BOŞTA',
} as const;

interface _LastFix {
  lat: number; lng: number; heading: number; ts: number; speedMs: number | null;
}

let _drTimer: ReturnType<typeof setInterval> | null = null;
let _releaseMotionFeeder: (() => void) | null = null;
let _lastFix: _LastFix | null = null;
let _drState: DrRuntimeState = 'IDLE';
let _drTickCount = 0;
/** DR ile kat edildiği TAHMİN edilen mesafe (m) — yalnız gözlem içindir. */
let _drDistanceM = 0;
/** [0..1] — GPS kaybının üzerinden geçen süreyle azalır; 0'da ilerleme durur. */
let _drConfidence = 0;

/** Salt-okunur çalışma görüntüsü — CAROS LAB gözlem yüzeyi için. */
export interface NavigationSessionRuntimeSnapshot {
  /** Abonelik ayakta mı (uygulama ömrü boyunca tek örnek). */
  readonly running: boolean;
  /** Kaç GPS fix'i ilerleme motoruna işlendi. */
  readonly tickCount: number;
  /** Son işlenen tick'in üzerinden geçen süre (ms) — `null` = hiç işlenmedi. */
  readonly lastTickAgeMs: number | null;
  /** Motorun en son GÖRDÜĞÜ navigasyon durumu — `null` = hiç okunmadı. */
  readonly lastObservedStatus: string | null;
  /** Fix gelmediği için atlanan çağrı sayısı. */
  readonly skippedNoFix: number;
  /** Navigasyon ACTIVE/REROUTING olmadığı için atlanan çağrı sayısı. */
  readonly skippedInactive: number;
  /** Motor içinden dışarı kaçan hata sayısı (fail-soft ile yutuldu). */
  readonly errorCount: number;
  /** Son hatanın üzerinden geçen süre (ms) — `null` = hata yok. */
  readonly lastErrorAgeMs: number | null;
  /** Runtime'ın ayakta kalma süresi (ms) — `null` = çalışmıyor. */
  readonly uptimeMs: number | null;
  /* ── Ölü hesaplama (DR) — görünümden BAĞIMSIZ ─────────────────────────── */
  readonly drState: DrRuntimeState;
  /** DR'nin sahibi — görünüm ASLA olamaz. */
  readonly drOwner: 'NAV_SESSION_RUNTIME';
  /** Kaç DR tick'i ilerleme motoruna işlendi. */
  readonly drTickCount: number;
  /** DR ile kat edildiği tahmin edilen mesafe (m) — gözlem. */
  readonly drDistanceMeters: number;
  /** DR güveni [0..1] — 0 olduğunda ilerleme DURUR. */
  readonly drConfidence: number;
  /** DR zamanlayıcısı ayakta mı (tek sahiplik kanıtı). */
  readonly drTimerRunning: boolean;
}

/**
 * Oturum motorunu başlat. SystemBoot Wave 3'ten TEK kez çağrılır.
 * İdempotent: ikinci çağrı yeni abonelik AÇMAZ (çift tick = çift sesli anons
 * + çift adım ilerlemesi demek olurdu).
 *
 * @returns durdurma fonksiyonu (SystemBoot `_reg` sözleşmesi).
 */
export function startNavigationSessionRuntime(): () => void {
  if (_unsub) return stopNavigationSessionRuntime;

  _startedAtMs = _now();
  /* Bu runtime işaret hareketinin TEK besleyicisidir. Kayıt LAB'da sayılır:
     birden fazla besleyici görünüyorsa ikinci bir motion runtime doğmuş
     demektir (kilit). */
  _releaseMotionFeeder = registerMotionFeeder();

  _unsub = onGPSLocation((loc) => {
    if (!loc) { _skippedNoFix++; return; }

    let status: string;
    let hasDestination: boolean;
    try {
      const nav = getNavigationState();
      status = nav.status;
      hasDestination = !!nav.destination;
    } catch (e) {
      _errorCount++; _lastErrorAtMs = _now();
      logError('NavSessionRuntime:state', e);
      return;
    }
    _lastObservedStatus = status;

    // İlerleme YALNIZ canlı rota varken anlamlıdır — PREVIEW/ROUTING'de rota
    // henüz sürülmüyor. Bu kapı, motorun eski (görünüm içi) hâliyle BİREBİR aynı.
    if (status !== NavStatus.ACTIVE && status !== NavStatus.REROUTING) {
      _skippedInactive++;
      _onNavigationInactive();
      return;
    }
    if (!hasDestination) { _skippedInactive++; _onNavigationInactive(); return; }

    try {
      /* Son GEÇERLİ fix kaydı — DR bu noktadan ileri projeksiyon yapar.
         Eskiden bu tampon `FullMapView.navPointsRef` idi ve bileşenle ölüyordu. */
      _lastFix = {
        lat: loc.latitude, lng: loc.longitude,
        heading: Number.isFinite(loc.heading ?? NaN) ? (loc.heading as number) : 0,
        ts: _now(),
        speedMs: Number.isFinite(loc.speed ?? NaN) ? (loc.speed as number) : null,
      };
      _drState = 'GPS_FRESH';
      _drConfidence = 1;

      /* İşaret hareketi TEK runtime'dan beslenir — görünümler kendi ara değer
         motorunu KURMAZ. Mini harita eskiden marker'ı doğrudan bu geri çağrıda
         çiziyordu (2 Hz → zıplama); artık ikisi de paylaşılan konumu okur. */
      noteMotionSample({
        lat: loc.latitude, lon: loc.longitude,
        headingDeg: Number.isFinite(loc.heading ?? NaN) ? (loc.heading as number) : null,
        speedKmh: useUnifiedVehicleStore.getState().speed ?? 0,
        accuracyM: Number.isFinite(loc.accuracy ?? NaN) ? (loc.accuracy as number) : null,
        tsMs: _lastFix.ts,
        matched: false,
      });

      // Geometri TEK otoriteden okunur (routingService store'u). Eskiden görünüm
      // içindeki `routeGeometryRef` kopyasından okunuyordu — bileşenle ölen kopya.
      const geometry = getRouteState().geometry;
      updateRouteProgress(loc.latitude, loc.longitude);
      updateNavigationProgress(
        loc.latitude,
        loc.longitude,
        loc.heading ?? 0,
        geometry && geometry.length >= 2 ? geometry : undefined,
      );
      _tickCount++;
      _lastTickAtMs = _now();
      _feedVoiceGuidance(status);
      _ensureDrTimer();
    } catch (e) {
      // Fail-soft: ilerleme hesabındaki bir hata navigasyonu ÖLDÜRMEZ; bir
      // sonraki fix'te yeniden denenir. Hata sayacı LAB'da görünür.
      _errorCount++; _lastErrorAtMs = _now();
      logError('NavSessionRuntime:tick', e);
    }
  });

  return stopNavigationSessionRuntime;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sesli yönlendirme beslemesi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * İlerleme güncellendikten SONRA sesli yönlendirmeyi değerlendirir.
 *
 * Karar `voiceGuidanceRuntime`dedir; burada yalnız bağlam toplanır. Hem gerçek
 * GPS hem DR tick'inden çağrılır → tünelde de yönlendirme sürer.
 */
function _feedVoiceGuidance(status: string): void {
  try {
    const rs = getRouteState();
    const nextStep = rs.steps[rs.currentStepIndex + 1];
    if (!nextStep) return;   // sıradaki manevra yok → söylenecek bir şey yok
    const speedKmh = useUnifiedVehicleStore.getState().speed ?? 0;
    noteVoiceGuidanceTick(
      {
        navActive: true,
        isRerouting: status === NavStatus.REROUTING,
        sessionId: getNavSessionId(),
        routeRevision: rs.routeRevision,
        stepIndex: rs.currentStepIndex,
        instruction: nextStep.instruction,
        distanceM: rs.distanceToNextTurnMeters,
        distanceSource: rs.distanceToNextTurnSource,
        speedKmh,
      },
      undefined,
      () => markFirstNewInstruction(_now()),
    );
  } catch (e) {
    // Sesli yönlendirme hatası ilerlemeyi ASLA bozmaz.
    _errorCount++; _lastErrorAtMs = _now();
    logError('NavSessionRuntime:voice', e);
  }
}

/** Navigasyon aktif değil → ses ve DR durumunu temizle (tek yerden). */
function _onNavigationInactive(): void {
  if (_drTimer !== null) { clearInterval(_drTimer); _drTimer = null; }
  _lastFix = null;
  _drState = 'IDLE';
  _drDistanceM = 0;
  _drConfidence = 0;
  resetVoiceGuidance('navigasyon aktif değil');
  resetMarkerMotion();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ölü hesaplama (DR) — GPS fix YOKKEN ilerlemeyi sürdürür
 * ════════════════════════════════════════════════════════════════════════ */

/** DR zamanlayıcısını kurar (idempotent — çift timer = çift ilerleme olurdu). */
function _ensureDrTimer(): void {
  if (_drTimer !== null) return;
  _drTimer = setInterval(_drTick, DR_FEED_INTERVAL_MS);
}

/**
 * DR tick'i — YALNIZ GPS bayatken iş yapar.
 *
 * ── ÇİFT İLERLEME NEDEN İMKÂNSIZ ────────────────────────────────────────────
 * `updateRouteProgress` birikimli DEĞİLDİR: verilen konumu rota üzerine
 * eşleştirip **mutlak** kalan mesafe/süre üretir. Aynı mesafe iki kez
 * EKLENEMEZ. Ayrıca DR yalnız son fix `GPS_STALE_MS`'ten eskiyken çalışır;
 * gerçek fix geldiği anda `_lastFix.ts` tazelenir ve bu tick erken döner.
 *
 * ── SAHTE İLERLEME YASAK ────────────────────────────────────────────────────
 * Hız kaynağı yoksa (OBD bayat + son GPS hızı 0) projeksiyon YAPILMAZ.
 * GPS kaybı `DR_MAX_DT_SEC`'i aşarsa güven 0'a iner ve ilerleme DURUR.
 */
function _drTick(): void {
  try {
    const nav = getNavigationState();
    if (nav.status !== NavStatus.ACTIVE && nav.status !== NavStatus.REROUTING) {
      _onNavigationInactive();
      return;
    }
    const fix = _lastFix;
    if (!fix) { _drState = 'IDLE'; return; }

    const now = _now();
    const ageMs = now - fix.ts;
    if (ageMs <= GPS_STALE_MS) { _drState = 'GPS_FRESH'; _drConfidence = 1; return; }

    const ageSec = ageMs / 1000;
    // Güven GPS kaybıyla doğrusal azalır; DR_MAX_DT_SEC'te 0 olur.
    _drConfidence = Math.max(0, 1 - ageSec / DR_MAX_DT_SEC);
    if (_drConfidence <= 0) { _drState = 'DR_EXPIRED'; return; }

    /* Hız: ARACIN kendi doğrulanmış hızı > son geçerli GPS hızı.
       `UnifiedVehicleStore.speed` zaten `obdService.getObdSpeedFresh()` tazelik
       kapısından geçmiştir (store sözleşmesi) — bayat OBD hızı buraya ULAŞMAZ.
       İkisi de yoksa projeksiyon YAPILMAZ (sahte ilerleme yasak). */
    const vehicleKmh = useUnifiedVehicleStore.getState().speed ?? 0;
    const speedKmh = resolveDrSpeed(vehicleKmh, fix.speedMs);
    if (!(speedKmh >= 1)) { _drState = 'DR_EXPIRED'; return; }

    const { lat, lng } = projectDeadReckon(
      { lat: fix.lat, lng: fix.lng, heading: fix.heading, ts: fix.ts }, speedKmh, now,
    );

    const geometry = getRouteState().geometry;
    /* allowReroute:false — DR projeksiyonu virajda rotadan doğal olarak sapar;
       sahte reroute internet yokken gerçek rotayı düz-çizgiyle değiştirirdi.
       Bu sözleşme eski (görünüm-içi) hâliyle BİREBİR aynıdır. */
    updateRouteProgress(lat, lng, { allowReroute: false });
    updateNavigationProgress(lat, lng, fix.heading,
      geometry && geometry.length >= 2 ? geometry : undefined);

    /* DR konumu da işaret hareketini besler → tünelde mini haritada da araç
       akıcı ilerler. Doğruluk `null`: DR bir ÖLÇÜM değil PROJEKSİYONdur. */
    noteMotionSample({
      lat, lon: lng,
      headingDeg: fix.heading,
      speedKmh,
      accuracyM: null,
      tsMs: now,
      matched: false,
    });

    _drDistanceM = (speedKmh / 3.6) * Math.min(ageSec, DR_MAX_DT_SEC);
    _drState = 'DR_ACTIVE';
    _drTickCount++;
    _feedVoiceGuidance(nav.status);
  } catch (e) {
    _errorCount++; _lastErrorAtMs = _now();
    logError('NavSessionRuntime:dr', e);
  }
}

/** Aboneliği bırak (Zero-Leak). Sayaçlar gözlem için KORUNUR. */
export function stopNavigationSessionRuntime(): void {
  // DR zamanlayıcısı abonelikten BAĞIMSIZ kapatılır (Zero-Leak): abonelik hiç
  // kurulmamış olsa bile timer kalmış olabilir.
  if (_drTimer !== null) { clearInterval(_drTimer); _drTimer = null; }
  _lastFix = null;
  _drState = 'IDLE';
  _drConfidence = 0;
  resetVoiceGuidance('runtime durduruldu');
  resetMarkerMotion();
  _releaseMotionFeeder?.();
  _releaseMotionFeeder = null;
  if (!_unsub) return;
  try { _unsub(); } catch { /* abonelik zaten düşmüş olabilir */ }
  _unsub = null;
  _startedAtMs = null;
}

/** Motor ayakta mı — regresyon kilitleri ve LAB için. */
export function isNavigationSessionRuntimeRunning(): boolean {
  return _unsub !== null;
}

/** Tek senkron okuma — çağrıldığı anın anlık görüntüsü. */
export function getNavigationSessionRuntimeSnapshot(): NavigationSessionRuntimeSnapshot {
  const now = _now();
  return {
    running:            _unsub !== null,
    tickCount:          _tickCount,
    lastTickAgeMs:      _lastTickAtMs  !== null ? Math.max(0, Math.round(now - _lastTickAtMs))  : null,
    lastObservedStatus: _lastObservedStatus,
    skippedNoFix:       _skippedNoFix,
    skippedInactive:    _skippedInactive,
    errorCount:         _errorCount,
    lastErrorAgeMs:     _lastErrorAtMs !== null ? Math.max(0, Math.round(now - _lastErrorAtMs)) : null,
    uptimeMs:           _startedAtMs   !== null ? Math.max(0, Math.round(now - _startedAtMs))   : null,
    drState:            _drState,
    drOwner:            'NAV_SESSION_RUNTIME',
    drTickCount:        _drTickCount,
    drDistanceMeters:   Math.round(_drDistanceM),
    drConfidence:       Math.max(0, Math.min(1, _drConfidence)),
    drTimerRunning:     _drTimer !== null,
  };
}

/** YALNIZ testler için — sayaçları ve aboneliği sıfırla. */
export function _resetNavigationSessionRuntimeForTest(): void {
  stopNavigationSessionRuntime();
  _tickCount = 0;
  _lastTickAtMs = null;
  _lastObservedStatus = null;
  _skippedNoFix = 0;
  _skippedInactive = 0;
  _errorCount = 0;
  _lastErrorAtMs = null;
  _drTickCount = 0;
  _drDistanceM = 0;
  _drConfidence = 0;
  _drState = 'IDLE';
  _lastFix = null;
}

/** @internal — testler DR yolunu fix beklemeden sürebilsin. */
export function _drTickForTest(): void { _drTick(); }

/** @internal — testler için son fix'i doğrudan kurar. */
export function _setLastFixForTest(fix: {
  lat: number; lng: number; heading: number; ts: number; speedMs: number | null;
} | null): void {
  _lastFix = fix;
}

function _now(): number {
  try { return performance.now(); } catch { return 0; }
}
