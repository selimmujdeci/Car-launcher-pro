/**
 * navEgoHorizonBridge.ts — L2 EGO + L3 CEH'in CANLI AKIŞA BAĞLANMASI (F3).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.0 (F2 borcu **C2**) · §F3.3.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NEDİR ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * **Bileşim köküdür (composition root)** — katman DEĞİLDİR. Tek işi, tik
 * sahibinin (`navigationSessionRuntime`) elindeki gözlemi doğru otoritelere
 * doğru sırayla vermektir:
 *
 *   GPS/DR tick → `egoAuthority.observe()` → rota niyeti İT → `ceh.observe()`
 *
 * ── NEDEN AYRI DOSYA ─────────────────────────────────────────────────────
 * L3 (CEH) L4'ü (routing) import EDEMEZ — F0 bağımlılık yasası yönlüdür
 * (`L4 → L3`) ve ters kenar grafiği DÖNGÜLÜ yapar. Rota niyeti bu yüzden
 * L3'e **itilir**; iten taraf katmanların dışındaki bu köktür. Böylece
 * `navigation/horizon/**` ağacında tek bir L4 importu bile bulunmaz
 * (kilit test kaynak taramasıyla denetler).
 *
 * ── YENİ SAHİPLİK KURULMAZ ───────────────────────────────────────────────
 * Burada **timer YOK · yeni GPS aboneliği YOK · scheduler YOK**. İkinci bir
 * GPS aboneliği çift ilerleme, çift anons ve çift ego adımı demek olurdu.
 * Kadans, tik sahibinin mevcut kadansıdır (GPS fix + 1 Hz DR).
 *
 * ── FAIL-SOFT ────────────────────────────────────────────────────────────
 * Bu köprüdeki HİÇBİR hata mevcut navigasyonu düşürmez: ego/ufuk yayınlanmaz,
 * sayaç artar, rota ilerlemesi aynen sürer.
 */

import { getEgoAuthority } from './ego/egoAuthority';
import { getCehAuthority } from './horizon/cehAuthority';
import type { RouteIntentSnapshot, RouteIntentManeuver } from './horizon/routeIntent';
import { NO_ROUTE_INTENT } from './horizon/routeIntent';
import { readMonotonicNow } from './time/navClock';
import { acquireNavOrientationFeed, noteNavHeadingObservation } from './navOrientationFeed';
/* F4: yol ağı grafı ana iş parçacığında TALEP-GÜDÜMLÜ çözülür — oturumla
   alınır, oturumla bırakılır (boşta ~12 MB taşımanın karşılığı yoktur). */
import { acquireRoutingGraph, releaseRoutingGraph } from './map/graph/graphResidencyRuntime';
/* F5: gölge karşılaştırma. Yan etkisi YOKTUR (ses/uyarı/store yazımı yok) ve
   üretim otoritesini DEĞİŞTİRMEZ — yalnız legacy ↔ CEH farkını ÖLÇER. */
import { noteCehShadowTick, resetCehShadow } from './shadow/cehShadowRuntime';
/* F6: denetim noktası öznitelik portu. `horizon/**` DIŞINDA yaşar (ham
   sağlayıcıyı yalnız bileşim kökü görür) ve CEH'e SONRADAN bağlanır —
   CEH bu portun ARKASINDAKİ hiçbir modülü import ETMEZ. */
import { createEnforcementHorizonAttributePorts } from './enforcementHorizonPort';
import {
  getRouteState, getNavigationCoreSnapshot, REROUTE_THRESHOLD_M,
} from '../routingService';
import { getNavSessionId } from '../navigationService';

/* ══════════════════════════════════════════════════════════════════════════
   1) GÖZLEM SAYAÇLARI (LAB — koordinat TAŞIMAZ)
   ══════════════════════════════════════════════════════════════════════════ */

let _ticks = 0;
let _headingNotes = 0;
let _routeIntentPushes = 0;
let _errors = 0;
let _lastErrorAtMonoMs: number | null = null;
let _releaseOrientation: (() => void) | null = null;
let _graphAcquired = false;
/* F6: port TEK KEZ kurulur (kendi durumu var — çağrı sayaçları) ve CEH'e
   HER oturum açılışında yeniden bağlanır (bağlama ucuz, port aynı nesne). */
let _enforcementPort: ReturnType<typeof createEnforcementHorizonAttributePorts> | null = null;

export interface NavEgoHorizonBridgeSnapshot {
  /** Jiro beslemesi bu oturumda alındı mı (dengeli ömür kanıtı). */
  readonly orientationAcquired: boolean;
  /** Yol ağı grafı bu oturumda istendi mi (dengeli ömür kanıtı). */
  readonly graphAcquired: boolean;
  /** Kaç kez ego+ufuk adımı işlendi. */
  readonly ticks: number;
  /** Kaç GNSS yön gözlemi işaret öğrenmeye itildi. */
  readonly headingNotes: number;
  /** Kaç kez rota niyeti CEH'e itildi. */
  readonly routeIntentPushes: number;
  readonly errorCount: number;
  readonly lastErrorAgeMs: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) OTURUM ÖMRÜ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Oturum kaynaklarını al. **İdempotent**: ikinci çağrı ikinci abonelik AÇMAZ.
 *
 * TALEP-GÜDÜMLÜ: tik sahibi bunu YALNIZ navigasyon aktifken çağırır; uygulama
 * ömrü boyunca tutmak, navigasyon kapalıyken de 60 Hz sensör beslemesi demek
 * olurdu.
 */
export function acquireEgoHorizonSession(): void {
  /* F6: bağlama BAĞIMSIZ bir idempotent adımdır — session guard'ının
     (`_releaseOrientation !== null`) İÇİNE alınmaz, aksi hâlde ikinci
     acquire çağrısı (hata sonrası yeniden deneme) portu HİÇ bağlamayabilirdi. */
  try {
    if (_enforcementPort === null) _enforcementPort = createEnforcementHorizonAttributePorts();
    getCehAuthority().bindAttributePorts(_enforcementPort);
  } catch {
    _errors++;
    _lastErrorAtMonoMs = readMonotonicNow();
  }

  if (_releaseOrientation !== null) return;
  try {
    _releaseOrientation = acquireNavOrientationFeed();
  } catch {
    _errors++;
    _lastErrorAtMonoMs = readMonotonicNow();
    _releaseOrientation = null;
  }
  try {
    /* Fire-and-forget: yükleme tamamlanana kadar aday kaynağı dürüstçe
       "ölçülmedi" der; hazır olunca aynı tik zinciri onu kullanmaya başlar.
       Hata yutulur — graf yoksa navigasyon aynen sürer (fail-soft). */
    void acquireRoutingGraph().catch(() => { /* durum otoriteye bildirildi */ });
    _graphAcquired = true;
  } catch {
    _errors++;
    _lastErrorAtMonoMs = readMonotonicNow();
  }
}

/**
 * Oturum kaynaklarını bırak (Zero-Leak). `navigationSessionRuntime.stop`
 * çağırır. Çift çağrı güvenlidir.
 */
export function releaseEgoHorizonSession(): void {
  if (_graphAcquired) {
    _graphAcquired = false;
    try { releaseRoutingGraph(); } catch { /* fail-soft */ }
  }
  const r = _releaseOrientation;
  _releaseOrientation = null;
  if (r === null) return;
  try { r(); } catch { /* kapı zaten düşmüş olabilir */ }
  try {
    getEgoAuthority().reset();
    getCehAuthority().reset();
    /* F5: gölge defteri de oturumla düşer — eski yolculuğun farkları yeni
       oturumun cutover kanıtı SAYILAMAZ. */
    resetCehShadow();
  } catch { /* fail-soft */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ROTA NİYETİ — L4'ten salt-okunur projeksiyon
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Aktif rotayı CEH'in anlayacağı NİYET projeksiyonuna çevirir.
 *
 * Hiçbir yeni ölçüm YAPILMAZ: rota-göreli ilerleme (`alongRemainingM`) ve
 * manevra çapaları L4'ün KENDİ hesaplarıdır; burada yalnız okunup taşınır.
 * Sürücüye gösterilen TALİMAT METNİ taşınmaz (CEH sunum katmanı değildir).
 */
export function readRouteIntent(nowMonoMs: number | null): RouteIntentSnapshot {
  try {
    const rs = getRouteState();
    const geometry = rs.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) return NO_ROUTE_INTENT;

    const core = getNavigationCoreSnapshot();
    const fix = core?.fix ?? null;

    const anchors = rs.maneuverAnchors;
    const steps = rs.steps;
    const maneuvers: RouteIntentManeuver[] = [];
    if (Array.isArray(anchors) && Array.isArray(steps)) {
      for (const a of anchors) {
        const step = steps[a?.stepIndex ?? -1];
        if (!step) continue;
        maneuvers.push({
          stepIndex: a.stepIndex,
          alongRemainingM: typeof a.alongRemainingM === 'number'
            && Number.isFinite(a.alongRemainingM) ? a.alongRemainingM : null,
          maneuverType: step.maneuverType ?? 'unknown',
          maneuverModifier: step.maneuverModifier ?? 'unknown',
        });
      }
    }

    return {
      available: true,
      sessionId: getNavSessionId(),
      routeRevision: typeof rs.routeRevision === 'number' ? rs.routeRevision : 0,
      observedAtMonoMs: nowMonoMs as RouteIntentSnapshot['observedAtMonoMs'],
      /* Rota-göreli ilerleme L4 ölçümüdür; eşleşme güvenilir değilse `null`
         kalır ve CEH mesafe İDDİA ETMEZ (uydurma mesafe yasak). */
      vehicleAlongRemainingM: fix !== null && fix.state === 'MATCHED'
        ? fix.alongRemainingM
        : null,
      totalDistanceM: typeof rs.totalDistanceMeters === 'number'
        ? rs.totalDistanceMeters : null,
      maneuvers,
      geometry,
      onCorridor: fix !== null && fix.state === 'MATCHED',
      /* Çelişki eşiği L4'ün KENDİ sapma eşiğidir — L3'e itilir. */
      conflictThresholdM: REROUTE_THRESHOLD_M,
    };
  } catch {
    _errors++;
    _lastErrorAtMonoMs = nowMonoMs;
    return NO_ROUTE_INTENT;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) TİK
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * GNSS yön gözlemini işaret öğrenmeye iter. Tik sahibi, elindeki fix ile
 * çağırır — bu dosya GPS sağlayıcısı SAHİPLENMEZ.
 *
 * @param headingDeg GNSS gidiş yönü (derece) · `null` = yok
 * @param speedMps   anlık hız (m/s) — yavaşta yön gürültüdür, kanıt sayılmaz
 */
export function noteEgoHeadingFix(headingDeg: number | null, speedMps: number | null): void {
  try {
    noteNavHeadingObservation(headingDeg, speedMps, readMonotonicNow());
    _headingNotes++;
  } catch {
    _errors++;
    _lastErrorAtMonoMs = readMonotonicNow();
  }
}

/**
 * Tek ego + ufuk adımı. **Tik sahibi çağırır**; burada timer YOKTUR.
 *
 * Sıra bilinçlidir: önce ego (ufkun çapası), sonra rota niyeti (girdi),
 * en son ufuk. Ters sırada ufuk BİR TİK ESKİ ego ile kurulurdu.
 */
export function tickEgoHorizon(): void {
  const now = readMonotonicNow();
  try {
    getEgoAuthority().observe();
  } catch {
    _errors++;
    _lastErrorAtMonoMs = now;
  }

  try {
    const ceh = getCehAuthority();
    ceh.noteRouteIntent(readRouteIntent(now));
    _routeIntentPushes++;
    ceh.observe();
  } catch {
    _errors++;
    _lastErrorAtMonoMs = now;
  }

  /* F5/GÖLGE: ufuk YAYINLANDIKTAN SONRA legacy ↔ CEH farkı ölçülür. Ayrı
     try/catch: gölge ölçümündeki bir hata ego/ufuk adımını ASLA düşürmez ve
     bu çağrı hiçbir kullanıcı-görünür etki üretmez (kilit test denetler). */
  try {
    noteCehShadowTick();
  } catch {
    _errors++;
    _lastErrorAtMonoMs = now;
  }

  _ticks++;
}

/** L4'ün KENDİ sapma eşiği — CEH çelişki kapısı bu sayıyı kullanır. */
export const ROUTE_CONFLICT_THRESHOLD_M = REROUTE_THRESHOLD_M;

/* ══════════════════════════════════════════════════════════════════════════
   5) GÖZLEM
   ══════════════════════════════════════════════════════════════════════════ */

export function getNavEgoHorizonBridgeSnapshot(): NavEgoHorizonBridgeSnapshot {
  const now = readMonotonicNow();
  return {
    orientationAcquired: _releaseOrientation !== null,
    graphAcquired: _graphAcquired,
    ticks: _ticks,
    headingNotes: _headingNotes,
    routeIntentPushes: _routeIntentPushes,
    errorCount: _errors,
    lastErrorAgeMs: (now !== null && _lastErrorAtMonoMs !== null)
      ? Math.max(0, Math.round(now - _lastErrorAtMonoMs))
      : null,
  };
}

/** @internal testler arası izolasyon. */
export function _resetNavEgoHorizonBridgeForTest(): void {
  releaseEgoHorizonSession();
  _ticks = 0;
  _headingNotes = 0;
  _routeIntentPushes = 0;
  _errors = 0;
  _lastErrorAtMonoMs = null;
}
