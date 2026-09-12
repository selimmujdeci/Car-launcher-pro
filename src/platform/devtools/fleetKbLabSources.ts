/**
 * fleetKbLabSources — Filo Hafızası ekranının TEK OKUMA KATMANI (senkron).
 *
 * İnce bir sarmalayıcıdır ve tek işi FAIL-SOFT olmaktır: `getFleetKbSnapshot()`
 * depolama bozulmasında fırlatırsa ekran boş kalmasın, AÇIK hata mesajıyla çizilsin.
 *
 * ⚠️ Yazma ucu YOKTUR: bu katman öğrenme tetiklemez, profil silmez, tarama başlatmaz.
 */
import {
  getFleetKbSnapshot, MAX_FLEET_PROFILES,
  type FleetKbSnapshot,
} from '../obd/fleetKbService';

export interface FleetKbRawSnapshot {
  readonly readAt: number;
  /** `null` = hafıza hiç okunamadı (servis fırlattı) — "profil yok" DEĞİL. */
  readonly kb: FleetKbSnapshot | null;
  readonly error: string | null;
}

export function readFleetKbLabSnapshot(): FleetKbRawSnapshot {
  try {
    const kb = getFleetKbSnapshot();
    return { readAt: kb.readAt, kb, error: kb.error };
  } catch (e) {
    return {
      readAt: Date.now(),
      kb: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export { MAX_FLEET_PROFILES };
