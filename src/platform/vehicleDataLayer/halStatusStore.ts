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

interface HALStatusState {
  halConnected:    boolean;
  halConf:         number;
  activeSource:    SignalSource | null;
  canPhase:        CanConnectionPhase;
  canRetryCount:   number;
  canStatusText:   string;
  setHALConnected: (connected: boolean) => void;
  setActiveSource: (src: SignalSource) => void;
  setCanPhase:     (phase: CanConnectionPhase, retryCount?: number) => void;
  resetCan:        () => void;
}

export const useHALStatusStore = create<HALStatusState>((set) => ({
  halConnected:    false,
  halConf:         0,
  activeSource:    null,
  canPhase:        'IDLE',
  canRetryCount:   0,
  canStatusText:   '',
  setHALConnected: (connected) =>
    set({ halConnected: connected, halConf: connected ? 0.98 : 0 }),
  setActiveSource: (src) => set({ activeSource: src }),
  setCanPhase: (phase, retryCount) =>
    set((s) => ({
      canPhase:      phase,
      canRetryCount: retryCount ?? s.canRetryCount,
      canStatusText: PHASE_TEXT[phase],
    })),
  resetCan: () => set({ canPhase: 'IDLE', canRetryCount: 0, canStatusText: '' }),
}));
