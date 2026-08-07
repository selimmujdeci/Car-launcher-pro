/**
 * tripUploadRuntime.ts — TRIP YÜKLEMENİN CANLI KABLOLAMASI (İNCE).
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────
 * `tripLogService`'i **DEĞİŞTİRMEZ**. Onu YALNIZ GÖZLEMLER (`onTripState`)
 * ve geçmişte YENİ kapanmış bir trip gördüğünde kanonik özeti üretip
 * yükleme koordinatörüne verir.
 *
 * Yükleme mevcut at-least-once kuyruğundan (`connectivityService` →
 * `pushVehicleEvent` ile AYNI taşıma) geçer; retry · backoff · dedupe o
 * kuyruğun DEĞİŞMEMİŞ davranışıdır.
 *
 * ── §5: ANLIK YÜKLEME YOK ─────────────────────────────────────────────
 * Aktif trip'in canlı ölçümleri (5 s'de bir `_notify`) GÖNDERİLMEZ. Yalnız
 * `history` dizisine YENİ bir kayıt eklendiğinde tek bir yükleme yapılır.
 *
 * ── ZERO-LEAK ────────────────────────────────────────────────────────
 * Tek abonelik; `stop()` onu temizler. Defter `localStorage`'a yazılır ki
 * yeniden başlatmada aynı trip tekrar yüklenmesin.
 */

import { onTripState, getTripSnapshot, type TripRecord } from '../tripLogService';
import { callVehicleRpc } from '../vehicleIdentityService';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import {
  TripUploadCoordinator,
  parseTripAck,
  type TripUploadSnapshot,
} from './tripUploadCoordinator';
import { toCanonicalTripSummary } from './tripLifecycle';
import type { TripSummary } from './tripCanonicalModel';

/** Yükleme defterinin kalıcı anahtarı — dedupe hafızası yeniden başlatmada yaşar. */
const LEDGER_KEY = 'caros.trip.uploadLedger';
/** Defter üst sınırı — sınırsız büyüme yok. */
const MAX_LEDGER_ENTRIES = 200;

class TripUploadRuntime {
  private readonly _coordinator = new TripUploadCoordinator();
  private _unsub: (() => void) | null = null;
  private _started = false;
  /** Son görülen geçmiş uzunluğu — YENİ kaydı bundan tespit ederiz. */
  private _lastHistoryLength = -1;
  /** Uçuşta yükleme sayısı — eşzamanlı taşkını önler. */
  private _inFlight = 0;

  start(): () => void {
    if (this._started) return () => this.stop();
    this._started = true;

    this._hydrate();

    try {
      /* Açılıştaki mevcut geçmiş uzunluğunu çapa al: eski tripler
         YÜKLENMEZ (bu tur yalnız BUNDAN SONRAKİ tripleri taşır). Geçmişin
         toptan göçü ayrı bir turdur — açık borç. */
      this._lastHistoryLength = getTripSnapshot().history.length;
    } catch { this._lastHistoryLength = -1; }

    try {
      this._unsub = onTripState((state) => {
        try { this._onTripState(state.history); } catch { /* FAIL-SOFT */ }
      });
    } catch { /* abonelik kurulamadıysa runtime sessiz kalır */ }

    return () => this.stop();
  }

  stop(): void {
    this._started = false;
    try { this._unsub?.(); } catch { /* yok sayılır */ }
    this._unsub = null;
  }

  /* ── Değişim tespiti ────────────────────────────────────────────────── */

  private _onTripState(history: readonly TripRecord[]): void {
    /* İlk gözlem: yalnız çapayı kur, yükleme YAPMA. */
    if (this._lastHistoryLength < 0) {
      this._lastHistoryLength = history.length;
      return;
    }
    /* Geçmiş büyümediyse hiçbir trip KAPANMADI → iş yok.
       (Canlı ölçüm bildirimleri 5 s'de bir gelir; burada eleniyor.) */
    if (history.length <= this._lastHistoryLength) {
      this._lastHistoryLength = history.length;
      return;
    }

    const newCount = history.length - this._lastHistoryLength;
    this._lastHistoryLength = history.length;

    /* `tripLogService` yeni kaydı BAŞA ekler. */
    for (let i = 0; i < newCount && i < history.length; i += 1) {
      const record = history[i];
      if (!record) continue;
      /* P2: `tripLogService` artık mesafe/yakıt/maliyet kaynağını ve
         kanıta dayalı confidence'ı KAYDIN İÇİNDE üretiyor. Buradan sabit
         bağlam GEÇİLMEZ — geçilirse ölçülmüş bir metrik "tahmin" diye
         yüklenir (P1'de öyleydi). Bağlam yalnız kayıtta ALAN YOKSA
         (eski P1 kayıtları) devreye giren fallback'tir. */
      const summary = toCanonicalTripSummary(record, 'COMPLETED', {
        distanceSource: 'DERIVED',   // yalnız eski kayıtlar için taban
        fuelMeasured: false,         // yalnız eski kayıtlar için taban
        fuelPriceKnown: false,       // yalnız eski kayıtlar için taban
      });
      void this._upload(summary);
    }
  }

  /* ── Yükleme ────────────────────────────────────────────────────────── */

  private async _upload(summary: TripSummary): Promise<void> {
    const nowMs = Date.now();
    const decision = this._coordinator.decide(summary);
    if (!decision.shouldEnqueue) return;

    /* Eşzamanlı taşkın koruması: aynı anda çok trip kapanmaz, ama
       kalıcılık hatası sonrası tekrar akınına karşı sınır konur. */
    if (this._inFlight >= 3) return;

    this._coordinator.markQueued(summary, decision.revision, nowMs);
    this._persist();
    this._inFlight += 1;

    try {
      const raw = await callVehicleRpc('upload_vehicle_trip', {
        p_trip_key: summary.tripKey,
        p_trip_id: summary.tripId,
        p_revision: decision.revision,
        p_started_at_ms: summary.startedAtMs,
        p_ended_at_ms: summary.endedAtMs,
        p_metrics: this._metricsPayload(summary),
        p_score: summary.score,
        p_confidence: summary.confidence,
        p_sources: {
          distance: summary.metrics.distanceKm.source,
          fuel: summary.metrics.fuelUsedL.source,
          cost: summary.metrics.estimatedCost.source,
        },
        /* §2: METRİK BAŞINA provenance. Tek genel "estimated" bayrağı
           yetmez — bir trip'in mesafesi ölçülmüş, yakıtı tahmini,
           RPM'i hiç yok olabilir. */
        p_provenance: this._provenancePayload(summary),
        /* §4: fiyat SNAPSHOT'ı trip ile birlikte gider; sonradan fiyat
           değişse geçmiş maliyet yeniden yazılmaz. */
        p_price: this._pricePayload(summary),
        /* §9: confidence'ın DAYANDIĞI kanıt — güven denetlenebilir olsun. */
        p_coverage: this._coveragePayload(summary),
        p_metrics_version: summary.metricsVersion,
        p_events: summary.events,
      });

      if (raw === null) {
        /* Ağ/HTTP hatası — sunucu hükmü YOK, geçici sayılır. */
        this._coordinator.applyTransportFailure(summary.tripKey, Date.now());
      } else {
        this._coordinator.applyAck(summary.tripKey, parseTripAck(raw), Date.now());
      }
    } catch {
      this._coordinator.applyTransportFailure(summary.tripKey, Date.now());
    } finally {
      this._inFlight -= 1;
      this._persist();
    }
  }

  /**
   * Metrik yükü. **Bilinmeyen alan HİÇ KONMAZ** — `null` göndermek yerine
   * anahtarı atlamak sunucudaki `COALESCE(EXCLUDED.x, t.x)` sözleşmesiyle
   * uyumludur (eski değer ezilmez).
   */
  private _metricsPayload(s: TripSummary): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    const put = (key: string, v: number | null): void => {
      if (v !== null) out[key] = v;
    };
    put('distanceKm', s.metrics.distanceKm.value);
    put('durationMin', s.metrics.durationMin.value);
    put('averageSpeedKmh', s.metrics.averageSpeedKmh.value);
    put('maximumSpeedKmh', s.metrics.maximumSpeedKmh.value);
    put('fuelUsedL', s.metrics.fuelUsedL.value);
    put('estimatedCost', s.metrics.estimatedCost.value);
    put('idleTimeMin', s.metrics.idleTimeMin.value);
    put('movingTimeMin', s.metrics.movingTimeMin.value);
    /* §6: bilinmeyen süre AYRI kova — idle'a katılırsa "duruyordu"
       TAHMİNİ üretilmiş olur. */
    put('unknownTimeMin', s.metrics.unknownTimeMin.value);
    put('stopCount', s.metrics.stopCount.value);
    put('maxRpm', s.metrics.maxRpm.value);
    put('maxEngineTempC', s.metrics.maxEngineTempC.value);
    put('speedViolations', s.metrics.speedViolations.value);
    put('harshBrakeCount', s.metrics.harshBrakeCount.value);
    put('harshAccelCount', s.metrics.harshAccelCount.value);
    /* §3: ÖLÇÜLEN yakıt yüzdesi — litreden AYRI alan (litre depo
       kapasitesine bağlı bir DÖNÜŞÜMDÜR, ölçüm değil). */
    put('fuelUsedPercent', s.fuelUsedPercent.value);
    if (s.fuelUnit !== null) out.fuelUnit = s.fuelUnit;
    /* Ölçüm reddedildiyse GEREKÇE de gider — sessiz "tahmin" YOK. */
    if (s.fuelRejectReason !== null) out.fuelRejectReason = s.fuelRejectReason;
    return out;
  }

  /**
   * §2 metrik başına provenance.
   *
   * Bilinmeyen alan **KONMAZ** (`null` gönderilmez): sunucudaki
   * `coalesce(_trip_source(...), kolon)` sözleşmesi eksik provenance'ın
   * eski güvenilir değeri EZMEMESİNİ sağlar.
   */
  private _provenancePayload(s: TripSummary): Record<string, string> {
    const out: Record<string, string> = {};
    const put = (key: string, m: { value: number | null; source: string }): void => {
      /* Değeri olmayan metriğin provenance'ı da YOKTUR — `UNAVAILABLE`
         etiketini yazmak "ölçmeye çalıştık, olmadı" iddiasıdır. */
      if (m.value !== null) out[key] = m.source;
    };
    put('duration', s.metrics.durationMin);
    put('avgSpeed', s.metrics.averageSpeedKmh);
    put('maxSpeed', s.metrics.maximumSpeedKmh);
    put('idle', s.metrics.idleTimeMin);
    put('moving', s.metrics.movingTimeMin);
    put('stopCount', s.metrics.stopCount);
    put('maxRpm', s.metrics.maxRpm);
    put('maxTemp', s.metrics.maxEngineTempC);
    put('speedViolation', s.metrics.speedViolations);
    put('harshBrake', s.metrics.harshBrakeCount);
    put('harshAccel', s.metrics.harshAccelCount);
    return out;
  }

  /** §4 fiyat snapshot'ı. Birim fiyat yoksa yük BOŞTUR (uydurma fiyat YOK). */
  private _pricePayload(s: TripSummary): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    if (s.price.unitPrice === null) return out;
    out.unitPrice = s.price.unitPrice;
    if (s.price.currency !== null) out.currency = s.price.currency;
    if (s.price.source !== null) out.source = s.price.source;
    if (s.price.capturedAtMs !== null) out.capturedAtMs = s.price.capturedAtMs;
    return out;
  }

  /** §9 confidence kanıtı. Eksik kanıt KONMAZ — `0` bir kanıt DEĞİLDİR. */
  private _coveragePayload(s: TripSummary): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    const c = s.coverage;
    if (c.speedSampleCount !== null) out.speedSampleCount = c.speedSampleCount;
    if (c.obdCoverage !== null) out.obdCoverage = c.obdCoverage;
    if (c.timeCoverage !== null) out.timeCoverage = c.timeCoverage;
    if (c.dataGapCount !== null) out.dataGapCount = c.dataGapCount;
    if (c.sourceSwitchCount !== null) out.sourceSwitchCount = c.sourceSwitchCount;
    if (c.limitedBy !== null) out.limitedBy = c.limitedBy;
    return out;
  }

  /* ── Kalıcılık ──────────────────────────────────────────────────────── */

  private _persist(): void {
    try {
      const entries = this._coordinator.serialize().slice(0, MAX_LEDGER_ENTRIES);
      safeSetRaw(LEDGER_KEY, JSON.stringify(entries));
    } catch { /* kalıcılık hatası yüklemeyi bozmaz */ }
  }

  private _hydrate(): void {
    try {
      const raw = safeGetRaw(LEDGER_KEY);
      if (raw) this._coordinator.hydrate(JSON.parse(raw));
    } catch { /* bozuk defter yok sayılır */ }
  }

  /* ── Okuma yüzeyi ───────────────────────────────────────────────────── */

  getSnapshot(): TripUploadSnapshot {
    return this._coordinator.getSnapshot();
  }

  isStarted(): boolean {
    return this._started;
  }
}

export const tripUploadRuntime = new TripUploadRuntime();

/** SystemBoot kablolaması — başlatır, cleanup döndürür. */
export function startTripUpload(): () => void {
  return tripUploadRuntime.start();
}

export function stopTripUpload(): void {
  tripUploadRuntime.stop();
}

/** LAB salt-okur — hiçbir şey BAŞLATMAZ, yükleme TETİKLEMEZ. */
export function readTripUploadSnapshot(): TripUploadSnapshot {
  return tripUploadRuntime.getSnapshot();
}
