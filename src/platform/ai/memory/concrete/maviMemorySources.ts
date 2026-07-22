/**
 * maviMemorySources — hafıza kaynaklarının GERÇEK bağlaması (concrete binding).
 *
 * ⚠️ YENİ DEPO YOK. Mevcut otoriteler SALT-OKUNUR biçimde okunur:
 *   - `companion/companionMemory.getFacts()` → kullanıcı tercihleri (kalıcı)
 *   - `aiCore/vehicleMemory` → araç geçmişi (fingerprint-anahtarlı, kalıcı)
 *   - `shortTermMemory` → süreç-ömürlü oturum kayıtları (RAM)
 *
 * Yazma/silme yolları DEĞİŞTİRİLMEZ: kullanıcı "şunu hatırla/unut" dediğinde
 * mevcut akış aynen çalışır; bu dosya yalnız OKUR.
 *
 * Araç geçmişi bugün OPSİYONELDİR: `vehicleMemory` deposu uygulamada henüz
 * wire edilmemiştir ve aktif araç fingerprint'i sağlanmadan okunamaz. Bu yüzden
 * fingerprint DI ile gelir; yoksa araç geçmişi BOŞ döner (uydurma yok).
 */

import { getFacts } from '../../../companion/companionMemory';
import { getShortTermMemory } from '../shortTermMemory';
import type { MemoryRecord, MemorySources } from '../memoryTypes';

/** Araç geçmişi okuyucusu — depo + aktif fingerprint DI ile verilir. */
export interface VehicleHistoryPort {
  recall(fingerprintHash: string): readonly { statement: string; confidence: number; lastSeen: number }[];
}

export interface MaviMemorySourcesDeps {
  /** Aktif aracın fingerprint hash'i — YOKSA araç geçmişi okunmaz. */
  readonly vehicleFingerprint?: () => string | undefined;
  readonly vehicleHistory?:     VehicleHistoryPort;
}

/**
 * Üretim kaynak seti. Tüm okumalar fail-soft: kaynak patlarsa boş liste döner
 * ve motor diğer türlerle devam eder.
 */
export function createMaviMemorySources(deps: MaviMemorySourcesDeps = {}): MemorySources {
  return {
    readUserPreferences: (): readonly string[] => {
      try {
        return getFacts().map((f) => f.text);
      } catch {
        return [];
      }
    },

    readVehicleHistory: () => {
      try {
        const port = deps.vehicleHistory;
        const fingerprint = deps.vehicleFingerprint?.();
        if (!port || !fingerprint) return [];       // otorite yok → BOŞ (uydurma yok)
        return port.recall(fingerprint);
      } catch {
        return [];
      }
    },

    readShortTerm: (): readonly MemoryRecord[] => {
      try {
        return getShortTermMemory();
      } catch {
        return [];
      }
    },
  };
}
