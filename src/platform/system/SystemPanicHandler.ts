/**
 * SystemPanicHandler — Kilitlenme Anı Snapshot Motoru
 *
 * Görev: Kritik bir hata (window.onerror, unhandledrejection, UI donması)
 * anında tüm sistem durumunu tek bir atomic yazmayla mühürler.
 *
 * Panic Recovery Flow:
 *   1. initPanicHandler() → window.onerror / unhandledrejection hook'larına bağlanır.
 *   2. onVehicleEvent ring buffer (son 10 event) sürekli güncellenir.
 *   3. Panic anında capturePanicSnapshot() → tüm store state'leri + ring buffer
 *      → safeSetRawImmediate ile 'caros_panic_recovery' anahtarına kilitlenir.
 *   4. Sonraki açılışta SystemBoot bu snapshot'u okuyabilir (post-mortem / recovery).
 *
 * UX Kuralı: Kullanıcıya HİÇBİR hata gösterilmez.
 * Dev ortamında console.error ile log bırakılır — prod'da sessiz.
 */

import { onVehicleEvent }                  from '../vehicleDataLayer';
import type { VehicleEvent }               from '../vehicleDataLayer/VehicleEventHub';
import { useStore }                         from '../../store/useStore';
import { useSystemStore }                   from '../../store/useSystemStore';
import { useCognitiveStore }               from '../../store/useCognitiveStore';
import { useSafetyStore }                   from '../../store/useSafetyStore';
import { useUnifiedVehicleStore }          from '../vehicleDataLayer';
import { getNavigationState }              from '../navigationService';
import { safeSetRawImmediate, safeGetRaw } from '../../utils/safeStorage';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const PANIC_KEY         = 'caros_panic_recovery';
const RING_BUFFER_SIZE  = 10;

// ── Ring Buffer ───────────────────────────────────────────────────────────────

const _eventRingBuffer: VehicleEvent[] = [];

function _pushEvent(event: VehicleEvent): void {
  _eventRingBuffer.push(event);
  if (_eventRingBuffer.length > RING_BUFFER_SIZE) {
    _eventRingBuffer.shift();
  }
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

interface PanicSnapshot {
  ts:             number;
  reason:         string;
  stores: {
    app:         unknown;
    system:      unknown;
    cognitive:   unknown;
    safety:      unknown;
    vehicle:     unknown;
    navigation:  unknown;
  };
  lastEvents:     VehicleEvent[];
}

/**
 * Anlık sistem durumunu okur ve 'caros_panic_recovery' anahtarına mühürler.
 * safeSetRawImmediate ile çağrıldığı için native katmana kadar iletim garantisi vardır.
 *
 * @param reason  Panic tetikleyici açıklaması — sadece dev log'u için
 */
export async function capturePanicSnapshot(reason = 'unknown'): Promise<void> {
  try {
    const snapshot: PanicSnapshot = {
      ts:     Date.now(),
      reason,
      stores: {
        app:        _safeSerialize(useStore.getState()),
        system:     _safeSerialize(useSystemStore.getState()),
        cognitive:  _safeSerialize(useCognitiveStore.getState()),
        safety:     _safeSerialize(useSafetyStore.getState()),
        vehicle:    _safeSerialize(useUnifiedVehicleStore.getState()),
        navigation: _safeSerialize(getNavigationState()),
      },
      lastEvents: [..._eventRingBuffer],
    };

    await safeSetRawImmediate(PANIC_KEY, JSON.stringify(snapshot));

    if (import.meta.env.DEV) {
      console.error(`[PanicHandler] Snapshot mühürlendi — reason="${reason}", ts=${snapshot.ts}`);
    }
  } catch {
    // Panic handler kendi hatasını kullanıcıya göstermez — sessiz devam
  }
}

// ── Yardımcı: Döngüsel referans ve fonksiyonları dışarıda bırakan serialize ──

function _safeSerialize(obj: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'function') return '[Function]';
      return value;
    }));
  } catch {
    return '[SerializeError]';
  }
}

// ── Panic Report ─────────────────────────────────────────────────────────────

/**
 * Son kaydedilen panic snapshot'ını formatlı string olarak döner.
 * Dashboard / ChaosSimulator ekranında görüntülenmek üzere tasarlanmıştır.
 *
 * @returns Formatlı rapor string'i, yoksa null.
 */
export function getPanicReport(): string | null {
  try {
    const raw = safeGetRaw(PANIC_KEY);
    if (!raw) return null;

    const snap = JSON.parse(raw) as PanicSnapshot;
    const ts   = new Date(snap.ts).toISOString();

    const lines: string[] = [
      '═══════════════════════════════════════',
      '  CAROS PRO — PANIC REPORT',
      '═══════════════════════════════════════',
      `  Zaman     : ${ts}`,
      `  Sebep     : ${snap.reason}`,
      '───────────────────────────────────────',
      '  KOGNITIF MOD  : ' + _extractField(snap.stores.cognitive, 'currentMode'),
      '  TERMAL SEVİYE : ' + _extractField(snap.stores.system,    'thermalLevel'),
      '  NAVIGASYON    : ' + _extractField(snap.stores.navigation, 'status'),
      '  ARAÇ HIZI     : ' + _extractField(snap.stores.vehicle,   'speed') + ' km/h',
      '  YAKUT %       : ' + _extractField(snap.stores.vehicle,   'fuel'),
      '───────────────────────────────────────',
      `  SON OLAYLAR (${snap.lastEvents.length}):`,
      ...snap.lastEvents.map((e, i) =>
        `    [${i + 1}] ${e.type} @ ${new Date(e.ts).toISOString().slice(11, 23)}`,
      ),
      '═══════════════════════════════════════',
    ];

    return lines.join('\n');
  } catch {
    return null;
  }
}

function _extractField(obj: unknown, field: string): string {
  try {
    if (obj && typeof obj === 'object' && field in (obj as Record<string, unknown>)) {
      const val = (obj as Record<string, unknown>)[field];
      return val === null || val === undefined ? 'N/A' : String(val);
    }
  } catch { /* noop */ }
  return 'N/A';
}

// ── Init / Cleanup ────────────────────────────────────────────────────────────

/**
 * Panic handler'ı etkinleştirir.
 * - onVehicleEvent ring buffer aboneliği
 * - window.onerror ve unhandledrejection hook'ları
 *
 * @returns cleanup fonksiyonu — SystemBoot stop() içinde çağrılır
 */
export function initPanicHandler(): () => void {
  // Ring buffer aboneliği
  const unsubEvents = onVehicleEvent(_pushEvent);

  // window.onerror — yakalanamayan global JS hataları
  const _prevOnError = typeof window !== 'undefined' ? window.onerror : null;
  if (typeof window !== 'undefined') {
    window.onerror = (message, source, lineno, colno, error) => {
      void capturePanicSnapshot(`window.onerror: ${String(message)} (${source}:${lineno}:${colno})`);
      // Önceki handler varsa zinciri koru
      if (typeof _prevOnError === 'function') {
        return _prevOnError(message, source, lineno, colno, error);
      }
      return false;
    };
  }

  // unhandledrejection — yakalanamayan Promise reddetmeleri
  const _onUnhandledRejection = (e: PromiseRejectionEvent): void => {
    const reason = e.reason instanceof Error
      ? e.reason.message
      : String(e.reason ?? 'unknown rejection');
    void capturePanicSnapshot(`unhandledrejection: ${reason}`);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', _onUnhandledRejection);
  }

  if (import.meta.env.DEV) {
    console.info('[PanicHandler] Etkinleştirildi — window.onerror + unhandledrejection + ring buffer aktif');
  }

  return () => {
    unsubEvents();
    if (typeof window !== 'undefined') {
      window.onerror = _prevOnError;
      window.removeEventListener('unhandledrejection', _onUnhandledRejection);
    }
    _eventRingBuffer.length = 0;

    if (import.meta.env.DEV) {
      console.info('[PanicHandler] Durduruldu');
    }
  };
}
