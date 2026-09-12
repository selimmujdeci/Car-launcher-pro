/**
 * routeProviderReadiness.ts — Rota sağlayıcılarının DÜRÜST hazırlık durumu.
 *
 * Timer YOK · React YOK · ağ YOK (ölçümü çağıran yapar, sonucu buraya YAZAR).
 * Saat dışarıdan gelir. Modül düzeyi kayıt — `offlineRoutingStatus.ts` deseni.
 *
 * ── ÇÖZDÜĞÜ ARIZA (denetim §4.2, cihazda ölçüldü) ───────────────────────────
 * Android'de `http://localhost:5000` adresinde bir OSRM daemon YOKTUR. Buna
 * rağmen `fetchRoute` **her rotada** oraya istek atıyor ve 3 sn timeout'a
 * kadar bekleyebiliyordu. Bu ölü katman, sapma anında en kritik yerde —
 * reroute gecikmesine doğrudan ekleniyordu.
 *
 * Çözüm: yerel sağlayıcı hazırlığı **oturumda BİR KEZ, sınırlı süreyle**
 * ölçülür. Sonuç `LOCAL_OSRM_UNAVAILABLE` ise bir daha DENENMEZ. Bu bir
 * "sessiz gizleme" değildir: durum CAROS LAB'da adıyla görünür.
 */

export type ProviderReadiness =
  /** Henüz ölçülmedi. */
  | 'UNKNOWN'
  /** Yerel OSRM daemon yanıt verdi. */
  | 'LOCAL_OSRM_AVAILABLE'
  /** Yerel daemon yok/yanıt vermiyor — bir daha denenmez. */
  | 'LOCAL_OSRM_UNAVAILABLE'
  /** Yerel yok ama uzak sağlayıcı kullanılabilir. */
  | 'REMOTE_PROVIDER_AVAILABLE'
  /** Hiçbir gerçek rota sağlayıcısı yok (yalnız düz-hat kalır). */
  | 'NO_ROUTE_PROVIDER';

/** Rota kaynağının ne olduğu — düz hat GERÇEK ROTA SAYILMAZ. */
export type RouteSourceKind =
  | 'LOCAL_DAEMON'
  | 'REMOTE_OSRM'
  | 'OFFLINE_GRAPH'
  | 'STRAIGHT_LINE_GUIDANCE'
  | 'NONE';

/** Yerel daemon yoklaması bu süreyi AŞAMAZ (sınırlı kontrol). */
export const LOCAL_PROBE_TIMEOUT_MS = 700;

let _local: ProviderReadiness = 'UNKNOWN';
let _localProbedAtMs: number | null = null;
let _localProbeCount = 0;
let _localSkippedCount = 0;

let _lastSource: RouteSourceKind = 'NONE';
let _lastProviderLabel: string | null = null;
let _straightLineCount = 0;
let _remoteFailureCount = 0;

/**
 * Yerel daemon YOKLANMALI mı?
 * `UNKNOWN` dışındaki her durumda `false` — oturumda tek yoklama.
 * Bir daemon uygulama oturumu içinde kendiliğinden BELİRMEZ.
 */
export function shouldProbeLocalDaemon(): boolean {
  if (_local === 'UNKNOWN') return true;
  _localSkippedCount++;
  return false;
}

/** Yoklama sonucunu kaydet. */
export function recordLocalDaemonProbe(available: boolean, nowMs: number): void {
  _local = available ? 'LOCAL_OSRM_AVAILABLE' : 'LOCAL_OSRM_UNAVAILABLE';
  _localProbedAtMs = nowMs;
  _localProbeCount++;
}

/** Kullanılan rota kaynağını kaydet. */
export function recordRouteSource(kind: RouteSourceKind, providerLabel: string | null): void {
  _lastSource = kind;
  _lastProviderLabel = providerLabel;
  if (kind === 'STRAIGHT_LINE_GUIDANCE') _straightLineCount++;
}

export function recordRemoteFailure(): void {
  _remoteFailureCount++;
}

/**
 * Genel sağlayıcı hükmü.
 * `onlineHint` çağıranın gözlemidir (`navigator.onLine`) — bu modül DOM okumaz.
 * `offlineGraphUsable` çevrimdışı grafiğin gerçekten kullanılabilir olup olmadığı.
 */
export function resolveProviderReadiness(
  onlineHint: boolean,
  offlineGraphUsable: boolean,
): ProviderReadiness {
  if (_local === 'LOCAL_OSRM_AVAILABLE') return 'LOCAL_OSRM_AVAILABLE';
  if (onlineHint) return 'REMOTE_PROVIDER_AVAILABLE';
  if (offlineGraphUsable) return 'REMOTE_PROVIDER_AVAILABLE';
  return 'NO_ROUTE_PROVIDER';
}

export interface ProviderReadinessSnapshot {
  readonly localState: ProviderReadiness;
  readonly localProbedAtMs: number | null;
  readonly localProbeCount: number;
  readonly localSkippedCount: number;
  readonly lastSource: RouteSourceKind;
  readonly lastProviderLabel: string | null;
  readonly straightLineCount: number;
  readonly remoteFailureCount: number;
}

export function getProviderReadinessSnapshot(): ProviderReadinessSnapshot {
  return {
    localState: _local,
    localProbedAtMs: _localProbedAtMs,
    localProbeCount: _localProbeCount,
    localSkippedCount: _localSkippedCount,
    lastSource: _lastSource,
    lastProviderLabel: _lastProviderLabel,
    straightLineCount: _straightLineCount,
    remoteFailureCount: _remoteFailureCount,
  };
}

export function _resetProviderReadinessForTest(): void {
  _local = 'UNKNOWN'; _localProbedAtMs = null; _localProbeCount = 0; _localSkippedCount = 0;
  _lastSource = 'NONE'; _lastProviderLabel = null;
  _straightLineCount = 0; _remoteFailureCount = 0;
}

export const PROVIDER_READINESS_LABEL: Readonly<Record<ProviderReadiness, string>> = {
  UNKNOWN:                   'ÖLÇÜLMEDİ',
  LOCAL_OSRM_AVAILABLE:      'YEREL OSRM VAR',
  LOCAL_OSRM_UNAVAILABLE:    'YEREL OSRM YOK (bir daha denenmez)',
  REMOTE_PROVIDER_AVAILABLE: 'UZAK SAĞLAYICI KULLANILABİLİR',
  NO_ROUTE_PROVIDER:         'ROTA SAĞLAYICISI YOK',
} as const;

export const ROUTE_SOURCE_LABEL: Readonly<Record<RouteSourceKind, string>> = {
  LOCAL_DAEMON:           'YEREL DAEMON',
  REMOTE_OSRM:            'UZAK OSRM',
  OFFLINE_GRAPH:          'ÇEVRİMDIŞI GRAF',
  STRAIGHT_LINE_GUIDANCE: 'DÜZ HAT YÖNLENDİRME (rota DEĞİL)',
  NONE:                   'YOK',
} as const;
