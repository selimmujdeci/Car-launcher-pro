import type { StandardPidDef } from './StandardPidRegistry';
import { CANONICAL_OBD_BY_PID } from './canonicalObdSignals';
import {
  classifyFreshness,
  computeFreshnessWindow,
  type ObdFreshnessState,
} from './obdFreshnessPolicy';
import type { Mode22Evidence } from './manufacturerPidService';

export type LivePidRowStatus =
  | 'fresh' | 'stale' | 'suspect' | 'unsupported'
  | 'nodata' | 'discovering' | 'waiting' | 'nolink';

export interface SupportedPidSummary {
  readonly supported: number | null;
  readonly readable: number;
  readonly active: number;
  readonly catalog: number;
  readonly label: string;
}

/** Katalog büyüklüğünü başarı paydası yapmadan destek/okuma gerçeğini özetler. */
export function buildSupportedPidSummary(
  rows: readonly { supported: boolean | null; status: LivePidRowStatus }[],
  supportKnown: boolean,
): SupportedPidSummary {
  const readableStatus = (s: LivePidRowStatus): boolean => s === 'fresh' || s === 'stale';
  const readable = rows.filter((r) => readableStatus(r.status)).length;
  const active = rows.filter((r) => r.status === 'fresh').length;
  // Gerçek çözülen değer, bitmap eksik olsa bile bu PID için doğrudan destek kanıtıdır.
  const supported = rows.filter((r) => r.supported === true || readableStatus(r.status)).length;
  return {
    supported: supportKnown ? supported : null,
    readable,
    active,
    catalog: rows.length,
    label: supportKnown
      ? `${readable} / ${supported} desteklenen veri okunuyor`
      : readable > 0
        ? `${readable} veri okunuyor · destek kapsamı belirleniyor`
        : 'Desteklenen veriler belirleniyor',
  };
}

/** Çekirdek PID tazeliğini sinyal sınıfı + aktif poll penceresinden türetir. */
export function classifyCorePidFreshness(
  def: StandardPidDef,
  measuredAtMs: number,
  nowMs: number,
  coreWindowMs: number,
): ObdFreshnessState {
  const cls = CANONICAL_OBD_BY_PID.get(def.pid)?.freshness ?? 'medium';
  return classifyFreshness({
    hasValue: measuredAtMs > 0,
    measuredAtMs,
    nowMs,
    window: computeFreshnessWindow({ cls, path: 'core', coreWindowMs }),
  }).state;
}

export type OemDiscoveryState = 'DISCOVERING' | 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN' | 'ERROR';
export const OEM_DISCOVERY_WINDOW_MS = 12_000;

/** Mode-22 kanıtını sonlu, kullanıcıya gösterilebilir bir state machine'e çevirir. */
export function resolveOemDiscoveryState(
  evidence: Pick<Mode22Evidence, 'decision'>,
  nowMs: number,
  discoveryStartedAtMs: number | null,
): OemDiscoveryState {
  switch (evidence.decision) {
    case 'HAS_REAL_VALUE':    return 'SUPPORTED';
    case 'ALL_UNSUPPORTED':
    case 'PROTOCOL_MISMATCH': return 'UNSUPPORTED';
    case 'COMM_FAILING':      return 'ERROR';
    case 'NOT_PROBED':
      return discoveryStartedAtMs !== null && nowMs - discoveryStartedAtMs <= OEM_DISCOVERY_WINDOW_MS
        ? 'DISCOVERING' : 'UNKNOWN';
    case 'NO_PROFILE':
    case 'INCONCLUSIVE':
    default:                  return 'UNKNOWN';
  }
}
