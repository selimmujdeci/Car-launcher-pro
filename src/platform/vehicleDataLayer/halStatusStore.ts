import { create } from 'zustand';
import type { SignalSource } from './valTypes';

/**
 * CAN bağlantı durumu state machine.
 * CanAdapter.ts tarafından yönetilir; UI bileşenleri okur.
 */
export type CanConnectionPhase =
  | 'IDLE'
  | 'ADAPTER_INIT'
  | 'WAIT_FIRST_FRAME'
  | 'CONNECTED'
  | 'NO_FRAME_TIMEOUT'
  | 'RETRYING'
  | 'FALLBACK_ACTIVE'
  | 'FAILED';

const PHASE_TEXT: Record<CanConnectionPhase, string> = {
  IDLE:             '',
  ADAPTER_INIT:     'CAN adaptör başlatılıyor...',
  WAIT_FIRST_FRAME: 'CAN bağlantısı bekleniyor...',
  CONNECTED:        '',
  NO_FRAME_TIMEOUT: 'CAN frame alınamadı, yeniden deneniyor...',
  RETRYING:         'CAN bağlantısı yeniden deneniyor...',
  FALLBACK_ACTIVE:  'CAN verisi alınamadı. Yedek sürüş moduna geçildi.',
  FAILED:           'CAN bağlantısı başarısız. OBD/GPS modu aktif.',
};

/**
 * Kaynak sağlığı (PR-1 "Source Health Transport") — worker'ın 1 Hz watchdog'unda ZATEN
 * hesapladığı per-kaynak canlılık (`SRC_TIMEOUT_CAN/OBD/GPS_MS`) buraya taşınır.
 *
 * `null` = **BİLİNMİYOR** (worker henüz hiç sağlık bildirmedi) — `false` (kaynak ÖLÜ) ile
 * KARIŞTIRILMAZ. Bounded: yalnız 3 boolean|null + 1 monotonik timestamp; araç verisi
 * (hız/RPM/CAN frame), VIN veya PII TAŞIMAZ.
 *
 * ⚠️ Bu alanlar bu PR'da HİÇBİR sinyali unsupported YAPMAZ ve HAL/adapter/Event Bus/bridge
 * davranışını DEĞİŞTİRMEZ (fail-closed tüketim AYRI PR).
 */
export interface SourceHealth {
  canAlive: boolean | null;
  obdAlive: boolean | null;
  gpsAlive: boolean | null;
  /** Worker monotonik saati (performance.now()) — duvar saati/PII değil. */
  updatedAt: number | null;
}

interface HALStatusState {
  halConnected:    boolean;
  halConf:         number;
  activeSource:    SignalSource | null;
  canPhase:        CanConnectionPhase;
  canRetryCount:   number;
  canStatusText:   string;
  /** Per-kaynak canlılık — null=bilinmiyor. Tek global "bağlı mı" YETERSİZ olduğu için ayrı. */
  sourceHealth:    SourceHealth;
  setHALConnected: (connected: boolean) => void;
  setActiveSource: (src: SignalSource) => void;
  setCanPhase:     (phase: CanConnectionPhase, retryCount?: number) => void;
  /** Worker SOURCE_HEALTH mesajından beslenir (yalnız geçişte gelir). Bounded/idempotent. */
  setSourceHealth: (health: { can: boolean; obd: boolean; gps: boolean; ts: number }) => void;
  resetCan:        () => void;
}

const _UNKNOWN_HEALTH: SourceHealth = Object.freeze({
  canAlive: null, obdAlive: null, gpsAlive: null, updatedAt: null,
});

export const useHALStatusStore = create<HALStatusState>((set) => ({
  halConnected:    false,
  halConf:         0,
  activeSource:    null,
  canPhase:        'IDLE',
  canRetryCount:   0,
  canStatusText:   '',
  sourceHealth:    _UNKNOWN_HEALTH,
  setHALConnected: (connected) =>
    set({ halConnected: connected, halConf: connected ? 0.98 : 0 }),
  setActiveSource: (src) => set({ activeSource: src }),
  setSourceHealth: (h) =>
    set((s) => {
      // Bozuk/eksik mesaj → yok say (fail-soft; bilinmiyor durumu KORUNUR).
      if (!h || typeof h.can !== 'boolean' || typeof h.obd !== 'boolean' || typeof h.gps !== 'boolean') return s;
      const cur = s.sourceHealth;
      // Worker zaten yalnız geçişte gönderir; burada da idempotent kalınır (gereksiz set yok).
      if (cur.canAlive === h.can && cur.obdAlive === h.obd && cur.gpsAlive === h.gps) return s;
      return {
        sourceHealth: {
          canAlive:  h.can,
          obdAlive:  h.obd,
          gpsAlive:  h.gps,
          updatedAt: typeof h.ts === 'number' && Number.isFinite(h.ts) ? h.ts : null,
        },
      };
    }),
  setCanPhase: (phase, retryCount) =>
    set((s) => ({
      canPhase:      phase,
      canRetryCount: retryCount ?? s.canRetryCount,
      canStatusText: PHASE_TEXT[phase],
    })),
  resetCan: () => set({ canPhase: 'IDLE', canRetryCount: 0, canStatusText: '' }),
}));
