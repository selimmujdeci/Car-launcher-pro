/**
 * locationEngineRuntime.ts — KONUM MOTORU KABLOLAMASI (İNCE).
 *
 * ── MEVCUT DAVRANIŞ KORUNUR (BAĞLAYICI) ───────────────────────────────
 * Bu modül `gpsService`'i **DEĞİŞTİRMEZ, YERİNE GEÇMEZ, YENİDEN
 * BAŞLATMAZ**. Onu YALNIZCA GÖZLEMLER ve `HEAD_UNIT_GPS` sağlayıcısı
 * olarak sunar. Bugün konum tüketen her yer (`onGPSLocation`, `GpsAdapter`,
 * `useGPSLocation`, `FullMapView`, `speedFusion`, radar, geofence) aynı
 * yoldan okumaya devam eder — hiçbiri bu motora bağlanmak zorunda değildir.
 *
 * Yani bu tur **ek bir karar katmanı** kurar: hangi kaynağın konuşacağını
 * bilir, gözlemlenebilir kılar ve Fleet'e dürüst durum verir. Mevcut
 * sürüş/harita davranışının tek satırı değişmez.
 *
 * ── KAYIT MODELİ ─────────────────────────────────────────────────────
 * `HEAD_UNIT_GPS` yerleşiktir. `EXTERNAL_GPS` ve `PHONE_HUB_GPS` için
 * **kayıt arayüzü** açıktır; gerçek taşıma (Bluetooth/USB/TCP, telefon
 * köprüsü) BU PAKETE DAHİL DEĞİLDİR ve kayıt yapılmadıkça
 * `available=false` kalır (sahte "hazır" YOK).
 *
 * ── ZERO-LEAK ────────────────────────────────────────────────────────
 * Tek abonelik + tek değerlendirme timer'ı; `stop()` ikisini de temizler.
 */

import { onGPSLocation, getGPSState } from '../gpsService';
import { safeGetRaw } from '../../utils/safeStorage';
import { LAST_KNOWN_KEY } from '../gps/gpsUtils';
import {
  buildRawSample,
  normalizeErrorKind,
  type LocationProviderId,
  type LocationProviderStatus,
  type RawLocationSample,
  type LocationErrorKind,
  type ProviderSampleInput,
} from './locationProvider';
import { LocationArbiter, type ArbiterDecision, type ArbiterSnapshot } from './locationArbiter';

/* ── Dış sağlayıcı kaydı (gelecek taşımalar için) ──────────────────────── */

/**
 * Harici bir konum kaynağının kaydı.
 *
 * `read()` **senkron** olmalıdır: hakem tick'inde ağ/IO beklenemez.
 * Taşıma katmanı kendi tamponunu tutar, buraya yalnız son örneği verir.
 */
export interface RegisteredProvider {
  readonly id: LocationProviderId;
  /** Kaynak fiziksel olarak bağlı/etkin mi. */
  readonly isAvailable: () => boolean;
  /** Son ham örnek; yoksa `null`. ASLA fırlatmamalı (yine de sarılır). */
  readonly read: () => ProviderSampleInput | null;
  /** Kümülatif hata sayısı. */
  readonly errorCount?: () => number;
  readonly lastErrorKind?: () => unknown;
}

/* ── Motor ─────────────────────────────────────────────────────────────── */

class LocationEngine {
  private readonly _arbiter = new LocationArbiter();
  private readonly _external = new Map<LocationProviderId, RegisteredProvider>();

  /** `gpsService`'ten gözlenen son örnek (HEAD_UNIT_GPS). */
  private _headUnitSample: RawLocationSample | null = null;
  private _headUnitErrors = 0;
  private _headUnitLastErrorKind: LocationErrorKind | null = null;

  private _unsubGps: (() => void) | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _started = false;
  private _lastDecision: ArbiterDecision | null = null;

  /**
   * Değerlendirme aralığı.
   *
   * 1 s: kaynak geçişi kararı için yeterli (dwell 4 s, grace 6 s) ve
   * hot-path'e girmez. GPS fix akışı bundan bağımsız olarak `gpsService`
   * kendi hızında (2–5 Hz) devam eder — bu timer YALNIZ hakem kararı içindir.
   */
  private static readonly EVAL_INTERVAL_MS = 1_000;

  /* ── Yaşam döngüsü ──────────────────────────────────────────────────── */

  start(): () => void {
    if (this._started) return () => this.stop();
    this._started = true;

    /* `gpsService`'i YALNIZ GÖZLEMLE — konfigürasyonuna dokunma. */
    try {
      this._unsubGps = onGPSLocation((loc) => {
        try {
          if (!loc) return;
          const s = buildRawSample(
            {
              latitude: loc.latitude,
              longitude: loc.longitude,
              accuracyM: loc.accuracy,
              headingDeg: loc.heading,
              speedMps: loc.speed,
              timestampMs: loc.timestamp,
            },
            'HEAD_UNIT_GPS',
          );
          if (s === null) {
            /* Sözleşmeyi geçmeyen fix SESSİZCE kaybolmaz — sayılır. */
            this._headUnitErrors += 1;
            this._headUnitLastErrorKind = 'MALFORMED_FIX';
            return;
          }
          this._headUnitSample = s;
        } catch { /* FAIL-SOFT: gözlem mevcut GPS akışını ASLA bozmaz */ }
      });
    } catch { /* abonelik kurulamadıysa motor yine de çalışır (UNKNOWN) */ }

    this._timer = setInterval(() => this._evaluate(), LocationEngine.EVAL_INTERVAL_MS);
    this._evaluate();   // ilk kararı hemen ver
    return () => this.stop();
  }

  stop(): void {
    this._started = false;
    if (this._timer !== null) { clearInterval(this._timer); this._timer = null; }
    try { this._unsubGps?.(); } catch { /* yok sayılır */ }
    this._unsubGps = null;
  }

  /* ── Kayıt ──────────────────────────────────────────────────────────── */

  /**
   * Harici/telefon sağlayıcısı kaydeder. Kayıt yapılmadıkça o kaynak
   * `available=false`'dır — "hazır" görünmez.
   */
  registerProvider(p: RegisteredProvider): () => void {
    if (p.id === 'HEAD_UNIT_GPS' || p.id === 'LAST_KNOWN') {
      /* Bu ikisi yerleşiktir; üzerine yazmak iki otorite yaratır. */
      return () => { /* no-op */ };
    }
    this._external.set(p.id, p);
    return () => { this._external.delete(p.id); };
  }

  /* ── Sağlayıcı durumları ────────────────────────────────────────────── */

  private _headUnitStatus(): LocationProviderStatus {
    let available = false;
    try {
      const st = getGPSState();
      /* `isTracking` VE `unavailable` değil → sağlayıcı canlı sayılır. */
      available = st.isTracking === true && st.unavailable !== true;
      if (st.error) {
        this._headUnitLastErrorKind = /permission/i.test(st.error)
          ? 'PERMISSION_DENIED'
          : /timeout/i.test(st.error) ? 'TIMEOUT' : 'POSITION_UNAVAILABLE';
      }
    } catch { available = false; }

    return {
      id: 'HEAD_UNIT_GPS',
      available,
      sample: this._headUnitSample,
      errorCount: this._headUnitErrors,
      lastErrorKind: this._headUnitLastErrorKind,
    };
  }

  /**
   * `LAST_KNOWN` — kalıcı depodan.
   *
   * ⚠️ Depoda **zaman damgası TUTULMUYOR** (`gpsService._saveLastKnown`
   * yalnız `{lat,lng}` yazıyor). Bu yüzden yaş BİLİNEMEZ. Uydurma bir
   * "şimdi" damgası yazmak konumu canlı gibi gösterirdi; onun yerine
   * `OFFLINE_AFTER` sınırının ötesinde bir damga verilir → durum daima
   * `LAST_KNOWN`/`OFFLINE` olur, ASLA `LIVE` olmaz. Damga eklenmesi
   * `gpsService` değişikliği gerektirir → bu paketin DIŞINDA (açık borç).
   */
  private _lastKnownStatus(nowMs: number): LocationProviderStatus {
    let sample: RawLocationSample | null = null;
    try {
      const raw = safeGetRaw(LAST_KNOWN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
        sample = buildRawSample(
          {
            latitude: parsed.lat,
            longitude: parsed.lng,
            accuracyM: null,
            headingDeg: null,
            speedMps: null,
            /* Yaş bilinmiyor → "taze" İDDİA EDİLMEZ. */
            timestampMs: nowMs - 1,
          },
          'LAST_KNOWN',
        );
      }
    } catch { sample = null; }

    return {
      id: 'LAST_KNOWN',
      available: sample !== null,
      sample,
      errorCount: 0,
      lastErrorKind: null,
    };
  }

  private _externalStatus(p: RegisteredProvider): LocationProviderStatus {
    let available = false;
    let sample: RawLocationSample | null = null;
    let errorCount = 0;
    let lastKind: LocationErrorKind | null = null;
    try {
      available = p.isAvailable() === true;
      const input = p.read();
      if (input !== null) sample = buildRawSample(input, p.id);
      errorCount = p.errorCount?.() ?? 0;
      const k = p.lastErrorKind?.();
      lastKind = k === undefined || k === null ? null : normalizeErrorKind(k);
    } catch {
      /* Sağlayıcı fırlattı → kullanılamaz sayılır, hata SAYILIR. */
      available = false;
      sample = null;
      lastKind = 'UNKNOWN';
    }
    return { id: p.id, available, sample, errorCount, lastErrorKind: lastKind };
  }

  /* ── Karar ──────────────────────────────────────────────────────────── */

  private _evaluate(): void {
    try {
      const nowMs = Date.now();
      const providers: LocationProviderStatus[] = [];
      for (const p of this._external.values()) providers.push(this._externalStatus(p));
      providers.push(this._headUnitStatus());
      providers.push(this._lastKnownStatus(nowMs));
      this._lastDecision = this._arbiter.tick({ nowMs, providers });
    } catch {
      /* FAIL-SOFT: karar verilemezse son karar korunur (uydurma YOK). */
    }
  }

  /* ── Okuma yüzeyi ───────────────────────────────────────────────────── */

  /** Son karar — ASLA fırlatmaz. */
  getDecision(): ArbiterDecision | null {
    return this._lastDecision;
  }

  /** LAB salt-okur — hiçbir şey BAŞLATMAZ, yeni fix İSTEMEZ. */
  getSnapshot(): ArbiterSnapshot {
    return this._arbiter.getSnapshot();
  }

  /** LAB için kayıtlı sağlayıcı listesi (gizli veri TAŞIMAZ). */
  getRegisteredProviderIds(): readonly LocationProviderId[] {
    return ['HEAD_UNIT_GPS', 'LAST_KNOWN', ...this._external.keys()];
  }

  isStarted(): boolean {
    return this._started;
  }
}

/* ── Tekil ─────────────────────────────────────────────────────────────── */

export const locationEngine = new LocationEngine();

/** SystemBoot kablolaması — başlatır, cleanup döndürür. */
export function startLocationEngine(): () => void {
  return locationEngine.start();
}

export function stopLocationEngine(): void {
  locationEngine.stop();
}

/** LAB okuma yüzeyi. */
export function readLocationEngineSnapshot(): ArbiterSnapshot {
  return locationEngine.getSnapshot();
}

export function readLocationEngineProviders(): readonly LocationProviderId[] {
  return locationEngine.getRegisteredProviderIds();
}

/**
 * Harici konum kaynağı kaydı (Bluetooth/USB/TCP/telefon köprüsü).
 * Bu turda **hiçbir yerden çağrılmıyor** — arayüz gelecek taşıma için hazır.
 */
export function registerLocationProvider(p: RegisteredProvider): () => void {
  return locationEngine.registerProvider(p);
}
