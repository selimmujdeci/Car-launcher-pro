/**
 * maviMemorySources — hafıza kaynaklarının GERÇEK bağlaması (concrete binding).
 *
 * ⚠️ YENİ DEPO YOK. Mevcut otoriteler SALT-OKUNUR biçimde okunur:
 *   - `assistant/maviMemory` → kullanıcı tercihleri (F10 kanonik cephe;
 *     AÇIK beyan + ÇIKARIM ayrı etiketle, kalıcı)
 *   - `aiCore/vehicleMemory` → araç geçmişi (fingerprint-anahtarlı, kalıcı)
 *   - `shortTermMemory` → süreç-ömürlü oturum kayıtları (RAM)
 *
 * Yazma/silme yolları DEĞİŞTİRİLMEZ: kullanıcı "şunu hatırla/unut" dediğinde
 * mevcut akış aynen çalışır; bu dosya yalnız OKUR.
 *
 * ── FAZ-2: ARAÇ GEÇMİŞİ ARTIK CANLI ────────────────────────────────────────
 * Depo `SystemBoot` içindeki AI runtime wiring'de ZATEN kuruluyor; buraya o
 * örneğin salt-okunur referansı bağlanır (`getLiveVehicleMemoryStore`).
 * Fingerprint `vehicleHal.getVehicleIdentity()`ten gelir ve YALNIZ
 * `supported` iken taşınır (ham VIN İÇERMEZ — aiCore halAdapter'ıyla aynı
 * kural). İkisinden biri yoksa geçmiş BOŞ döner (fail-closed, uydurma yok).
 * DI ile ezilebilir (test/izolasyon).
 */

/* MAVI-F10: AÇIK tercihlerin TEK gerçeklik kaynağı artık kanonik cephedir.
   `companionMemory.getFacts()` ARTIK OKUNMAZ — o depo yalnız bir kerelik içe
   aktarma kaynağıydı ve iki ayrı okuma yolu iki ayrı gerçek üretiyordu. */
import {
  readExplicitPreferenceTexts, readInferredPreferenceTexts,
} from '../../../assistant/maviMemory';
import { getShortTermMemory } from '../shortTermMemory';
import { getLiveVehicleMemoryStore } from '../../../system/platformCoreAiRuntimeWiring';
import { vehicleHal } from '../../../vehicleHal';
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
/**
 * VARSAYILAN araç geçmişi bağlaması — Faz-2.
 *
 * İKİ otorite de MEVCUTTUR, yenisi kurulmaz:
 *   - depo        ← `platformCoreAiRuntimeWiring.getLiveVehicleMemoryStore()`
 *                   (SystemBoot'ta zaten kurulan `VehicleMemoryStore`)
 *   - fingerprint ← `vehicleHal.getVehicleIdentity()` (ham VIN İÇERMEZ; yalnız
 *                   `supported` iken hash taşınır — aiCore'un halAdapter'ıyla
 *                   AYNI kural)
 * Herhangi biri yoksa BOŞ döner (fail-closed, uydurma yok).
 */
function defaultVehicleFingerprint(): string | undefined {
  try {
    const identity = vehicleHal.getVehicleIdentity();
    if (!identity || identity.supported !== true) return undefined;
    const hash = identity.fingerprintHash;
    return typeof hash === 'string' && hash ? hash : undefined;
  } catch {
    return undefined;
  }
}

function defaultVehicleHistoryPort(): VehicleHistoryPort | undefined {
  try {
    const store = getLiveVehicleMemoryStore();
    if (!store) return undefined;                 // runtime kapalı → geçmiş yok
    return {
      recall: (fingerprintHash: string) => store.recall(fingerprintHash).map((f) => ({
        statement:  f.statement,
        confidence: f.confidence,
        lastSeen:   f.lastSeen,
      })),
    };
  } catch {
    return undefined;
  }
}

export function createMaviMemorySources(deps: MaviMemorySourcesDeps = {}): MemorySources {
  // DI verilmezse CANLI otoriteler kullanılır (yeni depo kurulmaz).
  const fingerprintOf = deps.vehicleFingerprint ?? defaultVehicleFingerprint;
  const historyPort   = deps.vehicleHistory     ?? defaultVehicleHistoryPort();

  return {
    readUserPreferences: (): readonly string[] => {
      try {
        /* AÇIK beyan ile ÇIKARIM ASLA aynı listede değildir (spec §14.2/1):
           çıkarımlar açıkça "(çıkarım, güven …)" etiketiyle taşınır, böylece
           motor ve LAB ikisini karıştıramaz. */
        return [...readExplicitPreferenceTexts(Date.now()),
          ...readInferredPreferenceTexts(Date.now())];
      } catch {
        return [];
      }
    },

    readVehicleHistory: () => {
      try {
        const port = historyPort;
        const fingerprint = fingerprintOf();
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
