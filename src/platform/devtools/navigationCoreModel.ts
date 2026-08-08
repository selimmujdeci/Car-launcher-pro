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
import { ROUTE_COLOR_REASON_LABEL } from '../map/core/routeColorModel';
import {
  PROVIDER_READINESS_LABEL, ROUTE_SOURCE_LABEL,
} from '../navigation/core/routeProviderReadiness';
import { REQUEST_OUTCOME_LABEL } from '../navigation/core/routeRequestLedger';
import { offlineGraphStateLabel } from '../navigation/offlineRoutingStatus';
import { SPEED_LIMIT_STATE_LABEL } from '../navigation/core/speedLimitTruthModel';
import {
  EFFECTIVE_LIMIT_STATE_LABEL,
} from '../navigation/core/vehicleAwareSpeedLimitAuthority';
import { ROAD_CLASS_LABEL } from '../navigation/policy/turkeySpeedPolicy';
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
  | 'vehicleclass' | 'delivery' | 'motion';

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

  /* 1 · Durum */
  cards.push({
    id: 'state', title: NAV_CORE_CARD_TITLE.state,
    fields: [
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
        ? `#${s.mapMatchSegIdx} / ${Math.max(0, s.geometryPoints - 1)}` : 'yok'));
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
        updatedAt: OBS }, `${s.offRouteEvidence} / ${s.offRouteRequired}`),
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
  cards.push({ id: 'validation', title: NAV_CORE_CARD_TITLE.validation, fields: vFields });

  /* 7 · Manevra mesafesi */
  cards.push({
    id: 'maneuver', title: NAV_CORE_CARD_TITLE.maneuver,
    fields: [
      observed({ id: 'mv-source', label: 'Mesafe yöntemi', source: 'routingService',
        note: 'KUŞ UÇUŞU virajlı yaklaşımda GERÇEK yol mesafesinden kısa çıkar → erken anons.',
        updatedAt: OBS }, MANEUVER_SOURCE_LABEL[s.nextManeuverDistanceSource]),
      s.nextManeuverDistanceM != null && s.nextManeuverDistanceSource !== 'UNKNOWN'
        ? observed({ id: 'mv-dist', label: 'Sonraki manevraya', source: 'routingService',
            note: '', updatedAt: OBS }, _m(s.nextManeuverDistanceM))
        : unavailable({ id: 'mv-dist', label: 'Sonraki manevraya', source: 'routingService',
            note: '', updatedAt: OBS }, 'konum bilinmiyor — mesafe uydurulmaz'),
      observed({ id: 'mv-step', label: 'Aktif adım', source: 'useRouteStore',
        note: '', updatedAt: OBS }, `${s.currentStepIndex} / ${Math.max(0, s.stepCount - 1)}`),
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
        note: '', updatedAt: null }, `${s.geometryPoints} nokta · ${_m(s.totalRouteDistanceM)}`),
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
        `${s.routeRevision} / ${s.durationRevision}`),

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
