/**
 * contextPolicyTypes — politika tipleri (IO YOK, döngüsel import olmasın diye ayrı).
 */

/** Bir görev tipinde hangi canlı alanların taşınabileceği. */
export type ContextLiveField = 'rpm' | 'speedKph' | 'coolantC' | 'fuelPercent' | 'batteryVoltage';

export interface MaviTaskFieldPolicy {
  readonly includeConnection:  boolean;
  readonly includeIdentity:    boolean;
  readonly includeSession:     boolean;
  /** ALLOWLIST — burada olmayan canlı alan TAŞINMAZ. */
  readonly liveFields:         readonly ContextLiveField[];
  readonly includeDiagnostics: boolean;
}

export type { ContextBudget } from './contextTypes';
