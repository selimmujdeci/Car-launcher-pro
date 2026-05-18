import { isNative } from '../bridge';
import { CarLauncher } from '../nativePlugin';
import type { CanAdapterData } from './types';
import { dbgPushCanRaw, dbgUpdateCanExtras } from '../debug';
import { useUnifiedVehicleStore } from './UnifiedVehicleStore';
import { useHALStatusStore } from './halStatusStore';

// READ-ONLY: CAN bus'tan yalnızca veri okunur.
// Araç sistemlerine hiçbir yazma veya kontrol komutu gönderilemez.

type Callback = (data: CanAdapterData) => void;

/**
 * İlk CAN frame için bekleme penceresi (ms).
 * SerialPortHandler 15 port × 2 baud dener; tamamlanması ~25-30s sürer.
 * stopCanBus/startCanBus retry'ı taramayı KESER — sadece phase güncelle, dokunma.
 */
const FIRST_FRAME_TIMEOUT_MS = 30_000;
/** Maksimum retry sayısı — 3 × 30s = 90s toplam bekleme */
const MAX_RETRIES              =      3;
/** FALLBACK_ACTIVE sonrası geç bağlantı için periyodik yeniden deneme (ms) */
const LATE_RECOVERY_INTERVAL_MS = 60_000;

export interface ICanAdapter {
  readonly start: () => void;
  readonly stop:  () => void;
  readonly onData: (cb: Callback) => () => void;
}

export class CanAdapter implements ICanAdapter {
  private readonly _listeners = new Set<Callback>();
  private _unsub: (() => void) | null = null;

  // Pre-allocated data object — her CAN frame'de yeni nesne yaratmak yerine
  // mevcut nesne mutate edilir. GC baskısı 0.
  private readonly _data: CanAdapterData = {};
  private readonly _tpmsBuffer: [number, number, number, number] = [0, 0, 0, 0];

  // First-frame timeout state
  private _firstFrameReceived  = false;
  private _firstFrameTimer:    ReturnType<typeof setTimeout> | null = null;
  private _retryTimer:         ReturnType<typeof setTimeout> | null = null;
  private _lateRecoveryTimer:  ReturnType<typeof setTimeout> | null = null;
  private _retryCount          = 0;

  start(): void {
    if (this._unsub) return;
    if (!isNative) return;

    this._firstFrameReceived = false;
    this._retryCount         = 0;
    useHALStatusStore.getState().setCanPhase('ADAPTER_INIT');

    CarLauncher.addListener('canStatus', (status) => {
      console.info('[CAN]', status.mode, status.port, status.connected ? '✓' : '✗');
    }).catch(() => {});

    CarLauncher.addListener('canData', (raw) => {
      // İlk frame geldi — timeout timer'ı iptal et
      if (!this._firstFrameReceived) {
        this._firstFrameReceived = true;
        this._clearTimers();
        this._retryCount = 0;
        useHALStatusStore.getState().setCanPhase('CONNECTED', 0);
      }

      // ── Temel sürüş ──────────────────────────────────────────────────────
      this._data.speed        = raw.speed        ?? undefined;
      this._data.reverse      = raw.reverse      ?? undefined;
      this._data.fuel         = raw.fuel         ?? undefined;

      // ── Motor ─────────────────────────────────────────────────────────────
      this._data.rpm          = raw.rpm          ?? undefined;
      this._data.coolantTemp  = raw.coolantTemp  ?? undefined;
      this._data.oilTemp      = raw.oilTemp      ?? undefined;
      this._data.throttle     = raw.throttle     ?? undefined;

      // ── Elektrik ──────────────────────────────────────────────────────────
      this._data.batteryVolt  = raw.batteryVolt  ?? undefined;

      // ── Vites ─────────────────────────────────────────────────────────────
      this._data.gearPos      = raw.gearPos      ?? undefined;

      // ── Çevre ─────────────────────────────────────────────────────────────
      this._data.ambientTemp  = raw.ambientTemp  ?? undefined;

      // ── Kapı / aydınlatma ─────────────────────────────────────────────────
      this._data.doorOpen     = raw.doorOpen     ?? undefined;
      this._data.headlightsOn = raw.headlightsOn ?? undefined;

      // ── Şasi güvenliği ────────────────────────────────────────────────────
      this._data.abs              = raw.abs              ?? undefined;
      this._data.tractionControl  = raw.tractionControl  ?? undefined;
      this._data.stabilityControl = raw.stabilityControl ?? undefined;

      // ── Gövde / konfor ────────────────────────────────────────────────────
      this._data.parkingBrake  = raw.parkingBrake  ?? undefined;
      this._data.seatbelt      = raw.seatbelt      ?? undefined;
      this._data.wipers        = raw.wipers        ?? undefined;
      this._data.airCondition  = raw.airCondition  ?? undefined;
      this._data.cruiseControl = raw.cruiseControl ?? undefined;

      // ── TPMS (pre-allocated buffer) ───────────────────────────────────────
      if (raw.tpms != null && raw.tpms.length === 4) {
        this._tpmsBuffer[0] = raw.tpms[0]!;
        this._tpmsBuffer[1] = raw.tpms[1]!;
        this._tpmsBuffer[2] = raw.tpms[2]!;
        this._tpmsBuffer[3] = raw.tpms[3]!;
        this._data.tpms = this._tpmsBuffer;
      } else {
        this._data.tpms = undefined;
      }

      this._listeners.forEach((fn) => fn(this._data));
      dbgPushCanRaw(this._data as Record<string, unknown>);
      dbgUpdateCanExtras({
        doorOpen:     this._data.doorOpen,
        headlightsOn: this._data.headlightsOn,
        tpms:         this._data.tpms,
      });
    }).then((handle) => {
      this._unsub = () => { handle.remove(); };
    });

    CarLauncher.startCanBus?.();

    // First-frame watchdog — 12 saniye içinde frame gelmezse retry/fallback
    useHALStatusStore.getState().setCanPhase('WAIT_FIRST_FRAME');
    this._scheduleFirstFrameTimeout();
  }

  stop(): void {
    this._clearTimers();
    this._firstFrameReceived = false;
    this._retryCount         = 0;
    this._unsub?.();
    this._unsub = null;
    this._listeners.clear();
    // CAN transport kesilince stale veri UI'da donmasın — anında sıfırla
    useUnifiedVehicleStore.getState().resetCanData();
    // Pre-allocated nesneyi temizle
    Object.keys(this._data).forEach(k => {
      (this._data as Record<string, unknown>)[k] = undefined;
    });
    if (isNative) CarLauncher.stopCanBus?.();
    useHALStatusStore.getState().resetCan();
  }

  onData(cb: Callback): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  // ── First-frame timeout machinery ─────────────────────────────────────────

  private _scheduleFirstFrameTimeout(): void {
    this._firstFrameTimer = setTimeout(() => {
      this._firstFrameTimer = null;
      this._onFirstFrameTimeout();
    }, FIRST_FRAME_TIMEOUT_MS);
  }

  private _clearTimers(): void {
    if (this._firstFrameTimer !== null) {
      clearTimeout(this._firstFrameTimer);
      this._firstFrameTimer = null;
    }
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._lateRecoveryTimer !== null) {
      clearTimeout(this._lateRecoveryTimer);
      this._lateRecoveryTimer = null;
    }
  }

  private _onFirstFrameTimeout(): void {
    if (this._firstFrameReceived) return; // race condition guard

    this._retryCount++;
    useHALStatusStore.getState().setCanPhase('NO_FRAME_TIMEOUT', this._retryCount);

    if (this._retryCount < MAX_RETRIES) {
      // CanBusManager zaten arkaplanda port taramasını sürdürüyor.
      // stopCanBus/startCanBus ÇAĞIRMA — taramayı keser ve sıfırdan başlatır.
      // Sadece phase'i güncelle ve yeni 30s penceresi bekle.
      useHALStatusStore.getState().setCanPhase('RETRYING', this._retryCount);
      this._scheduleFirstFrameTimeout();
    } else {
      // 3 × 30s = 90s geçti, hâlâ frame yok — fallback aktif.
      // Listener AÇIK kalıyor: CanBusManager bağlanınca canData gelirse otomatik recovery.
      useHALStatusStore.getState().setCanPhase('FALLBACK_ACTIVE', this._retryCount);
      console.warn('[CAN] İlk frame alınamadı (' + MAX_RETRIES + ' deneme, ' +
        (MAX_RETRIES * FIRST_FRAME_TIMEOUT_MS / 1000) + 's) — geç bağlantı için dinleniyor');
      // Geç bağlantı için 60s'de bir startCanBus yenile (CanBusManager kendi retry'ını yapar)
      this._scheduleLateRecovery();
    }
  }

  private _scheduleLateRecovery(): void {
    this._lateRecoveryTimer = setTimeout(() => {
      this._lateRecoveryTimer = null;
      if (this._firstFrameReceived || this._unsub === null) return;
      // CanBusManager'ı taze başlat ve tekrar bekle
      if (isNative) {
        CarLauncher.stopCanBus?.();
        setTimeout(() => {
          if (!this._firstFrameReceived && this._unsub !== null) {
            CarLauncher.startCanBus?.();
            this._scheduleLateRecovery(); // sonraki 60s döngüsü
          }
        }, 500);
      }
    }, LATE_RECOVERY_INTERVAL_MS);
  }
}
