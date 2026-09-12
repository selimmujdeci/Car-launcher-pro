/**
 * sttMeasurementRunner.ts — MAVI-STT-LAB-2: elle başlatılan ölçümün koşucusu.
 *
 * ── SAHİPLİK (kritik) ───────────────────────────────────────────────────────
 * Bu dosyada **MODÜL SEVİYESİ DURUM YOKTUR**. Koşucu bir FABRİKA ile üretilir ve
 * sahibi onu yaratan bileşendir → ekran unmount olunca `dispose()` ile ölür.
 * Böylece "arka planda ölçüm devam eder" hatası YAPISAL OLARAK imkânsızdır
 * (depoda gerçekten yaşanmış sahipsiz-timer arızasının dersi: VehicleDataLayer'ın
 * stop sonrası dirilmesi).
 *
 * ── ENJEKSİYON ──────────────────────────────────────────────────────────────
 * Saat (duvar + monotonic), timer ve ÖRNEK KAYNAĞI dışarıdan verilir → testler
 * araç olmadan, gerçek zaman beklemeden deterministik koşar. `Date.now()`,
 * `Math.random()`, `setInterval` bu dosyada GEÇMEZ.
 *
 * ── BU KOŞUCU NE YAPMAZ ─────────────────────────────────────────────────────
 * Mikrofon açmaz/kapatmaz · STT/wake motoruna dokunmaz · eşik/AudioSource/efekt
 * değiştirmez · otomatik ölçüm başlatmaz · ağ/disk kullanmaz · sahte örnek üretmez.
 * Yaptığı tek şey: var olan STT-LAB-1 gözlemini periyodik OKUYUP saymaktır.
 */

import {
  sampleFromSnapshot, finalizeMeasurement,
  STT_SAMPLE_INTERVAL_MS, STT_MAX_SAMPLES_PER_MEASUREMENT, STT_DEFAULT_DURATION_MS,
  STT_DURATION_OPTIONS_S, isSttConditionId,
  type SttConditionId, type SttMeasurementRecord, type SttSample, type SttReasonCode,
} from './sttMeasurementModel';
import type { SttMicRaw } from './sttMicModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttRunnerDeps {
  /**
   * TEK örnek alır: native salt-okunur gözlemi tazeler ve okur. Senkron veya
   * async olabilir; koşucu ikisini de kabul eder. **Yeni bir diagnostics
   * üreticisi KURULMAZ** — bu fonksiyon STT-LAB-1 hattını tüketir.
   */
  readonly sampleOnce: () => SttMicRaw | Promise<SttMicRaw>;
  /** Duvar saati (kayıt damgası). */
  readonly nowWall: () => number;
  /** Monotonic saat (süre ölçümü — saat atlaması bozamaz). */
  readonly nowMono: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (id: unknown) => void;
  /**
   * Ölçüm bittiğinde (tamamlandı · kaynak kayboldu · KULLANICI iptali) çağrılır.
   * `dispose()` (ekran kapandı) yolunda ÇAĞRILMAZ — bileşen artık yoktur.
   */
  readonly onFinalized?: (rec: SttMeasurementRecord) => void;
}

export interface SttRunnerState {
  readonly running: boolean;
  readonly conditionId: SttConditionId | null;
  readonly targetMs: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly samplesTaken: number;
  readonly samplesValid: number;
  /** Örnekleme hâlâ uçuşta olduğu için ATLANAN tik sayısı (dürüstlük). */
  readonly skippedTicks: number;
  readonly lastRecord: SttMeasurementRecord | null;
}

export interface SttMeasurementRunner {
  getState(): SttRunnerState;
  /** `false` = başlatılmadı (zaten koşuyor · geçersiz koşul · geçersiz süre). */
  start(conditionId: SttConditionId, targetMs: number): boolean;
  /** Kullanıcı iptali. Kayıt `cancelled` olarak üretilir (deftere GİRMEZ). */
  cancel(): SttMeasurementRecord | null;
  /** Ekran kapanışı — sessiz iptal, callback YOK, timer temizlenir. */
  dispose(): void;
  subscribe(fn: (s: SttRunnerState) => void): () => void;
}

const IDLE: SttRunnerState = {
  running: false, conditionId: null, targetMs: 0, elapsedMs: 0, remainingMs: 0,
  samplesTaken: 0, samplesValid: 0, skippedTicks: 0, lastRecord: null,
};

/** Seçilebilir süreler dışında bir hedef KABUL EDİLMEZ (keyfi süre = kıyaslanamaz kayıt). */
export function isValidTargetMs(ms: unknown): boolean {
  return typeof ms === 'number' && Number.isFinite(ms)
    && STT_DURATION_OPTIONS_S.some((s) => s * 1000 === ms);
}

export function createSttMeasurementRunner(deps: SttRunnerDeps): SttMeasurementRunner {
  let state: SttRunnerState = IDLE;
  let timerId: unknown = null;
  let disposed = false;

  /* Aktif ölçümün iç durumu — dışarı SIZMAZ. */
  let samples: SttSample[] = [];
  let startWall = 0;
  let startMono = 0;
  let targetMs = 0;
  let conditionId: SttConditionId | null = null;
  let sampling = false;          // örnek uçuşta mı (tik çakışması koruması)
  let seq = 0;                   // deterministik kimlik sayacı

  const listeners = new Set<(s: SttRunnerState) => void>();

  function emit(): void {
    for (const fn of listeners) { try { fn(state); } catch { /* fail-soft */ } }
  }

  function setState(patch: Partial<SttRunnerState>): void {
    state = { ...state, ...patch };
    emit();
  }

  function stopTimer(): void {
    if (timerId !== null) {
      try { deps.clearTimer(timerId); } catch { /* fail-soft */ }
      timerId = null;
    }
  }

  function reset(lastRecord: SttMeasurementRecord | null): void {
    samples = [];
    startWall = 0; startMono = 0; targetMs = 0; conditionId = null;
    sampling = false;
    state = { ...IDLE, lastRecord };
  }

  function finalize(cancelled: boolean, cancelReason?: SttReasonCode, notify = true): SttMeasurementRecord | null {
    if (!state.running || conditionId === null) return null;
    stopTimer();
    const elapsedMs = Math.max(0, deps.nowMono() - startMono);
    const rec = finalizeMeasurement({
      measurementId: `M${startWall.toString(36)}-${seq}`,
      conditionId,
      startedAt: startWall,
      elapsedMs,
      targetMs,
      samples,
      cancelled,
      cancelReason,
    });
    reset(rec);
    emit();
    if (notify && deps.onFinalized) {
      try { deps.onFinalized(rec); } catch { /* fail-soft: tanı hattı çökertmez */ }
    }
    return rec;
  }

  /** Tek örnek al. Async kaynak da desteklenir; çakışan tik ATLANIR (sayılır). */
  function takeSample(): void {
    if (disposed || !state.running) return;
    if (sampling) { setState({ skippedTicks: state.skippedTicks + 1 }); return; }
    sampling = true;

    let raw: SttMicRaw | Promise<SttMicRaw>;
    try {
      raw = deps.sampleOnce();
    } catch {
      sampling = false;
      return; // kaynak patladı → bu tik kayıp; SAHTE örnek ÜRETİLMEZ
    }

    const accept = (snap: SttMicRaw): void => {
      sampling = false;
      if (disposed || !state.running) return;
      if (samples.length < STT_MAX_SAMPLES_PER_MEASUREMENT) {
        const s = sampleFromSnapshot(snap);
        samples.push(s);
        setState({
          samplesTaken: samples.length,
          samplesValid: state.samplesValid + (s.present && s.vadPresent ? 1 : 0),
          elapsedMs: Math.max(0, deps.nowMono() - startMono),
          remainingMs: Math.max(0, targetMs - (deps.nowMono() - startMono)),
        });
      }
      if (deps.nowMono() - startMono >= targetMs) finalize(false);
    };

    if (raw && typeof (raw as Promise<SttMicRaw>).then === 'function') {
      (raw as Promise<SttMicRaw>).then(accept, () => { sampling = false; });
    } else {
      accept(raw as SttMicRaw);
    }
  }

  return {
    getState: () => state,

    start(cond, ms) {
      if (disposed) return false;
      if (state.running) return false;              // AYNI ANDA TEK ÖLÇÜM
      if (!isSttConditionId(cond)) return false;    // koşul ETİKETİ zorunlu
      if (!isValidTargetMs(ms)) return false;

      seq++;
      conditionId = cond;
      targetMs = ms;
      startWall = deps.nowWall();
      startMono = deps.nowMono();
      samples = [];
      sampling = false;

      state = {
        running: true, conditionId: cond, targetMs: ms,
        elapsedMs: 0, remainingMs: ms,
        samplesTaken: 0, samplesValid: 0, skippedTicks: 0,
        lastRecord: state.lastRecord,
      };
      emit();

      // Tik aralığı TABANIN ALTINA İNEMEZ (hot-path bütçesi).
      timerId = deps.setTimer(takeSample, STT_SAMPLE_INTERVAL_MS);
      takeSample(); // t=0 örneği — kısa ölçümler aç kalmasın
      return true;
    },

    cancel() {
      return finalize(true, 'USER_CANCELLED', true);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Önce dinleyiciler düşer → unmount sonrası setState İMKÂNSIZ.
      listeners.clear();
      if (state.running) finalize(true, 'SCREEN_CLOSED', false);
      stopTimer();
      reset(null);
    },

    subscribe(fn) {
      if (disposed) return () => { /* no-op */ };
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export { STT_DEFAULT_DURATION_MS };
