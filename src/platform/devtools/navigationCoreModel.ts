/**
 * navigationCoreModel.ts — CAROS LAB · Navigation Core SAF model katmanı.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Girdi yalnız `NavigationCoreRawSnapshot`; çıktı kart/alan listesi ve hüküm.
 *
 * Gözlemlenebilirlik sınıflandırması `sessionInspectorModel` sözleşmesini
 * KULLANIR (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel sistem YOK.
 */

import {
  observed, derived, unavailable,
  type InspectorField,
} from './sessionInspectorModel';
import type { NavigationCoreRawSnapshot } from './navigationCoreSources';
import { OFF_ROUTE_STATE_LABEL } from '../navigation/core/offRouteModel';
import { ROUTE_VERDICT_LABEL } from '../navigation/core/routeValidationModel';
import { ROUTE_DECIDING_FACTOR_LABEL } from '../navigation/core/routeRationaleModel';
import { ROUTE_COLOR_REASON_LABEL } from '../map/core/routeColorModel';
import {
  PROVIDER_READINESS_LABEL, ROUTE_SOURCE_LABEL,
} from '../navigation/core/routeProviderReadiness';
import {
  ROUTE_CHAIN_LABEL, ROUTE_OUTCOME_LABEL,
} from '../navigation/core/routeProviderLedger';
import { GEOMETRY_INTEGRITY_LABEL } from '../navigation/core/routeGeometryModel';
import {
  NAV_AXIS_LABEL, NAV_AXIS_STATE_LABEL,
} from '../navigation/core/navFailureMatrixModel';
import {
  PROGRESS_VERDICT_LABEL, type ProgressVerdict,
} from '../navigation/core/routeProgressLedger';
import { REROUTE_HEALTH_LABEL } from '../navigation/core/rerouteStarvationModel';
import { REQUEST_OUTCOME_LABEL } from '../navigation/core/routeRequestLedger';
import { offlineGraphStateLabel } from '../navigation/offlineRoutingStatus';
import { SPEED_LIMIT_STATE_LABEL } from '../navigation/core/speedLimitTruthModel';
import {
  EFFECTIVE_LIMIT_STATE_LABEL,
} from '../navigation/core/vehicleAwareSpeedLimitAuthority';
import { ROAD_CLASS_LABEL } from '../navigation/policy/turkeySpeedPolicy';
import { CEH_CUTOVER_CONDITION_LABEL } from '../navigation/shadow/cehCutoverGate';
import {
  VEHICLE_CLASS_STATE_LABEL, LEGAL_CATEGORY_LABEL, BODY_TYPE_LABEL,
} from '../vehicle/legalVehicleClass';
import { RESEARCH_OUTCOME_LABEL } from '../vehicle/vehicleClassResearch';
import { MARKER_MOTION_STATE_LABEL } from '../navigation/core/markerMotionModel';
import { CAMERA_STATE_LABEL } from '../navigation/core/cameraPolicyModel';
import { SHADOW_DIVERGENCE_LABEL } from '../navigation/core/cameraShadowModel';
import { VOICE_RUNTIME_STATE_LABEL } from '../navigation/voiceGuidanceRuntime';
import { STAGE_LABEL } from '../navigation/core/voiceGuidanceModel';
import { DR_RUNTIME_STATE_LABEL } from '../navigation/navigationSessionRuntime';
import { ETA_STATE_LABEL } from '../navigation/core/etaModel';
import {
  DURATION_SOURCE_LABEL, DURATION_INTEGRITY_LABEL,
} from '../navigation/core/routeDurationModel';
import { ANCHOR_METHOD_LABEL } from '../navigation/core/maneuverIndexModel';
import type { MapMatchState } from '../navigation/core/mapMatchModel';
import type { ManeuverDistanceSource } from '../routingService';

export type NavCoreCardId =
  | 'state' | 'provider' | 'matching' | 'offroute'
  | 'reroute' | 'validation' | 'maneuver' | 'truth' | 'session' | 'viewport'
  | 'vehicleclass' | 'delivery' | 'motion' | 'destination' | 'progress' | 'horizon';

export interface NavCoreCard {
  readonly id: NavCoreCardId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export const NAV_CORE_CARD_TITLE: Readonly<Record<NavCoreCardId, string>> = {
  state:      '1 · Navigasyon Durumu',
  provider:   '2 · Rota Sağlayıcı',
  matching:   '3 · Map Matching',
  offroute:   '4 · Sapma Algılama',
  reroute:    '5 · Yeniden Rota (istek + gecikme)',
  validation: '6 · Rota Doğrulama Kapısı',
  maneuver:   '7 · Manevra Mesafesi',
  truth:      '8 · Dürüstlük Sayaçları',
  session:    '9 · Oturum Sürekliliği (görünümden bağımsız motor)',
  viewport:   '10 · Harita Görünümü · Kamera · Hız Limiti',
  vehicleclass: '11 · Araç Sınıfı · Uygulanabilir Hız Sınırı',
  delivery:     '12 · Teslim Çekirdeği (Ses · Ölü Hesaplama · ETA)',
  motion:       '13 · İşaret Hareketi · Takip Kamerası',
  destination:  '14 · Hedef Bütünlüğü (arama → hedef → rota isteği)',
  progress:     '15 · İlerleme Dürüstlüğü (kırpma YOK)',
  horizon:      '16 · L2 Ego · L3 Ufuk (CEH) — NAV v3',
} as const;

export const MAP_MATCH_STATE_LABEL: Readonly<Record<MapMatchState, string>> = {
  MATCHED:         'EŞLEŞTİ',
  MATCH_UNCERTAIN: 'BELİRSİZ',
  OFF_NETWORK:     'KORİDOR DIŞI',
  STALE:           'BAYAT FIX',
  UNKNOWN:         'BİLİNMİYOR',
} as const;

export const MANEUVER_SOURCE_LABEL: Readonly<Record<ManeuverDistanceSource, string>> = {
  ALONG_ROUTE:   'YOL-BOYU (doğru)',
  STRAIGHT_LINE: 'KUŞ UÇUŞU (virajda kısa çıkar)',
  UNKNOWN:       'BİLİNMİYOR',
} as const;

/* ── Genel hüküm ──────────────────────────────────────────────────────────── */

export type NavCoreVerdict =
  | 'IDLE'
  | 'TRACKING'
  | 'DEGRADED_TRACKING'
  | 'REROUTING'
  | 'STRAIGHT_LINE_ONLY'
  | 'NO_PROVIDER'
  | 'UNAVAILABLE';

export const NAV_CORE_VERDICT_LABEL: Readonly<Record<NavCoreVerdict, string>> = {
  IDLE:               'NAVİGASYON YOK',
  TRACKING:           'ARAÇ ROTADA İZLENİYOR',
  DEGRADED_TRACKING:  'İZLEME KUSURLU',
  REROUTING:          'YENİDEN ROTA HESAPLANIYOR',
  STRAIGHT_LINE_ONLY: 'DÜZ HAT YÖNLENDİRME — GERÇEK ROTA YOK',
  NO_PROVIDER:        'ROTA SAĞLAYICISI YOK',
  UNAVAILABLE:        'GÖZLEM YOK',
} as const;

export interface NavCoreVerdictResult {
  readonly status: NavCoreVerdict;
  readonly reasons: readonly string[];
}

/** Fail-closed hüküm: kanıt yoksa "sağlıklı" DENMEZ. */
export function deriveNavCoreVerdict(s: NavigationCoreRawSnapshot): NavCoreVerdictResult {
  const reasons: string[] = [];

  if (!s.isNavigating) {
    return { status: 'IDLE', reasons: ['Aktif navigasyon yok — izleme alanları anlamsızdır.'] };
  }
  if (s.straightLineActive) {
    reasons.push('Aktif kaynak düz hat: yol ağı üzerinde rota YOK, manevra üretilemez.');
    reasons.push('Sapma algılama bilinçli olarak KAPALI (her nokta sapmış görünür).');
    return { status: 'STRAIGHT_LINE_ONLY', reasons };
  }
  if (s.provider.lastSource === 'NONE' && s.onlineHint === false && !s.offlineGraph.usable) {
    return { status: 'NO_PROVIDER', reasons: ['Çevrimiçi değil ve çevrimdışı graf kullanılamıyor.'] };
  }
  if (s.isRerouting || s.offRouteState === 'REROUTING') {
    reasons.push('Sapma doğrulandı, yeni rota isteği uçuşta.');
    return { status: 'REROUTING', reasons };
  }

  if (s.mapMatchState === 'MATCHED' && s.nextManeuverDistanceSource === 'ALONG_ROUTE') {
    reasons.push('Araç rota üzerinde konumlandırıldı ve manevra mesafesi yol-boyu ölçülüyor.');
    return { status: 'TRACKING', reasons };
  }

  if (s.mapMatchState === null) {
    return { status: 'UNAVAILABLE', reasons: ['Henüz hiç konum örneği işlenmedi.'] };
  }
  if (s.mapMatchState !== 'MATCHED') {
    reasons.push(`Eşleştirme durumu ${MAP_MATCH_STATE_LABEL[s.mapMatchState]} — kesin konum iddiası YOK.`);
  }
  if (s.nextManeuverDistanceSource !== 'ALONG_ROUTE') {
    reasons.push(`Manevra mesafesi ${MANEUVER_SOURCE_LABEL[s.nextManeuverDistanceSource]}.`);
  }
  if (s.anchorUnresolvedCount > 0) {
    reasons.push(`${s.anchorUnresolvedCount} manevra geometriye bağlanamadı.`);
  }
  return { status: 'DEGRADED_TRACKING', reasons };
}

/* ── Kartlar ──────────────────────────────────────────────────────────────── */

const _ms = (v: number | null): string => (v == null ? '—' : `${Math.round(v)} ms`);
const _m  = (v: number | null): string => (v == null ? '—' : `${Math.round(v)} m`);
/** Sayı metni — `null` sahte 0 olarak YAZILMAZ (E-11). */
const _n  = (v: number | null): string => (v == null ? '—' : String(v));

/** P0-NAV-10 rota sağlayıcı sicili kaynağı — kart ile alan denetimi aynı etiketi kullanır. */
const SRC_ROUTE_LEDGER = 'routeProviderLedger.getRouteProviderLedger';
/** NAV v3 · F7 rota gerekçesi — kart ile alan denetimi aynı etiketi kullanır. */
const SRC_ROUTE_RATIONALE = 'routeRationaleModel.getRouteRationaleLedger';
/** P0-NAV-11 geometri kanıtı kaynağı. */
const SRC_GEOMETRY = 'routeGeometryModel.getCommittedGeometry';
/** P0-NAV-12 ilerleme defteri kaynağı. */
const SRC_PROGRESS = 'routeProgressLedger.getProgressLedger';
/** P0-NAV-13 reroute sağlığı + engel sebepleri kaynağı. */
const SRC_REROUTE_HEALTH = 'routeRequestLedger.getRerouteBlockStats';
/** P0-NAV-16 sesli yönlendirme denetimi kaynağı. */
const SRC_GUIDANCE_AUDIT = 'voiceGuidanceAudit.getGuidanceAudit';
/** P0-NAV-19 sıcak yol maliyeti kaynağı. */
const SRC_TICK_COST = 'navTickCostModel.getNavTickCostSnapshot';
/** P0-NAV-20 arıza tablosu kaynağı. */
const SRC_MATRIX = 'navFailureMatrixModel.buildNavFailureMatrix';
const SRC_EGO    = 'ego/egoAuthority.getDiagnostics';
const SRC_CEH    = 'horizon/cehAuthority.getDiagnostics';
const SRC_YAW    = 'navOrientationFeed.getSnapshot';
const SRC_BRIDGE = 'navEgoHorizonBridge.getSnapshot';
const SRC_GRAPH  = 'map/graph/graphResidencyRuntime.getSnapshot';
/** NAV v3 · F5 — gölge karşılaştırma + cutover kapısı kaynağı. */
const SRC_CEH_SHADOW = 'shadow/cehShadowRuntime.getSnapshot';
/** NAV v3 · F6 — sınırlı koridor + kenar-tabanlı denetim noktası kaynağı. */
const SRC_ENFORCEMENT_PORT = 'enforcementHorizonPort.getSnapshot';

export function buildNavigationCoreCards(s: NavigationCoreRawSnapshot): readonly NavCoreCard[] {
  const cards: NavCoreCard[] = [];

  /* ── ÖLÇÜM DAMGASI SÖZLEŞMESİ ──────────────────────────────────────────────
   * DÜZELTİLEN YANILTICI METRİK (2026-08-03 hazırlık denetimi):
   * Eskiden alanların TAMAMI `updatedAt: readAt` taşıyordu → ekranda hepsi
   * **"0ms önce"** görünüyordu. İki ayrı sorun:
   *   1. `formatAge`'in kendi sözleşmesini çiğniyordu ("damga yoksa null —
   *      uydurma yok"): sayaçların bağımsız bir ölçüm damgası YOKTUR.
   *   2. DAHA CİDDİSİ: GPS ölse bile GPS türevli alanlar (eşleşme durumu,
   *      dik mesafe, kalan mesafe, ETA) **TAZE görünüyordu.** Sürüş günü
   *      tam olarak bu alanlara bakılacak; donmuş veriyi taze göstermek
   *      saha ölçümünü sessizce çürütürdü.
   *
   * Yeni kural:
   *   · GPS gözleminden TÜREYEN alan → `OBS` (gerçek fix zamanı; YAŞLANIR)
   *   · sayaç · yapılandırma · anlık senkron okuma → `null` (damga YOK)
   *   · bağımsız gerçek damgası olan alan → kendi damgası (yoklama, graf)
   */
  const OBS = s.gpsObservedAtWall;

  /* ── P0-NAV-20 · ARIZA TABLOSU ───────────────────────────────────────────
   * Sürüş sırasında bakılacak TEK satır. Yeni ölçüm YOK — bu gece kurulan
   * otoritelerin hükümlerini toplar. Genel hüküm EN KÖTÜ eksene eşittir:
   * bir eksen çökmüşken "iyi" demek sürücüye yalan söylemektir. */
  const _fm = s.failureMatrix ?? null;

  /* 1 · Durum */
  cards.push({
    id: 'state', title: NAV_CORE_CARD_TITLE.state,
    fields: [
      _fm === null || _fm.axes.length === 0
        ? unavailable({ id: 'fm-overall', label: '⚑ ARIZA TABLOSU (genel)', source: SRC_MATRIX,
            note: 'Tablo okunamadı — sahte "sağlıklı" ÜRETİLMEZ.', updatedAt: null },
            'ölçüm yok')
        : (_fm.overall === 'FAILED' || _fm.overall === 'DEGRADED'
            ? derived({ id: 'fm-overall', label: '⚑ ARIZA TABLOSU (genel)', source: SRC_MATRIX,
                note: _fm.summary, updatedAt: null }, NAV_AXIS_STATE_LABEL[_fm.overall])
            : observed({ id: 'fm-overall', label: '⚑ ARIZA TABLOSU (genel)', source: SRC_MATRIX,
                note: _fm.summary, updatedAt: null }, NAV_AXIS_STATE_LABEL[_fm.overall])),
      _fm === null || _fm.axes.length === 0
        ? unavailable({ id: 'fm-axes', label: 'Eksenler', source: SRC_MATRIX,
            note: '', updatedAt: null }, 'ölçüm yok')
        : observed({ id: 'fm-axes', label: 'Eksenler', source: SRC_MATRIX,
            note: 'Her eksen AYRI bir otoritenin hükmüdür. OBD durumu GİRDİ DEĞİLDİR.',
            updatedAt: null },
            _fm.axes
              .filter((a) => a.state !== 'HEALTHY')
              .map((a) => `${NAV_AXIS_LABEL[a.axis]}=${a.state}`)
              .join(' · ') || 'hepsi sağlıklı'),
      observed({ id: 'nav-status', label: 'Navigasyon durumu', source: 'navigationService',
        note: '', updatedAt: null }, s.navStatus),
      observed({ id: 'nav-active', label: 'Aktif mi', source: 'navigationService',
        note: '', updatedAt: null }, s.isNavigating ? 'EVET' : 'HAYIR'),
      observed({ id: 'nav-dest', label: 'Hedef kayıtlı', source: 'navigationService',
        note: 'Hedef ADI ve koordinatı bu ekrana TAŞINMAZ (gizlilik).', updatedAt: null },
        s.hasDestination ? 'VAR' : 'YOK'),
      s.remainingDistanceM != null
        ? derived({ id: 'nav-remaining', label: 'Kalan rota mesafesi', source: 'navigationService',
            note: 'Rota geometrisi üzerinde yol-boyu.', updatedAt: OBS }, _m(s.remainingDistanceM))
        : unavailable({ id: 'nav-remaining', label: 'Kalan rota mesafesi', source: 'navigationService',
            note: '', updatedAt: OBS }, 'henüz hesaplanmadı'),
      s.etaSeconds != null
        ? derived({ id: 'nav-eta', label: 'ETA', source: 'navigationService',
            note: 'Trafik verisi YOK — yalnız hız geçmişi + durma tamponu.', updatedAt: OBS },
            `${Math.round(s.etaSeconds)} s`)
        : unavailable({ id: 'nav-eta', label: 'ETA', source: 'navigationService', note: '', updatedAt: OBS }),
    ],
  });

  /* 2 · Sağlayıcı */
  /* P0-NAV-10 — sicil okunamamış olabilir; model ÇÖKMEZ, "bilinmiyor" der. */
  const _chain = s.routeChain ?? null;
  cards.push({
    id: 'provider', title: NAV_CORE_CARD_TITLE.provider,
    fields: [
      observed({ id: 'pv-local', label: 'Yerel OSRM hazırlığı', source: 'routeProviderReadiness',
        note: 'Oturumda TEK sınırlı yoklama; yoksa bir daha denenmez.', updatedAt: s.provider.localProbedAtMs },
        PROVIDER_READINESS_LABEL[s.provider.localState]),
      observed({ id: 'pv-probe', label: 'Yoklama / atlanan', source: 'routeProviderReadiness',
        note: 'Atlanan sayısı = her rotada boşuna beklenmeyen istek adedi.', updatedAt: null },
        `${s.provider.localProbeCount} / ${s.provider.localSkippedCount}`),
      s.onlineHint != null
        ? observed({ id: 'pv-online', label: 'Çevrimiçi ipucu', source: 'navigator.onLine',
            note: '', updatedAt: null }, s.onlineHint ? 'EVET' : 'HAYIR')
        : unavailable({ id: 'pv-online', label: 'Çevrimiçi ipucu', source: 'navigator.onLine', note: '' }),
      observed({ id: 'pv-source', label: 'Son kullanılan kaynak', source: 'routeProviderReadiness',
        note: '', updatedAt: null }, ROUTE_SOURCE_LABEL[s.provider.lastSource]),
      s.serverUsed
        ? observed({ id: 'pv-server', label: 'Sunucu', source: 'useRouteStore.serverUsed',
            note: '', updatedAt: null }, s.serverUsed)
        : unavailable({ id: 'pv-server', label: 'Sunucu', source: 'useRouteStore.serverUsed', note: '' }),
      observed({ id: 'pv-graph', label: 'Çevrimdışı graf', source: 'offlineRoutingStatus',
        note: '', updatedAt: s.offlineGraph.lastAttemptAt }, offlineGraphStateLabel(s.offlineGraph.state)),
      observed({ id: 'pv-straight', label: 'Düz hat kullanımı', source: 'routeProviderReadiness',
        note: 'Düz hat NAVİGASYON ROTASI DEĞİLDİR.', updatedAt: null },
        `${s.provider.straightLineCount} kez`),
      observed({ id: 'pv-remote-fail', label: 'Uzak sağlayıcı hatası', source: 'routeProviderReadiness',
        note: '', updatedAt: null }, `${s.provider.remoteFailureCount}`),
      s.routeError
        ? observed({ id: 'pv-error', label: 'Rota hatası', source: 'useRouteStore.error',
            note: '', updatedAt: null }, s.routeError)
        : observed({ id: 'pv-error', label: 'Rota hatası', source: 'useRouteStore.error',
            note: '', updatedAt: null }, 'yok'),

      /* ── P0-NAV-10 · FALLBACK GERÇEĞİ ───────────────────────────────────
       * `pv-server` yalnız KAZANANI yazar. İlk sağlayıcı düşüp ikincisi
       * cevap verdiğinde zincir "sağlıklı" okunur — oysa bu bir DEGRADASYONdur
       * ve her rotada gizli bir gecikme ödenir. Bu satırlar onu görünür kılar. */
      /* `?? null`: model SAF bir OKUYUCUDUR ve anlık görüntüyü kendisi kurmaz —
         alan hiç gelmezse "bilinmiyor" demeli, ÇÖKMEMELİDİR (aynı sözleşme
         `opc-cooldown` satırında da uygulanır). */
      _chain !== null
        ? observed({ id: 'pv-chain', label: 'Son isteğin zincir hükmü', source: SRC_ROUTE_LEDGER,
            note: _chain.why, updatedAt: null }, ROUTE_CHAIN_LABEL[_chain.outcome])
        : unavailable({ id: 'pv-chain', label: 'Son isteğin zincir hükmü', source: SRC_ROUTE_LEDGER,
            note: 'Sicil okunamadı — sahte "sağlıklı" ÜRETİLMEZ.', updatedAt: null }, 'ölçüm yok'),
      _chain === null
        ? unavailable({ id: 'pv-fallback-reason', label: 'Yedeğe düşme sebebi', source: SRC_ROUTE_LEDGER,
            note: '', updatedAt: null }, 'ölçüm yok')
        : _chain.fallbackReason !== null
          ? derived({ id: 'pv-fallback-reason', label: 'Yedeğe düşme sebebi', source: SRC_ROUTE_LEDGER,
              note: `${_chain.degradedSteps} katman düştü.`, updatedAt: null },
              ROUTE_OUTCOME_LABEL[_chain.fallbackReason])
          : observed({ id: 'pv-fallback-reason', label: 'Yedeğe düşme sebebi', source: SRC_ROUTE_LEDGER,
              note: 'Birincil katman cevapladı — degradasyon yok.', updatedAt: null }, 'yok'),
      observed({ id: 'pv-fallback-count', label: 'Yedek kurtarması / düz hat zinciri',
        source: SRC_ROUTE_LEDGER,
        note: 'İkisi de GİZLİ DEGRADASYONdur; sürekli artıyorsa birincil katman hastadır.',
        updatedAt: null },
        `${s.routeFallbackSuccessCount ?? 0} / ${s.routeStraightLineChainCount ?? 0}`),
      /* Sebep DAĞILIMI: dört farklı sınıf dört farklı işi işaret eder
         (eşik/ağ · sağlayıcı kotası · veri boşluğu · KOD). Eskiden hepsi
         `remoteFailureCount` tek sayacında kayboluyordu. */
      Object.keys(s.routeAttemptCounts ?? {}).length > 0
        ? observed({ id: 'pv-outcomes', label: 'Sağlayıcı × sonuç dağılımı', source: SRC_ROUTE_LEDGER,
            note: 'Zaman aşımı ≠ yol yok ≠ HTTP hatası ≠ bozuk geometri.', updatedAt: null },
            Object.entries(s.routeAttemptCounts ?? {})
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => `${k.replace('|', '→')} ×${n}`)
              .join(' · '))
        : unavailable({ id: 'pv-outcomes', label: 'Sağlayıcı × sonuç dağılımı', source: SRC_ROUTE_LEDGER,
            note: 'Henüz hiç rota isteği yapılmadı — sahte 0 gösterilmez.', updatedAt: null },
            'ölçüm yok'),
    ],
  });

  /* 3 · Map matching */
  const matchFields: InspectorField[] = [];
  if (s.mapMatchState == null) {
    matchFields.push(unavailable({ id: 'mm-state', label: 'Eşleştirme durumu',
      source: 'mapMatchModel', note: 'Henüz hiç konum örneği işlenmedi.' }));
  } else {
    matchFields.push(observed({ id: 'mm-state', label: 'Eşleştirme durumu', source: 'mapMatchModel',
      note: 'KORİDOR DIŞI = aktif rotada değil; HANGİ yolda olduğu BİLİNMEZ (cihazda yol ağı grafiği yok).',
      updatedAt: OBS }, MAP_MATCH_STATE_LABEL[s.mapMatchState]));
    matchFields.push(derived({ id: 'mm-conf', label: 'Güven', source: 'mapMatchModel',
      note: 'EŞLEŞTİ dışındaki durumlarda 0.40 ile TAVANLIDIR.', updatedAt: OBS },
      s.mapMatchConfidence != null ? s.mapMatchConfidence.toFixed(2) : '—'));
    matchFields.push(observed({ id: 'mm-raw', label: 'Ham GPS fix', source: 'mapMatchModel',
      note: 'KOORDİNAT GÖSTERİLMEZ — yalnız varlık ve yaş.', updatedAt: OBS },
      s.hasRawFix ? `VAR (${_ms(s.fixAgeMs)} önce)` : 'YOK'));
    matchFields.push(observed({ id: 'mm-snapped', label: 'Oturtulmuş konum', source: 'mapMatchModel',
      note: 'KOORDİNAT GÖSTERİLMEZ — yalnız var/yok ve rotaya dik mesafe.', updatedAt: OBS },
      s.hasSnappedPosition ? 'VAR' : 'YOK'));
    matchFields.push(observed({ id: 'mm-lateral', label: 'Rotaya dik mesafe', source: 'mapMatchModel',
      note: '', updatedAt: OBS }, _m(s.lateralM)));
    matchFields.push(observed({ id: 'mm-corridor', label: 'Koridor yarı genişliği', source: 'routingService',
      note: 'Sabit taban + GPS hata payı; sapma makinesiyle AYNI değer.', updatedAt: OBS },
      _m(s.corridorM)));
    matchFields.push(s.headingDeltaDeg != null
      ? observed({ id: 'mm-heading', label: 'Yön farkı', source: 'mapMatchModel',
          note: 'Ters şeridi eleyen tek sinyal.', updatedAt: OBS }, `${Math.round(s.headingDeltaDeg)}°`)
      : unavailable({ id: 'mm-heading', label: 'Yön farkı', source: 'mapMatchModel',
          note: '', updatedAt: OBS }, 'durakta yön gürültüdür — kullanılmadı'));
    matchFields.push(observed({ id: 'mm-seg', label: 'Eşleşen segment', source: 'mapMatchModel',
      note: '', updatedAt: OBS }, s.mapMatchSegIdx != null && s.mapMatchSegIdx >= 0
        ? `#${s.mapMatchSegIdx} / ${s.geometryPoints == null ? '—' : Math.max(0, s.geometryPoints - 1)}`
        : 'yok'));
    matchFields.push(observed({ id: 'mm-reasons', label: 'Gerekçe kodları', source: 'mapMatchModel',
      note: 'Sınırlı kod kümesi — serbest metin üretilmez.', updatedAt: OBS },
      s.matchReasons.length ? s.matchReasons.join(' · ') : 'yok'));
  }
  cards.push({ id: 'matching', title: NAV_CORE_CARD_TITLE.matching, fields: matchFields });

  /* 4 · Sapma */
  cards.push({
    id: 'offroute', title: NAV_CORE_CARD_TITLE.offroute,
    fields: [
      observed({ id: 'or-state', label: 'Sapma durumu', source: 'offRouteModel',
        note: '', updatedAt: OBS }, OFF_ROUTE_STATE_LABEL[s.offRouteState]),
      observed({ id: 'or-evidence', label: 'Kanıt / gereken', source: 'offRouteModel',
        note: 'TEK örnek asla doğrulamaz. Gereken sayı hız ve doğruluktan TÜRETİLİR.',
        updatedAt: OBS }, `${_n(s.offRouteEvidence)} / ${_n(s.offRouteRequired)}`),
      observed({ id: 'or-window', label: 'Gereken kanıt süresi', source: 'offRouteModel',
        note: 'Sabit keyfî gecikme değil — hıza göre uyarlanır.', updatedAt: OBS },
        _ms(s.offRouteRequiredMs)),
      s.offRouteConfirmedAgeMs != null
        ? observed({ id: 'or-confirmed', label: 'Sapma doğrulandı', source: 'offRouteModel',
            note: 'Reroute gecikme ölçümünün T0\'ı.', updatedAt: OBS },
            `${(s.offRouteConfirmedAgeMs / 1000).toFixed(1)} sn önce`)
        : unavailable({ id: 'or-confirmed', label: 'Sapma doğrulandı', source: 'offRouteModel',
            note: '', updatedAt: OBS }, 'sapma doğrulanmadı'),
      observed({ id: 'or-reasons', label: 'Gerekçe kodları', source: 'offRouteModel',
        note: '', updatedAt: OBS }, s.offRouteReasons.length ? s.offRouteReasons.join(' · ') : 'yok'),
    ],
  });

  /* P0-NAV-13 — hüküm okunamamış olabilir; model ÇÖKMEZ. */
  const _rr = s.rerouteHealth ?? null;

  /* 5 · Reroute */
  const L = s.requests.latency.detectToCommitMs != null ? s.requests.latency : s.requests.lastCompletedLatency;
  cards.push({
    id: 'reroute', title: NAV_CORE_CARD_TITLE.reroute,
    fields: [
      observed({ id: 'rq-current', label: 'Aktif istek', source: 'routeRequestLedger',
        note: '', updatedAt: null },
        s.requests.currentId > 0
          ? `#${s.requests.currentId} · ${s.requests.current ? REQUEST_OUTCOME_LABEL[s.requests.current.outcome] : '—'}`
          : 'yok'),
      observed({ id: 'rq-inflight', label: 'İstek uçuşta', source: 'routingService',
        note: '', updatedAt: null }, s.fetchInFlight ? 'EVET' : 'HAYIR'),
      observed({ id: 'rq-committed', label: 'Uygulanan rota', source: 'routeRequestLedger',
        note: '', updatedAt: null }, `${s.requests.committedCount}`),
      observed({ id: 'rq-superseded', label: 'İptal edilen istek', source: 'routeRequestLedger',
        note: 'Yeni istek geldiği için eskisi geçersizleşti.', updatedAt: null },
        `${s.requests.supersededCount}`),
      observed({ id: 'rq-stale', label: 'Reddedilen bayat yanıt', source: 'routeRequestLedger',
        note: 'Eski yanıt yeni rotayı EZEMEZ — bu sayaç o korumanın kanıtıdır.',
        updatedAt: null }, `${s.requests.staleRejectedCount}`),
      observed({ id: 'rq-invalid', label: 'Doğrulamadan düşen rota', source: 'routeRequestLedger',
        note: '', updatedAt: null }, `${s.requests.invalidRejectedCount}`),
      observed({ id: 'rq-suppressed', label: 'Bastırılan tekrar istek', source: 'routeRequestLedger',
        note: 'Request storm koruması.', updatedAt: null }, `${s.requests.suppressedDuplicateCount}`),
      observed({ id: 'rq-failed', label: 'Başarısız istek', source: 'routeRequestLedger',
        note: '', updatedAt: null }, `${s.requests.failedCount}`),
      L.requestToResponseMs != null
        ? derived({ id: 'rq-lat-net', label: 'İstek → yanıt', source: 'routeRequestLedger',
            note: '', updatedAt: null }, _ms(L.requestToResponseMs))
        : unavailable({ id: 'rq-lat-net', label: 'İstek → yanıt', source: 'routeRequestLedger',
            note: '', updatedAt: null }, 'henüz reroute ölçülmedi'),
      L.detectToCommitMs != null
        ? derived({ id: 'rq-lat-commit', label: 'Sapma → rota uygulandı', source: 'routeRequestLedger',
            note: '', updatedAt: null }, _ms(L.detectToCommitMs))
        : unavailable({ id: 'rq-lat-commit', label: 'Sapma → rota uygulandı', source: 'routeRequestLedger',
            note: '', updatedAt: null }, 'henüz reroute ölçülmedi'),
      L.detectToFirstInstructionMs != null
        ? derived({ id: 'rq-lat-instr', label: 'Sapma → ilk yeni talimat', source: 'routeRequestLedger',
            note: 'Sürücünün gerçekten yardım aldığı an.', updatedAt: null },
            _ms(L.detectToFirstInstructionMs))
        : unavailable({ id: 'rq-lat-instr', label: 'Sapma → ilk yeni talimat', source: 'routeRequestLedger',
            note: '', updatedAt: null }, 'henüz ölçülmedi'),

      /* ── P0-NAV-13 · ENGELLENEN REROUTE'LAR ────────────────────────────
       * ÖLÇÜLEN KUSUR: `getRerouteBlockStats()` üründe HİÇBİR yerden
       * okunmuyordu (tek çağıranı bir testti). `routingService` içindeki
       * yorum "LAB'da görünür" diyordu; ölçüm bunu ÇÜRÜTTÜ. Kütük #402'nin
       * kapatmayı amaçladığı "sapma %17,5, reroute %0, arada ne oldu
       * bilinmiyor" boşluğu GÖZLEM tarafında açık kalmıştı. */
      observed({ id: 'rq-blocked', label: 'Engellenen reroute', source: SRC_REROUTE_HEALTH,
        note: 'Sapma DOĞRULANDI ama rota isteği ÇIKMADI — sebep aşağıda.',
        updatedAt: null }, String(s.rerouteBlockedCount ?? 0)),
      Object.keys(s.rerouteBlockByReason ?? {}).some((k) => (s.rerouteBlockByReason ?? {})[k] > 0)
        ? observed({ id: 'rq-blocked-why', label: 'Engel sebepleri', source: SRC_REROUTE_HEALTH,
            note: 'Zayıf doğruluk ≠ throttle ≠ düz hat — üçü FARKLI işi işaret eder.',
            updatedAt: null },
            Object.entries(s.rerouteBlockByReason ?? {})
              .filter(([, n]) => n > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => `${k} ×${n}`)
              .join(' · '))
        : observed({ id: 'rq-blocked-why', label: 'Engel sebepleri', source: SRC_REROUTE_HEALTH,
            note: '', updatedAt: null }, 'engel yok'),
      /* AÇLIK: rota dışındayken uzun süre yeni rota kurulamaması SESSİZ bir
         kusurdur — sürücü eski talimatla gider. Bu satır onu görünür kılar.
         ⚠️ Bu bir ALARM'dır, aksiyon DEĞİL: doğruluk kapısı EZİLMEZ. */
      _rr !== null
        ? (_rr.health === 'STARVED'
            ? derived({ id: 'rq-health', label: '⚠️ Reroute sağlığı', source: SRC_REROUTE_HEALTH,
                note: _rr.why, updatedAt: null }, REROUTE_HEALTH_LABEL[_rr.health])
            : observed({ id: 'rq-health', label: 'Reroute sağlığı', source: SRC_REROUTE_HEALTH,
                note: _rr.why, updatedAt: null }, REROUTE_HEALTH_LABEL[_rr.health]))
        : unavailable({ id: 'rq-health', label: 'Reroute sağlığı', source: SRC_REROUTE_HEALTH,
            note: 'Hüküm okunamadı.', updatedAt: null }, 'ölçüm yok'),
      _rr !== null && _rr.offRouteForMs !== null
        ? derived({ id: 'rq-starve', label: 'Sapmadan bu yana', source: SRC_REROUTE_HEALTH,
            note: 'Rota kurulamadan geçen süre. Uzuyorsa sürücü eski talimatla gidiyordur.',
            updatedAt: null }, _ms(_rr.offRouteForMs))
        : unavailable({ id: 'rq-starve', label: 'Sapmadan bu yana', source: SRC_REROUTE_HEALTH,
            note: 'Doğrulanmış sapma yok — sahte 0 gösterilmez.', updatedAt: null },
            'sapma yok'),
    ],
  });

  /* 6 · Doğrulama */
  const vFields: InspectorField[] = [];

  if (s.validationVerdict == null) {
    vFields.push(unavailable({ id: 'rv-verdict', label: 'Rota hükmü', source: 'routeValidationModel',
      note: s.straightLineActive
        ? 'Düz hat bir rota adayı DEĞİLDİR — doğrulanmaz, "geçerli" de denmez.'
        : 'Henüz doğrulanmış rota yok.' }));
  } else {
    vFields.push(observed({ id: 'rv-verdict', label: 'Rota hükmü', source: 'routeValidationModel',
      note: 'REDDEDİLEN rota navigation state\'e HİÇ uygulanmaz.', updatedAt: null },
      ROUTE_VERDICT_LABEL[s.validationVerdict]));
    for (const c of s.validationChecks) {
      const val = `${c.status} — ${c.detail}`;
      vFields.push(c.status === 'UNKNOWN'
        ? unavailable({ id: `rv-${c.id}`, label: c.id, source: 'routeValidationModel',
            note: '', updatedAt: null }, c.detail)
        : observed({ id: `rv-${c.id}`, label: c.id, source: 'routeValidationModel',
            note: '', updatedAt: null }, val));
    }
  }
  /* ── P0-NAV-11 · GEOMETRİ BÜTÜNLÜĞÜ ─────────────────────────────────────
   * `validateRoute` rotayı KABUL/RET eder; bu satırlar UYGULANAN geometrinin
   * ÖLÇÜMÜNÜ gösterir. İkisi farklı sorulardır: "rota kabul edildi mi" ile
   * "haritadaki çizgi sağlayıcının verdiği rota mı".
   * GİZLİLİK: koordinat YOK — bbox yalnız derece GENİŞLİĞİ olarak. */
  const _cg = s.committedGeometry ?? null;
  vFields.push(
    _cg !== null
      ? observed({ id: 'gm-integrity', label: 'Uygulanan geometri hükmü', source: SRC_GEOMETRY,
          note: _cg.flaws.length > 0
            ? `Kusurlar: ${_cg.flaws.join(' · ')}`
            : 'Ölçülen kusur yok.',
          updatedAt: null }, GEOMETRY_INTEGRITY_LABEL[_cg.integrity])
      : unavailable({ id: 'gm-integrity', label: 'Uygulanan geometri hükmü', source: SRC_GEOMETRY,
          note: 'Henüz hiç rota uygulanmadı — sahte künye ÜRETİLMEZ.', updatedAt: null },
          'rota yok'),
    _cg !== null
      ? observed({ id: 'gm-points', label: 'Nokta / benzersiz / yinelenen', source: SRC_GEOMETRY,
          note: 'Yinelenen nokta sıfır uzunluklu segment üretir ve ilerleme matematiğini bozar.',
          updatedAt: null },
          `${_cg.metrics.pointCount} / ${_cg.metrics.uniquePointCount} / ${_cg.metrics.duplicateCount}`)
      : unavailable({ id: 'gm-points', label: 'Nokta / benzersiz / yinelenen', source: SRC_GEOMETRY,
          note: '', updatedAt: null }, 'ölçüm yok'),
    _cg !== null
      ? observed({ id: 'gm-ends', label: 'Başlangıç / bitiş sapması', source: SRC_GEOMETRY,
          note: 'İlk nokta araca, son nokta hedefe ne kadar uzak.', updatedAt: null },
          `${_cg.startDistanceM ?? '—'} m / ${_cg.endDistanceM ?? '—'} m`)
      : unavailable({ id: 'gm-ends', label: 'Başlangıç / bitiş sapması', source: SRC_GEOMETRY,
          note: '', updatedAt: null }, 'ölçüm yok'),
    _cg !== null
      ? observed({ id: 'gm-extent', label: 'Ölçülen uzunluk / kapsam', source: SRC_GEOMETRY,
          note: 'Kapsam DERECE GENİŞLİĞİDİR — köşe koordinatları TAŞINMAZ (gizlilik).',
          updatedAt: null },
          `${_cg.metrics.polylineLengthM ?? '—'} m · `
          + `${_cg.metrics.bboxWidthDeg ?? '—'}° × ${_cg.metrics.bboxHeightDeg ?? '—'}°`)
      : unavailable({ id: 'gm-extent', label: 'Ölçülen uzunluk / kapsam', source: SRC_GEOMETRY,
          note: '', updatedAt: null }, 'ölçüm yok'),
    /* Reddedilen adayın kanıtı SİLİNMEZ — bozuk geometri haritaya çizilmez
       ama sağlayıcının ne gönderdiği sahada görülebilir olmalıdır. */
    observed({ id: 'gm-rejected', label: 'Reddedilen aday geometrisi', source: SRC_GEOMETRY,
      note: (s.lastRejectedFlaws ?? []).length > 0
        ? `Son adayın kusurları: ${(s.lastRejectedFlaws ?? []).join(' · ')}`
        : 'Kanıt halkası boş — henüz aday reddedilmedi.',
      updatedAt: null },
      `${s.rejectedGeometryTotal ?? 0} aday`),
    (s.lastRejectedCheckIds ?? []).length > 0
      ? observed({ id: 'gm-rejected-checks', label: 'Son reddin düşen denetimleri', source: SRC_GEOMETRY,
          note: 'Hangi denetimin düşürdüğü, hangi işi işaret ettiğini belirler.', updatedAt: null },
          (s.lastRejectedCheckIds ?? []).join(' · '))
      : observed({ id: 'gm-rejected-checks', label: 'Son reddin düşen denetimleri', source: SRC_GEOMETRY,
          note: '', updatedAt: null }, 'red yok'),
  );

  /* ── F7 · "NEDEN BU ROTA?" ───────────────────────────────────────────────
   * Bu satırlar bir KARAR ÜRETMEZ; `pickBestRoute`un ZATEN aldığı kararı
   * okunur kılar. Sıralama anahtarı `[kusur, uyarı, süre]` olduğu için süre
   * ÜÇÜNCÜ ölçüttür: bir uyarısı az olan aday çok daha yavaş olsa bile
   * kazanabilir. `Süre takası` tam olarak o bedeli gösterir.
   * GİZLİLİK: koordinat/hedef/geometri YOK — yalnız sayı ve denetim kimliği. */
  const _ra = s.routeRationale ?? null;
  const _raLast = _ra?.last ?? null;
  if (_ra === null) {
    vFields.push(unavailable({ id: 'rr-why', label: 'Neden bu rota', source: SRC_ROUTE_RATIONALE,
      note: 'Gerekçe defteri okunamadı.', updatedAt: null }, 'okunamadı'));
  } else if (_raLast === null) {
    vFields.push(unavailable({ id: 'rr-why', label: 'Neden bu rota', source: SRC_ROUTE_RATIONALE,
      note: 'Bu oturumda hiç rota kararı kaydedilmedi — sahte "tek seçenek" ÜRETİLMEZ.',
      updatedAt: null }, 'ölçülmedi'));
  } else {
    vFields.push(observed({ id: 'rr-why', label: 'Neden bu rota', source: SRC_ROUTE_RATIONALE,
      note: 'Kararı `pickBestRoute` verir; bu satır yalnız onu AÇIKLAR. '
        + '"açıklanamadı" bir kusur bildirimidir: seçim sıralama anahtarıyla uyuşmuyor.',
      updatedAt: null },
      ROUTE_DECIDING_FACTOR_LABEL[_raLast.decidingFactor]
        + ' · ' + _raLast.provider
        + (_raLast.chosenIdx === null ? ' · aday seçilmedi' : ` · aday #${_raLast.chosenIdx}`)));

    vFields.push(observed({ id: 'rr-cands', label: 'Aday havuzu', source: SRC_ROUTE_RATIONALE,
      note: 'Sağlayıcıdan gelen ana rota + alternatifler. Reddedilenler aktif rota OLAMAZ.',
      updatedAt: null },
      `${_raLast.candidates.length} aday · kabul ${_raLast.acceptedCount} · reddedilen ${_raLast.rejectedCount}`));

    vFields.push(_raLast.durationPenaltyS === null
      ? unavailable({ id: 'rr-penalty', label: 'Süre takası', source: SRC_ROUTE_RATIONALE,
          note: 'Adayların süresi ölçülemedi — sahte 0 gösterilmez.', updatedAt: null },
          'ölçülemedi')
      : derived({ id: 'rr-penalty', label: 'Süre takası', source: SRC_ROUTE_RATIONALE,
          note: 'Seçilen rota, KABUL EDİLEN en hızlı adaydan ne kadar uzun sürüyor. '
            + '0 = takas yok. Büyük bir sayı, doğrulama kapısının sürücüye ödettiği bedeldir.',
          updatedAt: null },
          _raLast.durationPenaltyS === 0
            ? 'takas yok (0 sn)'
            : `${_ms(_raLast.durationPenaltyS * 1000)}`
              + (_raLast.durationPenaltyRatio === null ? ''
                : ` · %${Math.round(_raLast.durationPenaltyRatio * 100)}`)));

    vFields.push(derived({ id: 'rr-ledger', label: 'Karar defteri', source: SRC_ROUTE_RATIONALE,
      note: 'Sağlayıcının İLK rotasının kaç kez reddedildiği, doğrulama kapısının '
        + 'sahada NE SIKLIKLA devreye girdiğini gösterir.',
      updatedAt: null },
      `${_ra.decisions} karar · ilk rota reddi ${_ra.overrodeProviderFirst}`
        + (_ra.maxDurationPenaltyS === null ? ''
          : ` · en büyük takas ${_ms(_ra.maxDurationPenaltyS * 1000)}`)));
  }


  cards.push({ id: 'validation', title: NAV_CORE_CARD_TITLE.validation, fields: vFields });

  /* ── P0-NAV-16 · SESLİ YÖNLENDİRME DENETİMİ ──────────────────────────────
   * "Söylendi" sayacı VARDI; "söylenmedi" ve "geç söylendi" YOKTU. Sürücünün
   * gerçekten yaşadığı kusur ötekiler: dönüşü kaçırmak, anonsu dönüşün
   * üstünde duymak. Bu alanlar mevcut Teslim Çekirdeği kartına eklenir. */
  const _ga = s.guidanceAudit ?? null;
  const _gaFields: InspectorField[] = _ga === null || _ga.announcementCount + _ga.maneuverCount === 0
    ? [unavailable({ id: 'vg-audit', label: 'Anons denetimi', source: SRC_GUIDANCE_AUDIT,
        note: 'Henüz hiç anons/manevra yargılanmadı — sahte "kusursuz" ÜRETİLMEZ.',
        updatedAt: null }, 'ölçüm yok')]
    : [
      observed({ id: 'vg-audit', label: 'Anons zamanlaması', source: SRC_GUIDANCE_AUDIT,
        note: 'GEÇ = kademe penceresinin yarısı kaçmış · ÇOK GEÇ = sürücü tepki veremez.',
        updatedAt: null },
        `${_ga.timing.ON_TIME} zamanında · ${_ga.timing.LATE} geç · ${_ga.timing.VERY_LATE} çok geç`),
      /* MEŞRU sessizlik AYRI sayılır: mesafe kanıtı yokken susmak ürünün
         fail-closed tasarımıdır, kusur DEĞİLDİR. */
      observed({ id: 'vg-missed', label: 'Kaçırılan anons / meşru sessizlik',
        source: SRC_GUIDANCE_AUDIT,
        note: 'İlki KUSURDUR. İkincisi DOĞRU davranıştır (kanıt yokken konuşulmaz).',
        updatedAt: null },
        `${_ga.missed.MISSED_ALL + _ga.missed.MISSED_IMMINENT} / ${_ga.missed.SILENCE_JUSTIFIED}`),
      _ga.recent.length > 0
        ? derived({ id: 'vg-last-flaw', label: 'Son anons kusuru', source: SRC_GUIDANCE_AUDIT,
            note: 'Talimat METNİ taşınmaz (gizlilik) — yalnız kademe ve mesafe.',
            updatedAt: null },
            (() => {
              const e = _ga.recent[_ga.recent.length - 1];
              return e.missed !== 'NONE'
                ? `${e.missed}`
                : `${e.stage ?? '—'} · ${e.timing} · ${e.distanceM ?? '—'} m`;
            })())
        : observed({ id: 'vg-last-flaw', label: 'Son anons kusuru', source: SRC_GUIDANCE_AUDIT,
            note: '', updatedAt: null }, 'kusur yok'),
    ];

  /* ── P0-NAV-19 · SICAK YOL MALİYETİ ──────────────────────────────────────
   * Ölçüm turu bulgusu: gecikmeler (arama · rota · reroute) ZATEN ölçülüydü,
   * yinelenen istekler ZATEN kapalıydı, zamanlayıcı disiplini SAĞLAMDI
   * (tüm navigasyon yolunda tek `setInterval`: GPS yokken 1 Hz ölü hesap).
   * Ölçülmeyen TEK şey sıcak yolun KENDİ maliyetiydi. */
  const _tc = s.tickCost ?? null;
  const _tcFields: InspectorField[] = _tc === null || _tc.mapMatch.samples === 0
    ? [unavailable({ id: 'tc-match', label: 'Harita eşleştirme maliyeti', source: SRC_TICK_COST,
        note: 'Henüz hiç tick ölçülmedi — sahte 0 ms gösterilmez.', updatedAt: null },
        'ölçüm yok'),
       unavailable({ id: 'tc-tick', label: 'Tam ilerleme tick maliyeti', source: SRC_TICK_COST,
        note: '', updatedAt: null }, 'ölçüm yok'),
       unavailable({ id: 'tc-samples', label: 'Ölçülen tick (pencere / toplam)', source: SRC_TICK_COST,
        note: '', updatedAt: null }, 'ölçüm yok')]
    : [
      observed({ id: 'tc-match', label: 'Harita eşleştirme (p50 / p95 / en büyük)',
        source: SRC_TICK_COST,
        note: 'Rota uzadıkça pahalılaşan TEK iş. Düşük-uçlu cihazda p95 kritiktir.',
        updatedAt: null },
        `${_tc.mapMatch.p50Ms ?? '—'} / ${_tc.mapMatch.p95Ms ?? '—'} / ${_tc.mapMatch.maxMs ?? '—'} ms`),
      observed({ id: 'tc-tick', label: 'Tam ilerleme tick maliyeti (p50 / p95 / en büyük)',
        source: SRC_TICK_COST,
        note: 'Eşleştirme + adım ilerletme + sapma + ses kararı. Eşleştirmeyle farkı yavaşlığın NEREDE olduğunu söyler.',
        updatedAt: null },
        `${_tc.progressTick.p50Ms ?? '—'} / ${_tc.progressTick.p95Ms ?? '—'} / ${_tc.progressTick.maxMs ?? '—'} ms`),
      observed({ id: 'tc-samples', label: 'Ölçülen tick (pencere / toplam)', source: SRC_TICK_COST,
        note: 'Pencere sabit boyutludur; toplam ömür boyu sayacıdır.', updatedAt: null },
        `${_tc.mapMatch.samples} / ${_tc.mapMatch.total}`),
    ];

  /* ── 15 · İlerleme Dürüstlüğü (P0-NAV-12) ────────────────────────────────
   * ÖLÇÜLEN BOŞLUK: `routingService` her fix'te ilerlemeyi HESAPLIYOR ama
   * yargılamıyordu. ETA sıçramalarının defteri vardı; onu BESLEYEN ilerlemenin
   * defteri YOKTU. "ETA 12 dk zıpladı" görülüyor, "kalan mesafe 3 km geri
   * gitti" görülmüyordu.
   * ⚠️ Bu kart hiçbir değeri KIRPMAZ — gerçek U dönüşü meşrudur ve
   * `REAL_BACKTRACK` olarak AYRI sayılır. */
  const _pg = s.progress ?? null;
  cards.push({
    id: 'progress', title: NAV_CORE_CARD_TITLE.progress,
    fields: _pg === null || _pg.totalSamples === 0
      ? [unavailable({ id: 'pr-verdict', label: 'İlerleme hükmü', source: SRC_PROGRESS,
          note: 'Henüz hiç ilerleme örneği yargılanmadı — sahte "normal" ÜRETİLMEZ.',
          updatedAt: null }, 'ölçüm yok')]
      : [
        _pg.lastVerdict !== null
          ? observed({ id: 'pr-verdict', label: 'İlerleme hükmü', source: SRC_PROGRESS,
              note: 'Son yargılanan örneğin sınıfı.', updatedAt: OBS },
              PROGRESS_VERDICT_LABEL[_pg.lastVerdict])
          : unavailable({ id: 'pr-verdict', label: 'İlerleme hükmü', source: SRC_PROGRESS,
              note: '', updatedAt: null }, 'ölçüm yok'),
        observed({ id: 'pr-counts', label: 'Sınıf dağılımı', source: SRC_PROGRESS,
          note: `${_pg.totalSamples} örnek üzerinden.`, updatedAt: null },
          (Object.keys(_pg.counts) as ProgressVerdict[])
            .filter((k) => _pg.counts[k] > 0)
            .sort((a, b) => _pg.counts[b] - _pg.counts[a])
            .map((k) => `${k} ×${_pg.counts[k]}`)
            .join(' · ') || 'yok'),
        /* GERÇEK geri dönüş bir KUSUR DEĞİLDİR — U dönüşü yapan sürücü
           rotada geriye gider. Kusur, yön kanıtı OLMADAN geriye kaymadır. */
        observed({ id: 'pr-backtrack', label: 'Gerçek geri dönüş / kanıtsız kayma',
          source: SRC_PROGRESS,
          note: 'İlki MEŞRUDUR (U dönüşü). İkincisi eşleştirme kaymasıdır.',
          updatedAt: null },
          `${_pg.counts.REAL_BACKTRACK} / ${_pg.counts.IMPLAUSIBLE_BACKWARD}`),
        observed({ id: 'pr-forward', label: 'Aşırı ileri sıçrama', source: SRC_PROGRESS,
          note: 'Hızın izin verdiğinden fazla ilerleme — eşleştirme atlamış olabilir.',
          updatedAt: null }, String(_pg.counts.IMPLAUSIBLE_FORWARD)),
        _pg.maxForwardJumpM !== null || _pg.maxBackwardJumpM !== null
          ? observed({ id: 'pr-extremes', label: 'En büyük ileri / geri fark', source: SRC_PROGRESS,
              note: 'Ölçülen uçlar — kırpma YAPILMADI.', updatedAt: null },
              `${_pg.maxForwardJumpM ?? '—'} m / ${_pg.maxBackwardJumpM ?? '—'} m`)
          : unavailable({ id: 'pr-extremes', label: 'En büyük ileri / geri fark', source: SRC_PROGRESS,
              note: 'Hiç fark ölçülmedi — sahte 0 gösterilmez.', updatedAt: null }, 'ölçüm yok'),
        _pg.anomalies.length > 0
          ? observed({ id: 'pr-anomaly', label: 'Son anormal ilerleme', source: SRC_PROGRESS,
              note: 'Yalnız anormal örnekler halkaya girer.', updatedAt: null },
              (() => {
                const a = _pg.anomalies[_pg.anomalies.length - 1];
                return `${a.verdict} · ${a.deltaM ?? '—'} m / bütçe ${a.budgetM ?? '—'} m`
                     + ` · ${a.speedKmh?.toFixed(0) ?? '—'} km/sa`;
              })())
          : observed({ id: 'pr-anomaly', label: 'Son anormal ilerleme', source: SRC_PROGRESS,
              note: '', updatedAt: null }, 'anormallik yok'),
      ],
  });
  /* P0-NAV-19: maliyet alanları aynı karta eklenir — ilerleme ile maliyet aynı
     tick'in iki yüzüdür ve yan yana okunmaları teşhisi kolaylaştırır. */
  cards[cards.length - 1] = {
    ...cards[cards.length - 1],
    fields: [...cards[cards.length - 1].fields, ..._tcFields],
  };

  /* 7 · Manevra mesafesi */
  cards.push({
    id: 'maneuver', title: NAV_CORE_CARD_TITLE.maneuver,
    fields: [
      /* ── Yola boyanmış manevra oku ────────────────────────────────────────
         Ok bir İDDİADIR; çizilmediğinde SEBEBİ görünür olmalı. "Çizemedim"
         (çapa çözülmedi · geometri kısa) ile "çizmeye gerek yoktu" (düz devam ·
         henüz uzak) sahada TAMAMEN farklı iki teşhistir ve bu ayrım ancak
         gerekçe okunabildiğinde yapılabilir. Konum/sokak adı TAŞINMAZ. */
      observed({ id: 'pa-state', label: 'Boyanmış ok', source: 'paintedArrowAccess',
        note: 'Zemin düzlemine (fill) çizilir — sembol DEĞİL, bu yüzden eğimle asfalta yatar.',
        updatedAt: null }, s.paintedArrow.visible ? 'ÇİZİLİYOR' : 'ÇİZİLMİYOR'),
      observed({ id: 'pa-reason', label: 'Ok gerekçesi', source: 'paintedArrowAccess',
        note: 'SHOWN dışındaki her değer okun NEDEN çizilmediğidir.',
        updatedAt: null }, s.paintedArrow.reason),
      observed({ id: 'pa-shown', label: 'Görünür oluş sayısı', source: 'paintedArrowAccess',
        note: 'Hızla artıyorsa ok yanıp sönüyordur (eşik histerezisi gerekir).',
        updatedAt: null }, String(s.paintedArrow.shownCount)),
      observed({ id: 'pa-applied', label: 'Hüküm değişim sayısı', source: 'paintedArrowAccess',
        note: 'GPS 1 Hz akar; bu sayı fix sayısına yaklaşıyorsa dedup ÇALIŞMIYOR demektir.',
        updatedAt: null }, String(s.paintedArrow.appliedCount)),
      observed({ id: 'pa-layer', label: 'Ok katmanı kurulu', source: 'paintedArrowAccess',
        note: 'Stil yeniden yüklenince false düşer; ilk fix\'te yeniden kurulmalı.',
        updatedAt: null }, s.paintedArrow.layerPresent ? 'EVET' : 'HAYIR'),
      observed({ id: 'pa-policy', label: 'Ok politika sürümü', source: 'paintedArrowModel',
        note: 'Eşikler (140 m göster · 15 m gizle) değişince yükselir.',
        updatedAt: null }, s.paintedArrow.policyVersion),

      observed({ id: 'mv-source', label: 'Mesafe yöntemi', source: 'routingService',
        note: 'KUŞ UÇUŞU virajlı yaklaşımda GERÇEK yol mesafesinden kısa çıkar → erken anons.',
        updatedAt: OBS }, MANEUVER_SOURCE_LABEL[s.nextManeuverDistanceSource]),
      s.nextManeuverDistanceM != null && s.nextManeuverDistanceSource !== 'UNKNOWN'
        ? observed({ id: 'mv-dist', label: 'Sonraki manevraya', source: 'routingService',
            note: '', updatedAt: OBS }, _m(s.nextManeuverDistanceM))
        : unavailable({ id: 'mv-dist', label: 'Sonraki manevraya', source: 'routingService',
            note: '', updatedAt: OBS }, 'konum bilinmiyor — mesafe uydurulmaz'),
      observed({ id: 'mv-step', label: 'Aktif adım', source: 'useRouteStore',
        note: '', updatedAt: OBS },
        `${_n(s.currentStepIndex)} / ${Math.max(0, s.stepCount - 1)}`),
      observed({ id: 'mv-anchor', label: 'Çözülen / çözülemeyen çapa', source: 'maneuverIndexModel',
        note: 'Çözülemeyen çapa = o manevra için yol-boyu mesafe YOK.', updatedAt: null },
        `${s.anchorResolvedCount} / ${s.anchorUnresolvedCount}`),
      observed({ id: 'mv-method', label: 'Çapa yöntemi dağılımı', source: 'maneuverIndexModel',
        note: 'KESİN = OSRM adım geometrileri uç uca tuttu.', updatedAt: null },
        /* Etiketler `maneuverIndexModel`in KENDİ sözlüğünden gelir — burada
         * ikinci bir Türkçe metin tutmak sessiz sapma (drift) üretirdi. */
        `${ANCHOR_METHOD_LABEL.CONCATENATION} ${s.anchorMethodCounts.CONCATENATION}`
        + ` · ${ANCHOR_METHOD_LABEL.NEAREST} ${s.anchorMethodCounts.NEAREST}`
        + ` · ${ANCHOR_METHOD_LABEL.UNRESOLVED} ${s.anchorMethodCounts.UNRESOLVED}`),
      observed({ id: 'mv-geom', label: 'Rota geometrisi', source: 'useRouteStore',
        note: '', updatedAt: null },
        `${_n(s.geometryPoints)} nokta · ${_m(s.totalRouteDistanceM)}`),
    ],
  });

  /* 8 · Dürüstlük sayaçları */
  cards.push({
    id: 'truth', title: NAV_CORE_CARD_TITLE.truth,
    fields: [
      observed({ id: 'tr-lanes', label: 'GERÇEK şerit verisi olan adım', source: 'useRouteStore.steps',
        note: 'Şerit paneli YALNIZ bu adımlarda gösterilir. Manevra tipinden ok TÜRETİLMEZ.',
        updatedAt: null }, `${s.stepsWithRealLanes} / ${s.stepCount}`),
      observed({ id: 'tr-roundabout', label: 'Dönel kavşak / çıkış numaralı', source: 'useRouteStore.steps',
        note: 'Çıkış numarası yoksa "N. çıkış" SÖYLENMEZ.', updatedAt: null },
        `${s.roundaboutStepCount} / ${s.roundaboutWithExitCount}`),
      observed({ id: 'tr-straight', label: 'Düz hat aktif', source: 'useRouteStore.serverUsed',
        note: 'Aktifse bu bir NAVİGASYON ROTASI DEĞİLDİR.', updatedAt: null },
        s.straightLineActive ? 'EVET' : 'HAYIR'),
    ],
  });

  /* 9 · Oturum sürekliliği — "tam ekranı kapattım, ilerliyor mu?" */
  const rt = s.runtime;
  cards.push({
    id: 'session', title: NAV_CORE_CARD_TITLE.session,
    fields: [
      rt.running
        ? observed({ id: 'ss-runtime', label: 'İlerleme motoru', source: 'navigationSessionRuntime',
            note: 'GÖRÜNÜMDEN BAĞIMSIZ. Tam ekran kapalıyken de ilerleme sürer.',
            updatedAt: null }, 'ÇALIŞIYOR')
        : unavailable({ id: 'ss-runtime', label: 'İlerleme motoru', source: 'navigationSessionRuntime',
            note: 'Motor ayakta değil — tam ekran kapanınca navigasyon DONAR.',
            updatedAt: null }, 'ÇALIŞMIYOR'),
      observed({ id: 'ss-session', label: 'Oturum kimliği', source: 'navigationService',
        note: 'Görünüm geçişleri bu numarayı DEĞİŞTİRMEZ; yalnız yeni hedef artırır.',
        updatedAt: null }, `#${s.sessionId}`),
      observed({ id: 'ss-claim', label: 'Rota isteği sahipliği', source: 'navigationService',
        note: 'Hedef KİMLİĞİ taşınmaz. Sahiplik varken görünüm yeniden açılsa bile YENİ istek atılmaz.',
        updatedAt: null }, s.hasRouteClaim ? 'VAR' : 'YOK'),
      rt.lastTickAgeMs != null
        ? derived({ id: 'ss-tick', label: 'İşlenen fix / son tick yaşı', source: 'navigationSessionRuntime',
            note: 'Motorun gerçekten ilerlediğinin kanıtı.', updatedAt: null },
            `${rt.tickCount} · ${_ms(rt.lastTickAgeMs)} önce`)
        : unavailable({ id: 'ss-tick', label: 'İşlenen fix / son tick yaşı',
            source: 'navigationSessionRuntime', note: '', updatedAt: null }, 'henüz tick yok'),
      observed({ id: 'ss-skip', label: 'Atlanan (fix yok / aktif değil)', source: 'navigationSessionRuntime',
        note: 'Navigasyon ACTIVE/REROUTING değilken tick işlenmez — boşuna CPU yok.',
        updatedAt: null }, `${rt.skippedNoFix} · ${rt.skippedInactive}`),
      rt.errorCount > 0
        ? observed({ id: 'ss-err', label: 'Motor hatası', source: 'navigationSessionRuntime',
            note: 'Fail-soft: hata aboneliği öldürmez, sonraki fix\'te yeniden denenir.',
            updatedAt: null }, `${rt.errorCount} · son ${_ms(rt.lastErrorAgeMs)} önce`)
        : observed({ id: 'ss-err', label: 'Motor hatası', source: 'navigationSessionRuntime',
            note: '', updatedAt: null }, 'YOK'),
      rt.uptimeMs != null
        ? derived({ id: 'ss-uptime', label: 'Motor ayakta kalma', source: 'navigationSessionRuntime',
            note: '', updatedAt: null }, _ms(rt.uptimeMs))
        : unavailable({ id: 'ss-uptime', label: 'Motor ayakta kalma',
            source: 'navigationSessionRuntime', note: '', updatedAt: null }),
    ],
  });

  /* 10 · Harita görünümü · kamera · hız limiti */
  const cam = s.camera;
  const sl  = s.speedLimit;
  cards.push({
    id: 'viewport', title: NAV_CORE_CARD_TITLE.viewport,
    fields: [
      observed({ id: 'vp-style', label: 'Mini harita stili', source: 'mapSourceManager',
        note: 'mod/tile-render. Vektör kaynağı yoksa raster kullanilir.', updatedAt: null }, s.miniMapStyle),
      observed({ id: 'vp-theme', label: 'Harita teması (ETKİN)', source: 'mapSourceManager',
        note: 'Tünel örtüsü DAHİL — PR-3b `lightBasemap` bu değeri okur.',
        updatedAt: null }, s.mapTheme === 'night' ? 'GECE' : 'GÜNDÜZ'),

      /* ── TÜNEL GECE ÖRTÜSÜ ───────────────────────────────────────────────
       * Örtü bir AYAR DEĞİL geçici çalışma durumudur; `settings.dayNightMode`
       * DEĞİŞMEZ. Bu üç satır "ekran neden gece" sorusunu tek bakışta
       * yanıtlar: kanıt (far) · uygulanan örtü · örtü kalkınca dönülecek yer. */
      observed({ id: 'vp-tunnel', label: 'Tünel kanıtı (far)', source: 'autoBrightnessService',
        note: 'Gündüz + far açık → tünel. GPS kaybı tünel kanıtı SAYILMAZ.',
        updatedAt: null }, s.tunnelMode ? 'TÜNELDE' : 'yok'),
      observed({ id: 'vp-tunnel-ovr', label: 'Gece örtüsü uygulandı mı', source: 'mapSourceManager',
        note: 'Örtü `setMapNight` hunisindedir — hangi çağıran yazarsa yazsın korunur.',
        updatedAt: null }, s.tunnelOverride ? 'EVET' : 'hayır'),
      observed({ id: 'vp-req-night', label: 'İstenen gün/gece (örtüsüz)', source: 'mapSourceManager',
        note: 'Kullanıcı/saat kaynaklı istek — örtü kalkınca buraya DÖNÜLÜR.',
        updatedAt: null }, s.requestedNight ? 'GECE' : 'GÜNDÜZ'),
      observed({ id: 'vp-tunnel-tr', label: 'Örtü geçiş sayısı', source: 'tunnelNightRuntime',
        note: 'YALNIZ gerçek geçişler sayılır; tekrarlı far bildirimi saymaz. Hızla artıyorsa FLICKER vardır.',
        updatedAt: null },
        `${s.tunnelTransitions}${s.tunnelBridgeRunning ? '' : ' (köprü KAPALI)'}`),
      observed({ id: 'vp-contrast', label: 'Kontrast profili', source: 'mapStyleBuilders',
        note: 'Gündüz/gece TEK token setinden üretilir.', updatedAt: null }, s.mapContrastProfile),

      observed({ id: 'vp-cam', label: 'Kamera modu', source: 'cameraFollowAuthority',
        note: 'Tam ekran ve mini harita AYNI otoriteyi kullanır.', updatedAt: null }, cam.cameraMode),
      observed({ id: 'vp-centered', label: 'Araç merkezde mi', source: 'cameraFollowAuthority',
        note: '', updatedAt: null }, cam.isVehicleCentered ? 'EVET' : 'HAYIR'),
      cam.lastUserPanAgeMs != null
        ? derived({ id: 'vp-pan', label: 'Son kullanici pan', source: 'cameraFollowAuthority',
            note: '', updatedAt: null }, `${_ms(cam.lastUserPanAgeMs)} önce`)
        : unavailable({ id: 'vp-pan', label: 'Son kullanici pan', source: 'cameraFollowAuthority',
            note: '', updatedAt: null }, 'hiç pan yapılmadı'),
      observed({ id: 'vp-recenter', label: 'Ortala düğmesi', source: 'cameraFollowAuthority',
        note: 'Araç merkezdeyken GİZLİ.', updatedAt: null }, cam.recenterAvailable ? 'GÖRÜNÜR' : 'GİZLİ'),
      cam.lastRecenterAgeMs != null
        ? derived({ id: 'vp-lastrc', label: 'Son ortalama / nedeni', source: 'cameraFollowAuthority',
            note: '', updatedAt: null }, `${_ms(cam.lastRecenterAgeMs)} önce · ${cam.recenterReason}`)
        : unavailable({ id: 'vp-lastrc', label: 'Son ortalama / nedeni', source: 'cameraFollowAuthority',
            note: '', updatedAt: null }, 'hiç ortalanmadı'),
      observed({ id: 'vp-autorc', label: 'Bekleyen otomatik dönüş', source: 'cameraFollowAuthority',
        note: 'Gecikme mevcut ürün sözleşmesinden (nav 3 sn / dışı 10 sn).', updatedAt: null },
        `${cam.autoRecenterPending ? 'VAR' : 'YOK'} · ${_ms(cam.autoRecenterDelayMs)}`),
      cam.followZoom != null
        ? observed({ id: 'vp-zoom', label: 'Takip zoom', source: 'cameraFollowAuthority',
            note: 'Ortala bu zoom degerini kullanir — sabit rastgele zoom YOK.', updatedAt: null },
            cam.followZoom.toFixed(2))
        : unavailable({ id: 'vp-zoom', label: 'Takip zoom', source: 'cameraFollowAuthority',
            note: '', updatedAt: null }),

      observed({ id: 'vp-sl-state', label: 'Hız limiti durumu', source: 'speedLimitTruthModel',
        note: 'AVAILABLE dışında sayı ÜRETİLMEZ — kart gizlenir.', updatedAt: null },
        SPEED_LIMIT_STATE_LABEL[sl.state]),
      sl.kmh != null
        ? observed({ id: 'vp-sl-val', label: 'Hız limiti', source: 'speedLimitService',
            note: 'Yalnız gerçek maxspeed etiketi.', updatedAt: null }, `${sl.kmh} km/h`)
        : unavailable({ id: 'vp-sl-val', label: 'Hız limiti', source: 'speedLimitService',
            note: 'Gösterilecek doğrulanmış değer yok.', updatedAt: null }, sl.reason),
      observed({ id: 'vp-sl-src', label: 'Limit kaynağı', source: 'speedLimitService',
        note: 'inferred = yol sınıfından TAHMİN → mini haritada gösterilmez.', updatedAt: null },
        sl.source ?? 'YOK'),
      sl.ageMs != null
        ? derived({ id: 'vp-sl-age', label: 'Limit yaşı', source: 'speedLimitTruthModel',
            note: '', updatedAt: null }, _ms(sl.ageMs))
        : unavailable({ id: 'vp-sl-age', label: 'Limit yaşı', source: 'speedLimitTruthModel',
            note: '', updatedAt: null }),
      derived({ id: 'vp-sl-conf', label: 'Limit güveni', source: 'speedLimitTruthModel',
        note: 'Yaş ve mesafeyle azalır — TÜREVDİR, ölçüm değildir.', updatedAt: null },
        sl.confidence.toFixed(2)),
    ],
  });

  /* 11 · Araç sınıfı · uygulanabilir hız sınırı — SALT-OKUNUR.
     Bu karttan sınıf, politika veya limit DEĞİŞTİRİLEMEZ (görev §12).
     Tam VIN, koordinat ve kullanıcı verisi TAŞINMAZ. */
  const vc  = s.vehicleClass;
  const vp  = vc.profile;
  const eff = s.effectiveLimit;
  const rc  = s.roadClassVerdict;
  const SRC_CLASS = 'vehicleClassRuntime';
  const SRC_AUTH  = 'vehicleAwareSpeedLimitAuthority';
  cards.push({
    id: 'vehicleclass', title: NAV_CORE_CARD_TITLE.vehicleclass,
    fields: [
      s.vehicleKeyMasked
        ? observed({ id: 'vc-key', label: 'Aktif araç kimliği (maskeli)', source: SRC_CLASS,
            note: 'Kanıt deposu anahtarı. Seri numarası TAŞIMAZ.', updatedAt: null }, s.vehicleKeyMasked)
        : unavailable({ id: 'vc-key', label: 'Aktif araç kimliği (maskeli)', source: SRC_CLASS,
            note: '', updatedAt: null }, 'araç kimliği yok — sınıf saklanmaz'),
      observed({ id: 'vc-mmy', label: 'Marka / model / yıl', source: SRC_CLASS,
        note: '', updatedAt: null },
        [vp.make, vp.model, vp.modelYear].filter(Boolean).join(' · ') || null),
      observed({ id: 'vc-vinstate', label: 'VIN durumu', source: SRC_CLASS,
        note: 'VIN tek başına RUHSAT sınıfı kanıtı DEĞİLDİR.', updatedAt: null },
        vc.hasVin ? 'VAR' : 'YOK'),
      vc.vinMasked
        ? observed({ id: 'vc-vin', label: 'VIN (maskeli)', source: SRC_CLASS,
            note: 'Tam VIN LAB\'a, loga ve exporta ASLA yazılmaz.', updatedAt: null }, vc.vinMasked)
        : unavailable({ id: 'vc-vin', label: 'VIN (maskeli)', source: SRC_CLASS,
            note: '', updatedAt: null }, 'VIN okunmadı'),

      observed({ id: 'vc-state', label: 'Sınıf çözümleme durumu', source: SRC_CLASS,
        note: 'VERIFIED/PROBABLE/CONFLICTED dışında tavan UYGULANMAZ.', updatedAt: null },
        VEHICLE_CLASS_STATE_LABEL[vp.resolutionState]),
      observed({ id: 'vc-cat', label: 'Yasal sınıf', source: SRC_CLASS,
        note: 'Marka/model adından TÜRETİLMEZ.', updatedAt: null },
        LEGAL_CATEGORY_LABEL[vp.legalVehicleCategory]),
      observed({ id: 'vc-body', label: 'Ruhsat gövde cinsi', source: SRC_CLASS,
        note: 'N1 içinde kamyonet/panelvan ayrımı hız sınırını 15 km/sa değiştirir.', updatedAt: null },
        BODY_TYPE_LABEL[vp.registrationBodyType]),
      observed({ id: 'vc-src', label: 'Sınıf kaynağı', source: SRC_CLASS,
        note: '', updatedAt: null }, vp.source),
      derived({ id: 'vc-conf', label: 'Sınıf güveni', source: SRC_CLASS,
        note: 'Kaynağın beyanı — ölçüm değildir.', updatedAt: null }, vp.confidence.toFixed(2)),
      vp.verifiedAt != null
        ? observed({ id: 'vc-verified', label: 'Sınıf doğrulama zamanı', source: SRC_CLASS,
            note: '', updatedAt: vp.verifiedAt }, new Date(vp.verifiedAt).toISOString())
        : unavailable({ id: 'vc-verified', label: 'Sınıf doğrulama zamanı', source: SRC_CLASS,
            note: '', updatedAt: null }, 'doğrulanmadı'),
      vp.sourceRefs.length > 0
        ? observed({ id: 'vc-refs', label: 'Kaynak künyeleri', source: SRC_CLASS,
            note: 'Yalnız künye — ham içerik cihaza YAZILMAZ.', updatedAt: null },
            vp.sourceRefs.map((r) => r.title).join(' | '))
        : unavailable({ id: 'vc-refs', label: 'Kaynak künyeleri', source: SRC_CLASS,
            note: '', updatedAt: null }, 'künyeli kaynak yok'),
      observed({ id: 'vc-reason', label: 'Çözümleme gerekçesi', source: SRC_CLASS,
        note: '', updatedAt: null }, vp.reason),

      vc.researchAttemptedAt != null
        ? observed({ id: 'vc-res-at', label: 'Son araştırma denemesi', source: 'vehicleClassResearch',
            note: 'Ağ çağrısı YALNIZ araç kimliği değişince.', updatedAt: vc.researchAttemptedAt },
            new Date(vc.researchAttemptedAt).toISOString())
        : unavailable({ id: 'vc-res-at', label: 'Son araştırma denemesi', source: 'vehicleClassResearch',
            note: '', updatedAt: null }, 'hiç denenmedi'),
      observed({ id: 'vc-res-out', label: 'Araştırma sonucu', source: 'vehicleClassResearch',
        note: '', updatedAt: null }, RESEARCH_OUTCOME_LABEL[vc.researchOutcome]),
      vc.researchFailureReason
        ? observed({ id: 'vc-res-fail', label: 'Araştırma hata nedeni', source: 'vehicleClassResearch',
            note: 'Hassas veri içermez.', updatedAt: null }, vc.researchFailureReason)
        : unavailable({ id: 'vc-res-fail', label: 'Araştırma hata nedeni', source: 'vehicleClassResearch',
            note: '', updatedAt: null }, 'hata yok'),
      observed({ id: 'vc-cache', label: 'Çevrimdışı önbellek', source: SRC_CLASS,
        note: 'CACHED = internet olmadan da sınıf bilinir.', updatedAt: null }, s.offlineCacheState),

      observed({ id: 'vc-pol', label: 'Politika (ülke / sürüm)', source: 'turkeySpeedPolicy',
        note: 'Sayılar UI\'a gömülü DEĞİL — versiyonlu tablodan.', updatedAt: null },
        `${s.policyCountry} · ${s.policyVersion}`),
      observed({ id: 'vc-pol-from', label: 'Politika yürürlük', source: 'turkeySpeedPolicy',
        note: '', updatedAt: null }, s.policyEffectiveFrom),
      observed({ id: 'vc-pol-src', label: 'Politika kaynağı', source: 'turkeySpeedPolicy',
        note: '', updatedAt: null }, s.policySourceAuthority),

      observed({ id: 'vc-roadclass', label: 'Yol sınıfı', source: 'roadClassResolver',
        note: 'Levha + OSM etiketinden; ikisi de yetmezse UNKNOWN.', updatedAt: null },
        `${ROAD_CLASS_LABEL[rc.roadClass]} (${rc.confidence.toFixed(2)})`),
      eff.roadLimitKmh != null
        ? observed({ id: 'vc-road-kmh', label: 'Yol sınırı', source: 'speedLimitService',
            note: 'Yalnız gerçek maxspeed etiketi.', updatedAt: null }, `${eff.roadLimitKmh} km/sa`)
        : unavailable({ id: 'vc-road-kmh', label: 'Yol sınırı', source: 'speedLimitService',
            note: '', updatedAt: null }, 'doğrulanmış yol sınırı yok'),
      eff.vehicleClassCapKmh != null
        ? derived({ id: 'vc-cap', label: 'Araç sınıfı tavanı', source: 'turkeySpeedPolicy',
            note: 'Politika tablosu satırı — levhayı YÜKSELTEMEZ.', updatedAt: null },
            `${eff.vehicleClassCapKmh} km/sa`)
        : unavailable({ id: 'vc-cap', label: 'Araç sınıfı tavanı', source: 'turkeySpeedPolicy',
            note: '', updatedAt: null }, 'sınıf/yol bilinmiyor — otomobil tavanı VARSAYILMAZ'),
      eff.effectiveLimitKmh != null
        ? derived({ id: 'vc-eff', label: 'Uygulanan sınır', source: SRC_AUTH,
            note: 'min(yol sınırı, araç tavanı).', updatedAt: null }, `${eff.effectiveLimitKmh} km/sa`)
        : unavailable({ id: 'vc-eff', label: 'Uygulanan sınır', source: SRC_AUTH,
            note: '', updatedAt: null }, eff.reason),
      observed({ id: 'vc-eff-state', label: 'Uygulanabilirlik durumu', source: SRC_AUTH,
        note: 'AVAILABLE dışında sayı kesin DEĞİLDİR.', updatedAt: null },
        EFFECTIVE_LIMIT_STATE_LABEL[eff.state]),
      observed({ id: 'vc-eff-reason', label: 'Sınırı belirleyen', source: SRC_AUTH,
        note: '', updatedAt: null }, eff.effectiveLimitReason),
      observed({ id: 'vc-eff-label', label: 'Kart kaynak etiketi', source: SRC_AUTH,
        note: 'Mini harita ve tam ekranda AYNI etiket görünür.', updatedAt: null }, eff.sourceLabel),
      eff.sourceAgeMs != null
        ? derived({ id: 'vc-eff-age', label: 'Sınır yaşı', source: SRC_AUTH,
            note: '', updatedAt: null }, _ms(eff.sourceAgeMs))
        : unavailable({ id: 'vc-eff-age', label: 'Sınır yaşı', source: SRC_AUTH,
            note: '', updatedAt: null }, 'damga yok'),
      observed({ id: 'vc-conflict', label: 'Çelişki durumu', source: SRC_AUTH,
        note: 'Kullanıcı beyanı ↔ dış kaynak veya yol içi çelişki.', updatedAt: null },
        (vp.resolutionState === 'CONFLICTED' || eff.state === 'CONFLICTED') ? 'VAR' : 'YOK'),
    ],
  });

  /* 12 · Teslim çekirdeği — ses · ölü hesaplama · ETA (SALT-OKUNUR).
     LAB bu runtime'ları BAŞLATAMAZ/DURDURAMAZ/DEĞİŞTİREMEZ. */
  const v   = s.voice;
  const drt = s.runtime;
  const eta = s.eta;
  const SRC_VOICE = 'voiceGuidanceRuntime';
  const SRC_RT    = 'navigationSessionRuntime';
  const SRC_ETA   = 'etaModel';
  const SRC_DUR   = 'routeDurationModel';
  cards.push({
    id: 'delivery', title: NAV_CORE_CARD_TITLE.delivery,
    fields: [
      ..._gaFields,
      observed({ id: 'dl-voice-state', label: 'Ses runtime durumu', source: SRC_VOICE,
        note: 'Görünüm kapalıyken de ETKİN olmalı.', updatedAt: null },
        VOICE_RUNTIME_STATE_LABEL[v.state]),
      observed({ id: 'dl-voice-owner', label: 'Ses sahibi', source: SRC_VOICE,
        note: 'Görünüm ASLA sahip olamaz (kapanınca ses susardı).', updatedAt: null }, v.owner),
      v.lastSpokenManeuverId
        ? observed({ id: 'dl-voice-last', label: 'Son seslendirilen manevra', source: SRC_VOICE,
            note: 'oturum:revizyon:adım — kanonik kimlik.', updatedAt: null }, v.lastSpokenManeuverId)
        : unavailable({ id: 'dl-voice-last', label: 'Son seslendirilen manevra', source: SRC_VOICE,
            note: '', updatedAt: null }, 'bu oturumda anons yapılmadı'),
      v.lastSpokenStage
        ? observed({ id: 'dl-voice-stage', label: 'Son kademe', source: SRC_VOICE,
            note: '', updatedAt: null }, STAGE_LABEL[v.lastSpokenStage])
        : unavailable({ id: 'dl-voice-stage', label: 'Son kademe', source: SRC_VOICE,
            note: '', updatedAt: null }, 'kademe yok'),
      observed({ id: 'dl-voice-count', label: 'Anons sayısı', source: SRC_VOICE,
        note: '', updatedAt: null }, v.spokenCount),
      observed({ id: 'dl-voice-dupe', label: 'Bastırılan tekrar', source: SRC_VOICE,
        note: 'Aynı manevra+kademe ikinci kez KONUŞULMAZ.', updatedAt: null },
        v.duplicateSuppressed),
      observed({ id: 'dl-voice-tracked', label: 'İzlenen manevra', source: SRC_VOICE,
        note: 'Bounded (azami 64) — bellek sızıntısı yok.', updatedAt: null }, v.trackedManeuvers),

      observed({ id: 'dl-dr-state', label: 'Ölü hesaplama durumu', source: SRC_RT,
        note: 'GPS bayatken ilerlemeyi bu sürer.', updatedAt: null },
        DR_RUNTIME_STATE_LABEL[drt.drState]),
      observed({ id: 'dl-dr-owner', label: 'DR sahibi', source: SRC_RT,
        note: 'Eskiden FullMapView RAF döngüsüydü — görünüm kapanınca donuyordu.', updatedAt: null },
        drt.drOwner),
      observed({ id: 'dl-dr-timer', label: 'DR zamanlayıcısı', source: SRC_RT,
        note: 'Timer sahipliği TEK yerde (çift tick = çift ilerleme olurdu).', updatedAt: null },
        drt.drTimerRunning ? 'ÇALIŞIYOR' : 'DURDU'),
      observed({ id: 'dl-dr-ticks', label: 'DR tick sayısı', source: SRC_RT,
        note: '', updatedAt: null }, drt.drTickCount),
      derived({ id: 'dl-dr-dist', label: 'DR tahmini mesafe', source: SRC_RT,
        note: 'Yalnız gözlem — ilerlemeye EKLENMEZ (mutlak eşleştirme kullanılır).',
        updatedAt: null }, `${drt.drDistanceMeters} m`),
      derived({ id: 'dl-dr-conf', label: 'DR güveni', source: SRC_RT,
        note: '0 olduğunda ilerleme DURUR — sahte ilerleme yok.', updatedAt: null },
        drt.drConfidence.toFixed(2)),

      /* ── DR PROJEKSİYON EKSENİ (#451) ────────────────────────────────────
       * Heading doğrultusunda düz projeksiyon virajda koridordan çıkıp
       * `OFF_NETWORK`e düşürüyordu. Eksenin hangi modda olduğu ancak burada
       * GÖRÜNÜR. Ölçüm yoksa `UNAVAILABLE` — sahte segment/mesafe üretilmez. */
      observed({ id: 'dl-dr-axis', label: 'DR projeksiyon ekseni', source: SRC_RT,
        note: 'ALONG_ROUTE = rota geometrisi boyunca. HEADING_FALLBACK = rota çapası yok → eski düz projeksiyon.',
        updatedAt: null },
        drt.drProjectionMode === 'ALONG_ROUTE' ? 'ROTA BOYUNCA' : 'HEADING (yedek)'),
      drt.drConsumedRouteM != null
        ? derived({ id: 'dl-dr-along', label: 'Rota boyunca tüketilen', source: SRC_RT,
            note: 'Rota bitmişse istenenden KÜÇÜK kalır — fazlası yutulmaz.',
            updatedAt: null }, `${drt.drConsumedRouteM} m`)
        : unavailable({ id: 'dl-dr-along', label: 'Rota boyunca tüketilen', source: SRC_RT,
            note: '', updatedAt: null }, 'rota boyunca projeksiyon yok'),
      drt.drProjectionSegIdx != null
        ? observed({ id: 'dl-dr-seg', label: 'DR segment indeksi', source: SRC_RT,
            note: '', updatedAt: null }, String(drt.drProjectionSegIdx))
        : unavailable({ id: 'dl-dr-seg', label: 'DR segment indeksi', source: SRC_RT,
            note: '', updatedAt: null }, 'rota boyunca projeksiyon yok'),

      observed({ id: 'dl-dur-src', label: 'Rota süre kaynağı', source: SRC_DUR,
        note: 'Düz hat OSRM ETA\'sı gibi sunulamaz.', updatedAt: null },
        DURATION_SOURCE_LABEL[s.routeDurationSource]),
      observed({ id: 'dl-dur-integrity', label: 'Süre dizisi bütünlüğü', source: SRC_DUR,
        note: 'VALID değilse kesin ETA üretilmez.', updatedAt: null },
        DURATION_INTEGRITY_LABEL[s.durationIntegrityState]),
      s.totalRouteDurationSeconds != null
        ? observed({ id: 'dl-dur-total', label: 'Toplam rota süresi', source: 'useRouteStore',
            note: '', updatedAt: null }, _ms(s.totalRouteDurationSeconds * 1000))
        : unavailable({ id: 'dl-dur-total', label: 'Toplam rota süresi', source: 'useRouteStore',
            note: '', updatedAt: null }, 'rota yok'),
      s.remainingRouteDurationSeconds != null
        ? derived({ id: 'dl-dur-remain', label: 'Kalan rota süresi', source: SRC_DUR,
            note: 'MUTLAK okunur — geçilen segmentler tekrar eklenmez.', updatedAt: null },
            _ms(s.remainingRouteDurationSeconds * 1000))
        : unavailable({ id: 'dl-dur-remain', label: 'Kalan rota süresi', source: SRC_DUR,
            note: '', updatedAt: null }, 'süre modeli kullanılamıyor'),
      observed({ id: 'dl-rev', label: 'Rota / süre revizyonu', source: 'useRouteStore',
        note: 'Farklıysa ETA BAYAT sayılır ve sayı üretilmez.', updatedAt: null },
        `${_n(s.routeRevision)} / ${_n(s.durationRevision)}`),

      observed({ id: 'dl-eta-state', label: 'ETA durumu', source: SRC_ETA,
        note: 'ROTA SÜRE MODELİ = sağlayıcının kendi süresi kullanıldı.', updatedAt: null },
        ETA_STATE_LABEL[eta.state]),
      eta.etaSeconds != null
        ? derived({ id: 'dl-eta-val', label: 'ETA', source: SRC_ETA,
            note: '', updatedAt: null }, _ms(eta.etaSeconds * 1000))
        : unavailable({ id: 'dl-eta-val', label: 'ETA', source: SRC_ETA,
            note: '', updatedAt: null }, eta.reason),
      eta.baseSeconds != null
        ? derived({ id: 'dl-eta-base', label: 'Düzeltmesiz model süresi', source: SRC_ETA,
            note: 'Anlık hız düzeltmesi uygulanmadan önceki değer.', updatedAt: null },
            _ms(eta.baseSeconds * 1000))
        : unavailable({ id: 'dl-eta-base', label: 'Düzeltmesiz model süresi', source: SRC_ETA,
            note: '', updatedAt: null }, 'model süresi yok'),
      derived({ id: 'dl-eta-factor', label: 'Hız düzeltme çarpanı', source: SRC_ETA,
        note: 'Kırpılır (0.8–1.5) — anlık hız modeli EZEMEZ.', updatedAt: null },
        eta.correctionFactor.toFixed(2)),
      observed({ id: 'dl-eta-reason', label: 'ETA gerekçesi', source: SRC_ETA,
        note: '', updatedAt: null }, eta.reason),
    ],
  });

  /* 13 · İşaret hareketi · takip kamerası (SALT-OKUNUR).
     LAB hiçbir kamera veya hareket davranışını DEĞİŞTİREMEZ.
     Koordinat TAŞINMAZ — konumlar VAR/YOK + doğruluk olarak maskelidir. */
  const mm = s.markerMotion;
  const cp = s.cameraPolicy;
  const SRC_MOTION = 'navMarkerMotionRuntime';
  const SRC_CAM    = 'cameraPolicyModel';
  const SRC_SHADOW = 'cameraShadowRuntime';
  /* Kadans satırlarının kaynağı politika modeli DEĞİL, sönümleme motorudur —
     etiket gerçek kaynağı söylemelidir (kanıt dürüstlüğü). */
  const SRC_DAMP   = 'cameraEngine';
  /* Rota rengi kamera değil HARİTA katmanı kararıdır — kaynak etiketi gerçek
     sahibi söyler (kanıt dürüstlüğü). */
  const SRC_RCOLOR = 'routeColorModel';
  const rcol = s.routeColor;
  const sh = s.cameraShadow;
  const dmp = s.cameraDamping;
  cards.push({
    id: 'motion', title: NAV_CORE_CARD_TITLE.motion,
    fields: [
      observed({ id: 'mo-state', label: 'İşaret hareket durumu', source: SRC_MOTION,
        note: 'Bayat konumda hareket UYDURULMAZ (donar).', updatedAt: null },
        MARKER_MOTION_STATE_LABEL[mm.state]),
      observed({ id: 'mo-raw', label: 'Ham konum (maskeli)', source: SRC_MOTION,
        note: 'Koordinat TAŞINMAZ — yalnız VAR/YOK + doğruluk.', updatedAt: null },
        mm.rawPositionMasked),
      observed({ id: 'mo-rendered', label: 'Çizilen konum (maskeli)', source: SRC_MOTION,
        note: 'Mini ve tam ekran AYNI değeri çizer.', updatedAt: null },
        mm.renderedPositionMasked),
      derived({ id: 'mo-progress', label: 'Ara değer ilerlemesi', source: SRC_MOTION,
        note: '>1 = sınırlı ekstrapolasyon (yalnız araç hareket ederken).', updatedAt: null },
        mm.interpolationProgress.toFixed(3)),
      derived({ id: 'mo-age', label: 'Kaynak yaşı', source: SRC_MOTION,
        note: '', updatedAt: null }, _ms(mm.sourceAgeMs)),
      derived({ id: 'mo-conf', label: 'Hareket güveni', source: SRC_MOTION,
        note: 'Yaş ve GPS doğruluğuyla azalır — TÜREVDİR.', updatedAt: null },
        mm.confidence.toFixed(2)),
      observed({ id: 'mo-samples', label: 'İşlenen örnek', source: SRC_MOTION,
        note: '', updatedAt: null }, mm.sampleCount),
      observed({ id: 'mo-dupruntime', label: 'Çift motion runtime', source: SRC_MOTION,
        note: '0 OLMALI — 1+ ise ikinci bir besleyici doğmuş demektir.', updatedAt: null },
        mm.duplicateMotionRuntimeCount),
      observed({ id: 'mo-reason', label: 'Hareket gerekçesi', source: SRC_MOTION,
        note: '', updatedAt: null }, mm.reason),

      observed({ id: 'cam-state', label: 'Kamera durumu', source: SRC_CAM,
        note: 'Mini ve tam ekran AYNI politikayı kullanır.', updatedAt: null },
        CAMERA_STATE_LABEL[cp.state]),
      observed({ id: 'cam-profile', label: 'Kamera profili', source: SRC_CAM,
        note: 'Versiyonlu profil tablosundan — dağınık sabit YOK.', updatedAt: null },
        `${cp.profileId} · ${cp.policyVersion}`),
      observed({ id: 'cam-speedband', label: 'Hız bandı', source: SRC_CAM,
        note: 'Giriş/çıkış eşikleri AYRI (histerezis) → sınırda salınım yok.', updatedAt: null },
        cp.speedBand),
      observed({ id: 'cam-manband', label: 'Manevra bandı', source: SRC_CAM,
        note: 'YOL-BOYU mesafeden; kuş uçuşu ise NONE.', updatedAt: null },
        cp.maneuverBand),
      derived({ id: 'cam-anchor', label: 'Araç çapası (X / Y)', source: SRC_CAM,
        note: 'Y = üstten oran; dikeyde ileri yola daha çok alan verilir.', updatedAt: null },
        `${cp.anchorX.toFixed(2)} / ${cp.anchorY.toFixed(2)}`),
      s.mapZoom != null
        ? observed({ id: 'cam-zoom', label: 'Harita zoom', source: 'MapLibre',
            note: '', updatedAt: null }, s.mapZoom.toFixed(2))
        : unavailable({ id: 'cam-zoom', label: 'Harita zoom', source: 'MapLibre',
            note: '', updatedAt: null }, 'harita örneği yok'),
      s.mapPitch != null
        ? observed({ id: 'cam-pitch', label: 'Harita pitch', source: 'MapLibre',
            note: '', updatedAt: null }, `${s.mapPitch}°`)
        : unavailable({ id: 'cam-pitch', label: 'Harita pitch', source: 'MapLibre',
            note: '', updatedAt: null }, 'harita örneği yok'),
      s.mapBearing != null
        ? observed({ id: 'cam-bearing', label: 'Harita bearing', source: 'MapLibre',
            note: '', updatedAt: null }, `${s.mapBearing}°`)
        : unavailable({ id: 'cam-bearing', label: 'Harita bearing', source: 'MapLibre',
            note: '', updatedAt: null }, 'harita örneği yok'),
      observed({ id: 'cam-orient', label: 'Ekran yönü / kilit', source: 'navigationOrientation',
        note: 'Ana arayüz YATAY kalır; kilit yalnız tam ekran navigasyonda gevşer.',
        updatedAt: null }, `${s.orientation} · ${s.orientationMode}`),
      observed({ id: 'cam-pan', label: 'Kullanıcı pan durumu', source: 'cameraFollowAuthority',
        note: 'Mini ve tam ekran AYNI takip durumunu paylaşır.', updatedAt: null },
        cam.cameraMode),
      observed({ id: 'cam-recenter2', label: 'Ortala düğmesi', source: 'cameraFollowAuthority',
        note: '', updatedAt: null }, cam.recenterAvailable ? 'GÖRÜNÜR' : 'GİZLİ'),
      observed({ id: 'cam-reason', label: 'Kamera gerekçesi', source: SRC_CAM,
        note: '', updatedAt: null }, cp.updateReason),

      /* ── SÖNÜMLEME KADANSI ──────────────────────────────────────────────
       * Sönümleme alfaları 150 ms'lik tempoda ayarlandı. Tempo saparsa
       * kamera hissi de sapar (τ = −Δt / ln(1−α)). Bu üç satır o sapmayı
       * GÖRÜNÜR kılar: ölçülemeyen Δt `UNAVAILABLE`tır, uydurulmaz. */
      dmp.lastDtMs != null
        ? observed({ id: 'cam-cadence', label: 'Kamera tick aralığı', source: SRC_DAMP,
            note: `Kalibrasyon ${dmp.calibrationDtMs} ms. Sapma alfaları uyarlar, hissi DEĞİŞTİRMEZ.`,
            updatedAt: null }, `${Math.round(dmp.lastDtMs)} ms`)
        : unavailable({ id: 'cam-cadence', label: 'Kamera tick aralığı', source: SRC_DAMP,
            note: '', updatedAt: null }, 'kamera henüz sürülmedi'),
      dmp.effectivePitchTauSec != null
        ? derived({ id: 'cam-tau', label: 'Pitch zaman sabiti (ölçülen / hedef)', source: SRC_DAMP,
            note: 'İkisi YAKIN olmalı — uyarlamanın çalıştığının doğrudan kanıtı.',
            updatedAt: null },
            `${dmp.effectivePitchTauSec.toFixed(2)} s / ${dmp.calibrationPitchTauSec.toFixed(2)} s`)
        : unavailable({ id: 'cam-tau', label: 'Pitch zaman sabiti (ölçülen / hedef)', source: SRC_DAMP,
            note: '', updatedAt: null }, 'kamera henüz sürülmedi'),
      observed({ id: 'cam-offcadence', label: 'Kalibrasyon dışı tick', source: SRC_DAMP,
        note: '0,5×–2× bandı dışındaki çağrı sayısı / toplam. Sıfırdan büyükse üründe kalibre olmayan bir kamera temposu VARDIR.',
        updatedAt: null }, `${dmp.offCadenceTicks} / ${dmp.tickCount}`),

      /* ── ROTA RENGİ — TEK HAKEM (PR-3a) ─────────────────────────────────
       * Boya henüz hiç yazılmadıysa karar UYDURULMAZ → `UNAVAILABLE`. */
      rcol.decision
        ? observed({ id: 'rc-reason', label: 'Rota renk kararı', source: SRC_RCOLOR,
            note: 'Öncelik: TEHLİKE > MANEVRA > NORMAL. Tek karar noktası, tek dedup anahtarı.',
            updatedAt: null }, ROUTE_COLOR_REASON_LABEL[rcol.decision.reason])
        : unavailable({ id: 'rc-reason', label: 'Rota renk kararı', source: SRC_RCOLOR,
            note: '', updatedAt: null }, 'rota rengi henüz yazılmadı'),
      rcol.input
        ? observed({ id: 'rc-input', label: 'Karar girdileri', source: SRC_RCOLOR,
            note: 'Kademe 0=uzak · 1=yaklaşma · 2=kritik. Zemin AÇIK = gündüz VE road modu (uydu/hibrit AÇIK sayılmaz).',
            updatedAt: null },
            `kademe ${rcol.input.maneuverTier} · tehlike ${rcol.input.hazardHigh ? 'VAR' : 'YOK'} · zemin ${rcol.input.lightBasemap ? 'AÇIK' : 'KOYU'}`)
        : unavailable({ id: 'rc-input', label: 'Karar girdileri', source: SRC_RCOLOR,
            note: '', updatedAt: null }, 'rota rengi henüz yazılmadı'),
      rcol.decision
        ? observed({ id: 'rc-applied', label: 'Uygulanan kılıf / halo / çekirdek', source: SRC_RCOLOR,
            note: 'Üçü BİRLİKTE yazılır — biri güncellenip diğeri eskide kalamaz.',
            updatedAt: null },
            `${rcol.decision.casing} / ${rcol.decision.glow} / ${rcol.decision.coreMode}`)
        : unavailable({ id: 'rc-applied', label: 'Uygulanan kılıf / halo / çekirdek', source: SRC_RCOLOR,
            note: '', updatedAt: null }, 'rota rengi henüz yazılmadı'),
      rcol.decision
        ? observed({ id: 'rc-key', label: 'Renk dedup anahtarı', source: SRC_RCOLOR,
            note: 'İki ayrı bayrağın (manevra/risk) yerini alır — K1 kusurunun kapandığı yer.',
            updatedAt: null }, rcol.decision.routeColorKey)
        : unavailable({ id: 'rc-key', label: 'Renk dedup anahtarı', source: SRC_RCOLOR,
            note: '', updatedAt: null }, 'rota rengi henüz yazılmadı'),

      /* ── GÖLGE GÖZLEM (NAVIGATION_CAMERA_SHADOW) ────────────────────────
       * Politika kamerayı SÜRMÜYOR; legacy `cameraEngine` ile yan yana
       * ölçülüyor. Buradaki her sayı GERÇEK `setDrivingView` çağrılarından
       * gelir — sabit/uydurma değer YOKTUR. */
      observed({ id: 'sh-enabled', label: 'Gölge modu', source: SRC_SHADOW,
        note: 'Politika yalnız GÖZLEMLİYOR — kamerayı sürmüyor.', updatedAt: null },
        sh.enabled ? 'AÇIK' : 'KAPALI'),
      observed({ id: 'sh-diverge', label: 'Son karşılaştırma', source: SRC_SHADOW,
        note: 'legacy kararı ↔ politika kararı.', updatedAt: null },
        sh.last ? SHADOW_DIVERGENCE_LABEL[sh.last.divergence] : null),
      sh.last
        ? observed({ id: 'sh-decision', label: 'legacy / politika kararı', source: SRC_SHADOW,
            note: 'Ayrışma, eğri devralınırsa ürünün farklı davranacağı yeri gösterir.',
            updatedAt: null },
            `${sh.last.legacyApplied ? 'UYGULADI' : 'ATLADI'} / ${sh.last.policyAllowed ? 'İZİN' : 'BASTIR'}`)
        : unavailable({ id: 'sh-decision', label: 'legacy / politika kararı', source: SRC_SHADOW,
            note: '', updatedAt: null }, 'henüz kamera çağrısı olmadı'),
      sh.last?.anchorYDelta != null
        ? derived({ id: 'sh-anchor-d', label: 'Çapa farkı (politika − legacy)', source: SRC_SHADOW,
            note: 'legacy çapası ÖLÇÜLDÜ (map.project), türetilmedi.', updatedAt: null },
            sh.last.anchorYDelta.toFixed(3))
        : unavailable({ id: 'sh-anchor-d', label: 'Çapa farkı (politika − legacy)', source: SRC_SHADOW,
            note: '', updatedAt: null }, 'karşılaştırılamadı'),
      sh.last?.zoomDelta != null
        ? derived({ id: 'sh-zoom-d', label: 'Zoom farkı', source: SRC_SHADOW,
            note: '', updatedAt: null }, sh.last.zoomDelta.toFixed(2))
        : unavailable({ id: 'sh-zoom-d', label: 'Zoom farkı', source: SRC_SHADOW,
            note: '', updatedAt: null }, 'politika bu turda zoom ÖNERMİYOR (eğri devralınmadı)'),
      sh.last?.pitchDelta != null
        ? derived({ id: 'sh-pitch-d', label: 'Pitch farkı', source: SRC_SHADOW,
            note: '', updatedAt: null }, sh.last.pitchDelta.toFixed(1))
        : unavailable({ id: 'sh-pitch-d', label: 'Pitch farkı', source: SRC_SHADOW,
            note: '', updatedAt: null }, 'politika bu turda pitch ÖNERMİYOR'),
      derived({ id: 'sh-max', label: 'Azami gözlenen fark (çapa / zoom / pitch)', source: SRC_SHADOW,
        note: 'Oturum boyunca görülen en büyük mutlak fark.', updatedAt: null },
        `${sh.maxAnchorYDelta.toFixed(3)} / ${sh.maxZoomDelta.toFixed(2)} / ${sh.maxPitchDelta.toFixed(1)}`),
      observed({ id: 'sh-eval', label: 'Politika değerlendirmesi', source: SRC_SHADOW,
        note: 'Her legacy kamera çağrısında bir kez.', updatedAt: null },
        sh.policyEvaluationCount),
      observed({ id: 'sh-accept', label: 'Politika KABUL', source: SRC_SHADOW,
        note: '', updatedAt: null }, sh.policyAcceptedCount),
      observed({ id: 'cam-suppressed', label: 'Politika BASTIRMA', source: SRC_SHADOW,
        note: 'GERÇEK sayaç — eğri devralınırsa elenecek kamera işi.', updatedAt: null },
        sh.policySuppressedCount),
      observed({ id: 'sh-legacy-apply', label: 'legacy UYGULADI / ATLADI', source: SRC_SHADOW,
        note: 'Ürün kamerası bu turda DEĞİŞMEDİ.', updatedAt: null },
        `${sh.legacyCameraApplyCount} / ${sh.legacyCameraSkipCount}`),
      observed({ id: 'sh-dupe', label: 'Eşdeğer güncelleme', source: SRC_SHADOW,
        note: 'Ardışık kararı aynı olan güncellemeler.', updatedAt: null },
        sh.duplicateEquivalentUpdateCount),
      sh.lastSuppressionReason
        ? observed({ id: 'sh-supreason', label: 'Son bastırma nedeni', source: SRC_SHADOW,
            note: '', updatedAt: null }, sh.lastSuppressionReason)
        : unavailable({ id: 'sh-supreason', label: 'Son bastırma nedeni', source: SRC_SHADOW,
            note: '', updatedAt: null }, 'bastırma olmadı'),
      sh.last
        ? observed({ id: 'sh-ctx', label: 'Bağlam (hız · manevra · yaş · güven)', source: SRC_SHADOW,
            note: 'Koordinat TAŞINMAZ.', updatedAt: null },
            `${Math.round(sh.last.speedKmh)} km/sa · ${sh.last.maneuverAlongM != null ? `${Math.round(sh.last.maneuverAlongM)} m` : '—'}`
            + ` · ${sh.last.positionAgeMs != null ? `${Math.round(sh.last.positionAgeMs)} ms` : '—'}`
            + ` · ${sh.last.headingConfidence != null ? sh.last.headingConfidence.toFixed(2) : '—'}`)
        : unavailable({ id: 'sh-ctx', label: 'Bağlam (hız · manevra · yaş · güven)', source: SRC_SHADOW,
            note: '', updatedAt: null }, 'henüz gözlem yok'),
    ],
  });

  /* ── 14 · Hedef Bütünlüğü (P0-NAV-09) ────────────────────────────────────
   * ÖLÇÜLEN KUSUR: koordinat kapısı (`isValidDestination`) üründe VARDI ama
   * TÜM hedeflerin geçtiği `startNavigation` onu HİÇ çağırmıyordu — sahiplik
   * sorgulanıyor, GEÇERLİLİK sorulmuyordu. Bu kart o kapının GERÇEKTEN
   * çalıştığının ve zincirin kopmadığının kanıtıdır.
   *
   * GİZLİLİK: hedef ADI ve KOORDİNATI bu karta GİRMEZ — yalnız hüküm,
   * sebep sınıfı, kesinlik, maskeli kimlik ve sayaçlar. */
  const SRC_DEST = 'navigationService.getDestinationIntegritySnapshot';
  cards.push({
    id: 'destination', title: NAV_CORE_CARD_TITLE.destination,
    fields: [
      s.destinationOk === null
        ? unavailable({ id: 'de-ok', label: 'Son hedef hükmü', source: SRC_DEST,
            note: 'Bu oturumda hiç hedef konmadı — "sağlıklı" İDDİA EDİLMEZ.', updatedAt: null },
            'hedef konmadı')
        : observed({ id: 'de-ok', label: 'Son hedef hükmü', source: SRC_DEST,
            note: 'FAIL-CLOSED: reddedilen hedefle rota BAŞLATILMAZ.', updatedAt: null },
            s.destinationOk ? 'KABUL' : 'REDDEDİLDİ'),
      /* "Red yok" bir ÖLÇÜMDÜR (hüküm verildi, ihlal çıkmadı) — kaynak
         yokluğu DEĞİLDİR. UNAVAILABLE yalnız hiç hedef konmadığında doğrudur. */
      s.destinationOk === null
        ? unavailable({ id: 'de-reason', label: 'Red sebebi', source: SRC_DEST,
            note: 'Hüküm verilmedi — "red yok" da İDDİA EDİLMEZ.', updatedAt: null },
            'hedef konmadı')
        : observed({ id: 'de-reason', label: 'Red sebebi', source: SRC_DEST,
            note: s.destinationRejectionCount > 1
              ? `Toplam ${s.destinationRejectionCount} ihlal — ilki gösteriliyor.`
              : '', updatedAt: null },
            s.destinationRejection ?? 'red yok'),
      observed({ id: 'de-rejected', label: 'Reddedilen hedef (oturum)', source: SRC_DEST,
        note: 'Bu sayı 0 değilse kapı GERÇEKTEN iş yapıyor demektir.', updatedAt: null },
        s.destinationRejectedTotal),
      /* Takas ŞÜPHESİ bir DÜZELTME DEĞİLDİR: koordinat asla kendiliğinden
         çevrilmez (aralık denetimi takas edilmiş TR koordinatını yakalayamaz —
         ~36–42 ile ~26–45 örtüşür). Yalnız asimetri KANIT olarak gösterilir. */
      s.destinationSwapSuspected
        ? derived({ id: 'de-swap', label: '⚠️ Enlem/boylam takas şüphesi', source: SRC_DEST,
            note: 'Koordinat DEĞİŞTİRİLMEDİ — yalnız mesafe asimetrisi ölçüldü.', updatedAt: null },
            `verilen ${s.destinationSwapAsGivenKm ?? '—'} km · takas edilmiş ${s.destinationSwapIfSwappedKm ?? '—'} km`)
        : s.destinationSwapAsGivenKm === null
          ? unavailable({ id: 'de-swap', label: 'Enlem/boylam takas şüphesi', source: SRC_DEST,
              note: 'Kullanıcı konumu yok → asimetri ÖLÇÜLEMEZ.', updatedAt: null }, 'ölçülemedi')
          : observed({ id: 'de-swap', label: 'Enlem/boylam takas şüphesi', source: SRC_DEST,
              note: 'Ölçüldü, eşiklerin altında.', updatedAt: null }, 'YOK'),
      observed({ id: 'de-swapcount', label: 'Takas şüphesi (oturum)', source: SRC_DEST,
        note: '', updatedAt: null }, s.destinationSwapSuspectTotal),
      s.destinationPrecision !== null
        ? observed({ id: 'de-precision', label: 'Koordinat kesinliği', source: SRC_DEST,
            note: 'ALAN merkezi bir NOKTA değildir — varış hassasiyeti buna bağlıdır.', updatedAt: null },
            s.destinationPrecision)
        : unavailable({ id: 'de-precision', label: 'Koordinat kesinliği', source: SRC_DEST,
            note: 'Sağlayıcı kesinlik bildirmedi — uydurulmaz.', updatedAt: null }, 'bildirilmedi'),
      s.destinationProvider !== null
        ? observed({ id: 'de-provider', label: 'Hedefi üreten katman', source: SRC_DEST,
            note: '', updatedAt: null }, s.destinationProvider)
        : unavailable({ id: 'de-provider', label: 'Hedefi üreten katman', source: SRC_DEST,
            note: 'Çağıran künye bildirmedi — açık borç.', updatedAt: null }, 'bildirilmedi'),
      s.destinationAgeMs !== null
        ? derived({ id: 'de-age', label: 'Çözümden bu yana', source: SRC_DEST,
            note: 'Bayat arama sonucu bu eksende yakalanır.', updatedAt: null },
            `${Math.round(s.destinationAgeMs / 1000)} sn`)
        : unavailable({ id: 'de-age', label: 'Çözümden bu yana', source: SRC_DEST,
            note: '`resolvedAtMs` bildirilmedi — "bayat" İDDİA EDİLEMEZ.', updatedAt: null },
            'ölçülmedi'),
      s.destinationIdMasked !== null
        ? observed({ id: 'de-id', label: 'Rota isteğine giden kimlik (maskeli)', source: SRC_DEST,
            note: 'Zincirin son halkası. Tam kimlik bu ekrana TAŞINMAZ.', updatedAt: null },
            s.destinationIdMasked)
        : unavailable({ id: 'de-id', label: 'Rota isteğine giden kimlik (maskeli)', source: SRC_DEST,
            note: '', updatedAt: null }, 'hedef sahiplenilmedi'),
    ],
  });

  /* 16 · NAV v3 — L2 EGO / L3 UFUK ─────────────────────────────────────────
   * DÜRÜSTLÜK SINIRI: bu kart yeni bir gerçek ÜRETMEZ; kanonik otoritelerin
   * (`egoAuthority` · `cehAuthority` · `navOrientationFeed`) kendi hükümlerini
   * gösterir. KOORDİNAT TAŞIMAZ. "Ölçülmedi" ile "yok" AYRI basılır. */
  /* `?? null`: eski/kısmi anlık görüntülerde alan HİÇ olmayabilir; `undefined`
     ile `null` aynı hükme (okunamadı) toplanır — sahte değer üretilmez. */
  const _ego = s.ego ?? null;
  const _ceh = s.ceh ?? null;
  const _yaw = s.yawFeed ?? null;
  const _br  = s.egoHorizonBridge ?? null;
  const _gr  = s.graphResidency ?? null;
  const _sh  = s.cehShadow ?? null;
  const _ep  = s.enforcementHorizonPort ?? null;

  cards.push({
    id: 'horizon', title: NAV_CORE_CARD_TITLE.horizon,
    fields: [
      /* ── L2 canlı akış (F2 borcu C2) ── */
      _br === null
        ? unavailable({ id: 'hz-bridge', label: 'Ego/ufuk köprüsü', source: SRC_BRIDGE,
            note: 'Köprü okunamadı — "çalışıyor" İDDİA EDİLMEZ.', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-bridge', label: 'Ego/ufuk tik sayısı', source: SRC_BRIDGE,
            note: 'Tik sahibi navigationSessionRuntime; köprü kendi zamanlayıcısını KURMAZ.',
            updatedAt: null }, _br.ticks),
      _ego === null
        ? unavailable({ id: 'hz-ego-mode', label: 'Ego modu', source: SRC_EGO,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-ego-mode', label: 'Ego modu', source: SRC_EGO,
            note: 'GNSS · GNSS_DR · DR_ONLY · LAST_KNOWN — poz kendi modunu taşır.',
            updatedAt: null }, _ego.mode + ' (' + _ego.modeReason + ')'),
      _ego === null || _ego.sigmaHorizontalM === null
        ? unavailable({ id: 'hz-ego-sigma', label: 'Yatay belirsizlik (1σ)', source: SRC_EGO,
            note: 'EKF henüz konum yayınlamadı — sahte 0 ÜRETİLMEZ.', updatedAt: null }, 'ölçülmedi')
        : derived({ id: 'hz-ego-sigma', label: 'Yatay belirsizlik (1σ)', source: SRC_EGO,
            note: 'Güven yalnız σ değerinden gelir; "GPS var → güven 1" YASAK.', updatedAt: null },
            _ego.sigmaHorizontalM.toFixed(1) + ' m'),
      _ego === null
        ? unavailable({ id: 'hz-ego-rej', label: 'GNSS kabul / red', source: SRC_EGO,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-ego-rej', label: 'GNSS kabul / red', source: SRC_EGO,
            note: 'Reddedilen ölçüm BAŞARI SAYILMAZ — durum güncellenmedi.', updatedAt: null },
            _ego.positionUpdatesAccepted + ' / ' + _ego.positionUpdatesRejected),
      _ego === null
        ? unavailable({ id: 'hz-ego-match', label: 'Yol-ağı eşleşmesi', source: SRC_EGO,
            note: '', updatedAt: null }, 'okunamadı')
        : (_ego.candidateOutcome === null
            ? unavailable({ id: 'hz-ego-match', label: 'Yol-ağı eşleşmesi', source: SRC_EGO,
                note: 'Aday kaynağı hiç sorgulanmadı — "yol dışısın" DEMEK DEĞİLDİR.',
                updatedAt: null }, 'ölçülmedi')
            : derived({ id: 'hz-ego-match', label: 'Yol-ağı eşleşmesi', source: SRC_EGO,
                note: 'F1/B2 açık: RTG2 okuyucusu worker içinde → üretimde aday YOK.',
                updatedAt: null },
                _ego.candidateOutcome + ' · aday ' + _ego.candidateCount
                  + ' · ' + (_ego.matchOutcome ?? 'karar yok'))),

      /* ── C1 · jiro işaret öğrenme ── */
      _yaw === null
        ? unavailable({ id: 'hz-yaw-feed', label: 'Jiro beslemesi', source: SRC_YAW,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-yaw-feed', label: 'Jiro beslemesi', source: SRC_YAW,
            note: 'Abonelik orientationSensorGate üzerinden TEK sahiplikte; oturumla bırakılır.',
            updatedAt: null },
            (_yaw.attached ? 'BAĞLI' : 'KAPALI') + ' · tutucu ' + _yaw.holders
              + ' · olay ' + _yaw.events),
      _yaw === null
        ? unavailable({ id: 'hz-yaw-gate', label: 'Jiro kabul / red', source: SRC_YAW,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-yaw-gate', label: 'Jiro kabul / red', source: SRC_YAW,
            note: 'Red nedenleri sırayla: jiro alanı yok · yerçekimi bandı dışı · zaman damgası yok.',
            updatedAt: null },
            _yaw.accepted + ' / ' + _yaw.rejectedNoGyro + '+' + _yaw.rejectedGravity
              + '+' + _yaw.rejectedTime),
      _yaw === null || _yaw.polarity === 0
        ? unavailable({ id: 'hz-yaw-pol', label: 'Sapma işareti (öğrenilen)', source: SRC_YAW,
            note: 'İşaret GNSS dönüşüyle KANITLANMADI → sapma hızı yayınlanmaz. Yanlış '
              + 'işaret öğretmektense susmak güvenlidir (fail-closed).',
            updatedAt: null }, 'kanıtlanmadı')
        : derived({ id: 'hz-yaw-pol', label: 'Sapma işareti (öğrenilen)', source: SRC_YAW,
            note: 'Montaj açısından BAĞIMSIZ: düşey eksen izdüşümü + GNSS korelasyonu.',
            updatedAt: null },
            (_yaw.polarity > 0 ? '+1' : '-1') + ' · karar ' + _yaw.polarityDecisions),
      _yaw === null || _yaw.yawRateRadPerSec === null
        ? unavailable({ id: 'hz-yaw-rate', label: 'Sapma hızı', source: SRC_YAW,
            note: 'Gerekçe: ' + (_yaw?.yawReason ?? 'okunamadı')
              + '. Jiro yokken EKF yön belirsizliğini ŞİŞİRİR — sahte kesinlik üretilmez.',
            updatedAt: null }, 'kanıt yok')
        : derived({ id: 'hz-yaw-rate', label: 'Sapma hızı', source: SRC_YAW,
            note: 'İz penceresi ortalaması (anlık örnek DEĞİL).', updatedAt: null },
            ((_yaw.yawRateRadPerSec * 180) / Math.PI).toFixed(1) + ' °/sn'),

      /* ── L3 · ufuk ── */
      _ceh === null
        ? unavailable({ id: 'hz-ceh-state', label: 'Ufuk hükmü', source: SRC_CEH,
            note: '', updatedAt: null }, 'okunamadı')
        : derived({ id: 'hz-ceh-state', label: 'Ufuk hükmü', source: SRC_CEH,
            note: '"Ufuk yok" ile "ölçülmedi" ve "eşleşemedi" AYRI hükümlerdir.',
            updatedAt: null }, _ceh.state + ' · üretim ' + _ceh.generation),
      _ceh === null
        ? unavailable({ id: 'hz-ceh-mpp', label: 'MPP / belirsizlik', source: SRC_CEH,
            note: '', updatedAt: null }, 'okunamadı')
        : derived({ id: 'hz-ceh-mpp', label: 'MPP / belirsizlik', source: SRC_CEH,
            note: 'Belirsizlikte HİÇBİR kol MPP değildir — zorla indirgeme YASAK.',
            updatedAt: null },
            (_ceh.mppPresent ? 'MPP VAR' : 'MPP YOK') + ' · kol ' + _ceh.pathCount
              + (_ceh.ambiguous ? ' · BELİRSİZ' : '')),
      _ceh === null
        ? unavailable({ id: 'hz-ceh-phys', label: 'Fiziksel doğrulama', source: SRC_CEH,
            note: '', updatedAt: null }, 'okunamadı')
        : (_ceh.physicallyConfirmed
            ? observed({ id: 'hz-ceh-phys', label: 'Fiziksel doğrulama', source: SRC_CEH,
                note: 'Rota niyeti yol-ağı eşleşmesiyle UYUŞUYOR.', updatedAt: null }, 'DOĞRULANDI')
            : unavailable({ id: 'hz-ceh-phys', label: 'Fiziksel doğrulama', source: SRC_CEH,
                note: 'Aktif rota bir NİYETTİR; aracın o yolda olduğunu KANITLAMAZ. Yol-ağı '
                  + 'eşleşmesi üretimde yoktur (F1/B2).', updatedAt: null }, 'doğrulanmadı')),
      _ceh === null
        ? unavailable({ id: 'hz-ceh-obj', label: 'Ufuk nesnesi / bütçe', source: SRC_CEH,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-ceh-obj', label: 'Ufuk nesnesi / bütçe', source: SRC_CEH,
            note: 'Öznitelik portu (limit · viraj · eğim · denetim) F3 içinde BAĞLANMADI — '
              + 'boş liste "ileride yok" DEMEK DEĞİLDİR.', updatedAt: null },
            _ceh.objectCount + ' nesne · ' + Math.round(_ceh.budgetM) + ' m ufuk'),
      _ceh === null || _ceh.mapAvailable === null
        ? unavailable({ id: 'hz-ceh-map', label: 'L1 yol ağı', source: SRC_CEH,
            note: 'ÖLÇÜLMEDİ — "harita yok" DEMEK DEĞİLDİR.', updatedAt: null }, 'ölçülmedi')
        : derived({ id: 'hz-ceh-map', label: 'L1 yol ağı', source: SRC_CEH,
            note: '', updatedAt: null }, _ceh.mapAvailable ? 'VAR' : 'YOK'),

      /* ── F4 · graf sakinliği (ana iş parçacığı) ── */
      _gr === null
        ? unavailable({ id: 'hz-graph-state', label: 'Graf sakinliği', source: SRC_GRAPH,
            note: '', updatedAt: null }, 'okunamadı')
        : (_gr.state === 'AVAILABLE'
            ? observed({ id: 'hz-graph-state', label: 'Graf sakinliği', source: SRC_GRAPH,
                note: 'Talep-güdümlü: yalnız navigasyon sürerken çözülür ve bırakılır.',
                updatedAt: null }, _gr.state + ' · yükleme ' + _gr.loadCount)
            : unavailable({ id: 'hz-graph-state', label: 'Graf sakinliği', source: SRC_GRAPH,
                note: 'BOZUK/EKSİK graf ASLA "kullanılabilir" sayılmaz; '
                  + 'UNINITIALIZED "graf yok" DEMEK DEĞİLDİR. Gerekçe: '
                  + (_gr.detail ?? 'yok'), updatedAt: null }, _gr.state)),
      _gr === null || _gr.nodeCount === null || _gr.edgeCount === null
        ? unavailable({ id: 'hz-graph-size', label: 'Graf boyutu', source: SRC_GRAPH,
            note: 'Graf çözülmedi — sahte 0 ÜRETİLMEZ.', updatedAt: null }, 'ölçülmedi')
        : observed({ id: 'hz-graph-size', label: 'Graf boyutu', source: SRC_GRAPH,
            note: 'Ayrıştırma TEK kanonik okuyucudadır; worker da aynısını kullanır.',
            updatedAt: null },
            _gr.nodeCount + ' düğüm · ' + _gr.edgeCount + ' kenar'
              + (_gr.version === null ? '' : ' · v' + _gr.version)),
      _gr === null || _gr.parseMs === null
        ? unavailable({ id: 'hz-graph-parse', label: 'Ayrıştırma süresi', source: SRC_GRAPH,
            note: 'Ölçülmedi (graf bu oturumda ayrıştırılmadı).', updatedAt: null }, 'ölçülmedi')
        : derived({ id: 'hz-graph-parse', label: 'Ayrıştırma süresi', source: SRC_GRAPH,
            note: 'Sıcak yolda DEĞİL: yükleme oturum başında bir kez yapılır.',
            updatedAt: null }, _gr.parseMs + ' ms'),
      _gr === null
        ? unavailable({ id: 'hz-graph-derived', label: 'Türetilmiş yapılar', source: SRC_GRAPH,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-graph-derived', label: 'Türetilmiş yapılar', source: SRC_GRAPH,
            note: 'Komşuluk ve yakınlık indeksi TEMBEL kurulur; oturum bitince bırakılır.',
            updatedAt: null },
            'komşuluk ' + (_gr.adjacencyBuilt ? 'VAR' : 'yok')
              + ' · ters ' + (_gr.reverseAdjacencyBuilt ? 'VAR' : 'yok')
              + ' · indeks ' + (_gr.spatialIndexBuilt ? 'VAR' : 'yok')),
      _gr === null || _gr.restrictionCount === null
        ? unavailable({ id: 'hz-graph-restrictions', label: 'Dönüş kısıtları', source: SRC_GRAPH,
            note: 'Graf çözülmedi — kısıt sayısı ÖLÇÜLMEDİ; sahte 0 ÜRETİLMEZ. '
              + 'RTG1/RTG2 grafta dönüş kısıtı YOKTUR (0 = "kayıt yok", '
              + '"kısıt uygulanmıyor" DEĞİL).', updatedAt: null }, 'ölçülmedi')
        : observed({ id: 'hz-graph-restrictions', label: 'Dönüş kısıtları', source: SRC_GRAPH,
            note: 'Kayıt sayısı ve via-way zinciri KANONİK okuyucudan gelir; bu satır '
              + 'kendi hükmünü ÜRETMEZ. Via-way zinciri kenar dizisiyle uygulanır '
              + '(tek kavşak kaydı DEĞİL).', updatedAt: null },
            _gr.restrictionCount + ' kayıt · via-way zinciri '
              + (_gr.viaWayChainCount === null ? 'ölçülmedi' : String(_gr.viaWayChainCount))),

      /* ── RTG4 · SINIRLI SAKİNLİKLE TALEP ÜZERİNE PENCERE ────────────────
       * DÜRÜSTLÜK SINIRI: bu iki satır bir HÜKÜM ÜRETMEZ ve komut GÖNDERMEZ;
       * residency authority'nin kendi ölçtüğü sayıları basar. Bütçe kararı
       * orada verilir, burada yalnız GÖRÜNÜR. */
      _gr === null || _gr.residentGraphBytes === undefined
        ? unavailable({ id: 'hz-graph-window', label: 'Bölge penceresi (yerleşik)', source: SRC_GRAPH,
            note: 'Pencere sakinliği hiç ölçülmedi — sahte 0 bölge/0 bayt ÜRETİLMEZ.',
            updatedAt: null }, 'ölçülmedi')
        : observed({ id: 'hz-graph-window', label: 'Bölge penceresi (yerleşik)', source: SRC_GRAPH,
            note: 'Ülke grafı TEK PARÇA yüklenmez. Tavan pazarlıksızdır; uzun rota '
              + 'tavanı yükselterek değil, pencereyi kaydırarak çözülür.',
            updatedAt: null },
            (_gr.residentRegions?.length ?? 0) + '/' + _gr.maxResidentRegions + ' bölge · '
              + _gr.residentGraphBytes + '/' + _gr.maxResidentGraphBytes + ' B · tepe '
              + _gr.peakResidentRegions + ' bölge / ' + _gr.peakResidentGraphBytes + ' B'),
      _gr === null || _gr.onDemandRegionLoads === undefined
        ? unavailable({ id: 'hz-graph-ondemand', label: 'Talep üzerine yükleme / tahliye', source: SRC_GRAPH,
            note: 'Talep üzerine yükleme hiç ölçülmedi — sahte "0 yükleme" ÜRETİLMEZ.',
            updatedAt: null }, 'ölçülmedi')
        : observed({ id: 'hz-graph-ondemand', label: 'Talep üzerine yükleme / tahliye', source: SRC_GRAPH,
            note: 'Tahliye güvenlidir: arama durumu worker katmanında yaşar ve bölge belleği '
              + 'bırakıldıktan sonra da rota YENİDEN KURULABİLİR. Fail-closed nedeni '
              + 'yoksa "yok" basılır — sahte "sağlıklı" ÜRETİLMEZ.',
            updatedAt: null },
            _gr.onDemandRegionLoads + ' yükleme · ' + _gr.regionEvictions + ' tahliye · '
              + 'son red: ' + (_gr.windowFailClosedReason ?? 'yok')),

      /* ── F5 · GÖLGE KARŞILAŞTIRMA + CUTOVER KAPISI ─────────────────────
       * DÜRÜSTLÜK SINIRI: bu satırlar bir HÜKÜM ÜRETMEZ. Gölge katmanı
       * üretim kararını değiştirmez; burada yalnız legacy ↔ CEH farkının
       * SAYILARI ve kapının neden kapalı olduğu basılır. */
      _sh === null
        ? unavailable({ id: 'hz-shadow-mode', label: 'Gölge koşumu', source: SRC_CEH_SHADOW,
            note: 'Gölge katmanı okunamadı — "ölçülüyor" İDDİA EDİLMEZ.',
            updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-shadow-mode', label: 'Gölge koşumu', source: SRC_CEH_SHADOW,
            note: 'Gölge SUNMAZ: bu katmandan sürücüye ses/uyarı çıkmaz — yan '
              + 'etki sayısı yapısal olarak 0\'dır. Tik sahibi ego/ufuk '
              + 'köprüsüdür; gölge kendi zamanlayıcısını KURMAZ.',
            updatedAt: null },
            (_sh.active ? 'AKTİF' : 'boşta') + ' · tik ' + _sh.ticks
              + ' · yan etki ' + _sh.sideEffectCount
              + ' · hata ' + _sh.errorCount),
      _sh === null
        ? unavailable({ id: 'hz-shadow-authority', label: 'Üretim otoritesi', source: SRC_CEH_SHADOW,
            note: '', updatedAt: null }, 'okunamadı')
        : derived({ id: 'hz-shadow-authority', label: 'Üretim otoritesi', source: SRC_CEH_SHADOW,
            note: 'F4 saha doğrulaması (kütük #1232–#1243) tamamlanmadan CEH '
              + 'kaynaklı kararlar üretim-otoriter OLAMAZ. Guardian uyarısı ve '
              + 'sesli yönlendirme kararı LEGACY sahiplerinde kalır.',
            updatedAt: null },
            _sh.cutover.open ? 'CEH (cutover AÇIK)' : 'LEGACY · CEH yalnız GÖLGE'),
      _sh === null
        ? unavailable({ id: 'hz-shadow-maneuver', label: 'Gölge · manevra', source: SRC_CEH_SHADOW,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-shadow-maneuver', label: 'Gölge · manevra', source: SRC_CEH_SHADOW,
            note: 'Legacy: routeState.distanceToNextTurnMeters (sesli yönlendirmenin '
              + 'BUGÜN kullandığı sayı). CEH: rota niyetinden üretilen ufuk manevrası. '
              + 'Fark, yöntemin değil SONUCUN farkıdır.',
            updatedAt: null },
            _sh.domains.MANEUVER.samples + ' örnek · uyum '
              + _sh.domains.MANEUVER.agree + ' · fark ' + _sh.domains.MANEUVER.divergences
              + ' · maxΔ ' + (_sh.domains.MANEUVER.maxAbsDeltaM === null
                ? 'ölçülmedi' : Math.round(_sh.domains.MANEUVER.maxAbsDeltaM) + ' m')),
      _sh === null
        ? unavailable({ id: 'hz-shadow-enforce', label: 'Gölge · denetim noktası', source: SRC_CEH_SHADOW,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-shadow-enforce', label: 'Gölge · denetim noktası', source: SRC_CEH_SHADOW,
            note: 'Legacy kuş uçuşu + yön konisiyle ölçer, CEH yol-boyu ister — '
              + 'yöntem farkı korunur. "Legacy var / CEH ölçmedi" bir KUSUR değil, '
              + 'öznitelik portunun bağlanmamış olmasının ÖLÇÜMÜDÜR.',
            updatedAt: null },
            _sh.domains.ENFORCEMENT.samples + ' örnek · yalnız legacy '
              + _sh.domains.ENFORCEMENT.legacyOnly + ' · yalnız CEH '
              + _sh.domains.ENFORCEMENT.cehOnly + ' · ortak yok '
              + _sh.domains.ENFORCEMENT.bothAbsent),
      _sh === null
        ? unavailable({ id: 'hz-shadow-attr', label: 'Gölge · limit/viraj/eğim', source: SRC_CEH_SHADOW,
            note: '', updatedAt: null }, 'okunamadı')
        : derived({ id: 'hz-shadow-attr', label: 'Gölge · limit/viraj/eğim', source: SRC_CEH_SHADOW,
            note: 'Üretimde "İLERİDE limit/viraj/eğim var mı" sorusunu cevaplayan '
              + 'otorite YOKTUR (speedLimitService BULUNULAN yolu bilir). Bu yüzden '
              + 'karşılaştırma KARŞILAŞTIRILAMAZ sayılır ve oranın paydasına GİRMEZ '
              + '— hiç sormayarak %100 uyum kazanmak YASAK.',
            updatedAt: null },
            'karşılaştırılamaz ' + (_sh.domains.SPEED_LIMIT.notComparable
              + _sh.domains.CURVE.notComparable + _sh.domains.ROAD_PROFILE.notComparable)
              + ' · öznitelik portu ' + (_sh.attributePortsBound ? 'BAĞLI' : 'bağlı değil')),
      _sh === null || _sh.divergenceRatio === null
        ? unavailable({ id: 'hz-shadow-ratio', label: 'Gölge · fark oranı', source: SRC_CEH_SHADOW,
            note: 'Karşılaştırılabilir örnek YOK → oran hesaplanamaz. "%0 sapma" '
              + 'İDDİA EDİLMEZ (hiç ölçmeyerek uyum kazanmak yalandır).',
            updatedAt: null }, 'ölçülmedi')
        : derived({ id: 'hz-shadow-ratio', label: 'Gölge · fark oranı', source: SRC_CEH_SHADOW,
            note: 'Pay = gerçek fark (mesafe/varlık/tek taraflı). Payda = '
              + 'karşılaştırılabilir örnek. Belirsizlik ve ortak bilgisizlik '
              + 'PAYDAYA GİRMEZ.', updatedAt: null },
            (_sh.divergenceRatio * 100).toFixed(2) + ' % · '
              + _sh.total.divergences + '/' + _sh.total.comparable),
      _sh === null || _sh.guardianShadow === null
        ? unavailable({ id: 'hz-shadow-guardian', label: 'Gölge · Guardian hükmü', source: SRC_CEH_SHADOW,
            note: 'Gölge hüküm henüz üretilmedi — Guardian üretim yolu bundan '
              + 'ETKİLENMEZ (bu satır yalnız gözlemdir).', updatedAt: null }, 'üretilmedi')
        : derived({ id: 'hz-shadow-guardian', label: 'Gölge · Guardian hükmü', source: SRC_CEH_SHADOW,
            note: 'Guardian gerçek uyarı kararı LEGACY zincirinden gelir '
              + '(providers → adapters → rules → engine). Bu satır yalnız '
              + '"kapı açık olsaydı ne olurdu" sorusunun cevabıdır.',
            updatedAt: null },
            (_sh.guardianShadow.wouldEmit ? 'UYARIRDI' : 'susardı')
              + ' · engel ' + (_sh.guardianShadow.blockedBy ?? 'yok')
              + ' · toplam ' + _sh.guardianWouldEmitCount),
      _sh === null
        ? unavailable({ id: 'hz-shadow-suppress', label: 'Gölge · bastırma akıbeti', source: SRC_CEH_SHADOW,
            note: '', updatedAt: null }, 'okunamadı')
        : observed({ id: 'hz-shadow-suppress', label: 'Gölge · bastırma akıbeti', source: SRC_CEH_SHADOW,
            note: 'Geçerlilik ufku (validUntil) OLMAYAN bir olay ERTELENEMEZ — '
              + 'kanıtsız erteleme, geçmiş bir uyarıyı geleceğe taşımaktır. '
              + '"Sunuldu" sayısı gölgede yapısal olarak 0 kalır.',
            updatedAt: null },
            'değerlendirme ' + _sh.suppression.evaluated
              + ' · ertelenebilir ' + _sh.suppression.deferred
              + ' · geçerlilik yok ' + _sh.suppression.droppedNoValidity
              + ' · sunuldu ' + _sh.suppression.delivered),
      _sh === null
        ? unavailable({ id: 'hz-shadow-gate', label: 'Cutover kapısı', source: SRC_CEH_SHADOW,
            note: '', updatedAt: null }, 'okunamadı')
        : derived({ id: 'hz-shadow-gate', label: 'Cutover kapısı', source: SRC_CEH_SHADOW,
            note: 'Varsayılan KAPALI. Her şart üç değerlidir: kanıtlandı / düştü / '
              + 'ÖLÇÜLMEDİ — ölçülmemiş şart kapıyı AÇMAZ. Saha hükmünü üreten bir '
              + 'çalışma-zamanı kaynağı yoktur; kütük mutlak otoritedir.',
            updatedAt: null },
            _sh.cutover.state + ' · eksik ' + _sh.cutover.unmet.length + '/'
              + (_sh.cutover.unmet.length + _sh.cutover.met.length)
              + ' · ölçülmedi ' + _sh.cutover.unmeasuredCount
              + (_sh.cutover.unmet.length === 0 ? ''
                : ' · ' + _sh.cutover.unmet.map((c) => CEH_CUTOVER_CONDITION_LABEL[c]).join(', '))),

      /* ── F6 · SINIRLI KORİDOR + KENAR-TABANLI DENETİM NOKTASI ────────────
       * Üretim kararı ÜRETMEZ — yalnız F6 zincirinin (koridor genişleme →
       * eşleştirme → CEH ahead nesnesi) gerçekten çalıştığının kanıtı. */
      _ep === null
        ? unavailable({ id: 'hz-corridor', label: 'Koridor genişlemesi (son)', source: SRC_ENFORCEMENT_PORT,
            note: '', updatedAt: null }, 'okunamadı')
        : (_ep.lastCorridorOutcome === null
            ? unavailable({ id: 'hz-corridor', label: 'Koridor genişlemesi (son)', source: SRC_ENFORCEMENT_PORT,
                note: 'Port hiç çağrılmadı (fiziksel eşleşme yok) — ölçülmedi.', updatedAt: null }, 'ölçülmedi')
            : derived({ id: 'hz-corridor', label: 'Koridor genişlemesi (son)', source: SRC_ENFORCEMENT_PORT,
                note: 'BUDGET_EXHAUSTED/COMPLETE bir KESME değildir; EDGE/NODE/DEPTH_LIMIT '
                  + 'bir tavanın dolduğunu, "ileride yok" iddiası KURULAMADIĞINI gösterir.',
                updatedAt: null },
                _ep.lastCorridorOutcome + ' · ' + _ep.lastCorridorEdgeCount + ' kenar · '
                  + _ep.lastCorridorNodeExpansions + ' düğüm genişletme · dal '
                  + _ep.lastCorridorBranchCount
                  + (_ep.lastCorridorTruncated === null ? ''
                    : _ep.lastCorridorTruncated ? ' · KESİLDİ (yokluk iddiası KURULAMAZ)'
                      : ' · eksiksiz tarandı'))),
      _ep === null
        ? unavailable({ id: 'hz-enforce-match', label: 'Denetim noktası eşleştirme', source: SRC_ENFORCEMENT_PORT,
            note: '', updatedAt: null }, 'okunamadı')
        : derived({ id: 'hz-enforce-match', label: 'Denetim noktası eşleştirme', source: SRC_ENFORCEMENT_PORT,
            note: 'AMBIGUOUS_EDGE yanlış carriageway korumasıdır — "eşleşmedi" DEĞİL '
              + '"iki yol ayırt edilemedi, susuldu" demektir.',
            updatedAt: null },
            'bağlı ' + _ep.cumulativeMatch.matchedToEdge + ' · belirsiz ' + _ep.cumulativeMatch.ambiguousEdge
              + ' · eşleşmedi ' + _ep.cumulativeMatch.noEdgeMatch + ' · kapsam dışı '
              + _ep.cumulativeMatch.outsideCoverage + ' · ölçülmedi ' + _ep.cumulativeMatch.notMeasured),
      _ep === null || _ep.lastDurationMs === null
        ? unavailable({ id: 'hz-enforce-cost', label: 'Port sıcak-yol maliyeti (son)', source: SRC_ENFORCEMENT_PORT,
            note: 'Gerçek cihazda ÖLÇÜLMEDİ — yalnız host/kod ölçümü rapor edilmiştir.',
            updatedAt: null }, 'ölçülmedi')
        : observed({ id: 'hz-enforce-cost', label: 'Port sıcak-yol maliyeti (son)', source: SRC_ENFORCEMENT_PORT,
            note: 'Gerçek cihazda ÖLÇÜLMEDİ — yalnız host/kod ölçümü rapor edilmiştir.',
            updatedAt: null }, Math.round(_ep.lastDurationMs * 100) / 100 + ' ms · çağrı ' + _ep.calls),
    ],
  });


  return cards;
}

/** Sınıf sayacı — ekran başlığındaki ÖLÇÜLDÜ/TÜRETİLDİ/KAYNAK YOK rozeti. */
export function countByNavCoreClass(
  cards: readonly NavCoreCard[],
): Record<'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE', number> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}
