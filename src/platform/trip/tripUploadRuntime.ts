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
import { readJournal, attachJournalAreas } from './tripJournalStore';
import { TRIP_JOURNAL_SCHEMA_VERSION } from './tripJournalModel';

/** Yükleme defterinin kalıcı anahtarı — dedupe hafızası yeniden başlatmada yaşar. */
const LEDGER_KEY = 'caros.trip.uploadLedger';
/** Defter üst sınırı — sınırsız büyüme yok. */
const MAX_LEDGER_ENTRIES = 200;

/**
 * AÇILIŞTA taranacak geçmiş yolculuk sayısı (bekleyen senkron kurtarma).
 *
 * ── KAPATILAN BORÇ ────────────────────────────────────────────────────
 * Eskiden açılışta geçmişin uzunluğu ÇAPA alınıyordu ve "yalnız bundan
 * sonraki tripler taşınır" deniyordu. Sonucu şuydu: araç çevrimdışıyken
 * (tünel · kırsal · veri yok) biten bir yolculuk kapandıktan sonra uygulama
 * kapanırsa o yolculuk **BİR DAHA ASLA** yüklenmiyordu. Kullanıcı için bu,
 * "Seyir Defteri'nde dünkü yolculuğum yok" demekti.
 *
 * Artık açılışta son N yolculuk defterle karşılaştırılır; defterde HİÇ
 * kaydı olmayanlar kuyruğa verilir. Tekrar riski YOKTUR: sunucu `tripKey`
 * ile dedupe eder ve ikinci gönderim `DUPLICATE` döner (başarı sayılır).
 * N sınırlıdır — tüm geçmişin toptan göçü bu turun işi değildir.
 */
const BACKFILL_SCAN_LIMIT = 20;

class TripUploadRuntime {
  private _coordinator = new TripUploadCoordinator();
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
      /* Açılıştaki geçmiş uzunluğunu çapa al — YENİ kapanan trip'i bundan
         tespit ederiz. Açılıştan ÖNCE kapanmış ama hiç yüklenememiş
         tripler ayrı bir yoldan (backfill) taşınır. */
      this._lastHistoryLength = getTripSnapshot().history.length;
    } catch { this._lastHistoryLength = -1; }

    try {
      this._unsub = onTripState((state) => {
        try { this._onTripState(state.history); } catch { /* FAIL-SOFT */ }
      });
    } catch { /* abonelik kurulamadıysa runtime sessiz kalır */ }

    /* Bekleyen senkron kurtarma — ağ çağrıları asenkron, boot'u BEKLETMEZ. */
    void this._backfillPending();

    return () => this.stop();
  }

  /**
   * Açılışta: defterde HİÇ kaydı olmayan geçmiş tripleri kuyruğa ver.
   *
   * Çevrimdışıyken kapanıp sonra uygulama kapandığı için hiç gönderilememiş
   * yolculukları kurtarır. Zaten yüklenmiş/tekrar sayılmış tripler defterde
   * göründüğü için ATLANIR; defter kaybolsa bile sunucu `tripKey` dedupe'u
   * ikinci kapıdır.
   */
  private async _backfillPending(): Promise<void> {
    try {
      const history = getTripSnapshot().history.slice(0, BACKFILL_SCAN_LIMIT);
      for (const record of history) {
        if (!this._started) return;   // durduruldu → yarıda kes
        if (!record) continue;
        const summary = this._toSummary(record);
        /* Defterde kaydı VARSA bu trip zaten ele alınmıştır (yüklendi,
           tekrar sayıldı ya da bütçesi tükendi) — yeniden denemek
           koordinatörün hükmünü ezmek olurdu. */
        if (this._coordinator.getEntry(summary.tripKey) !== null) continue;
        await this._processTrip(record);
      }
    } catch { /* FAIL-SOFT: kurtarma düşse bile canlı yol çalışır */ }
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
      void this._processTrip(record);
    }
  }

  /**
   * Kanonik özet + kaba alan adı çözümü + yükleme.
   *
   * Alan adı ÇÖZÜMÜ yüklemeyi BEKLETİR ama engellemez: ters geocode düşerse
   * (çevrimdışı, zaman aşımı) trip alansız yüklenir — "Bilinmiyor" göstermek,
   * yolculuğu hiç göstermemekten iyidir ve uydurma bir yer adı yazmaktan
   * dürüsttür.
   */
  private async _processTrip(record: TripRecord): Promise<void> {
    try {
      await this._resolveAreas(record.id);
    } catch { /* alan adı bir SÜSLEMEDİR — yüklemeyi düşürmez */ }
    try {
      await this._upload(this._toSummary(record));
    } catch { /* FAIL-SOFT */ }
  }

  /**
   * P2: `tripLogService` artık mesafe/yakıt/maliyet kaynağını ve kanıta
   * dayalı confidence'ı KAYDIN İÇİNDE üretiyor. Buradan sabit bağlam
   * GEÇİLMEZ — geçilirse ölçülmüş bir metrik "tahmin" diye yüklenir
   * (P1'de öyleydi). Bağlam yalnız kayıtta ALAN YOKSA (eski P1 kayıtları)
   * devreye giren fallback'tir.
   */
  private _toSummary(record: TripRecord): TripSummary {
    return toCanonicalTripSummary(record, 'COMPLETED', {
      distanceSource: 'DERIVED',   // yalnız eski kayıtlar için taban
      fuelMeasured: false,         // yalnız eski kayıtlar için taban
      fuelPriceKnown: false,       // yalnız eski kayıtlar için taban
    });
  }

  /**
   * Başlangıç/varış KONUMUNU kaba ALAN ADINA çevir ve deftere iliştir.
   *
   * ── KOORDİNAT BULUTA GİTMEZ ───────────────────────────────────────
   * Çözüm BURADA, cihazda yapılır; buluta yalnız METİN ("Tarsus") gider.
   * Koordinatı gönderip sunucuda çözmek, tam da kaçınılan şeydir.
   *
   * Zaten çözülmüş bir kayıt YENİDEN çözülmez (ağ israfı + ToS).
   * `geocodingService` dinamik import edilir: yalnız bir yolculuk
   * kapandığında yüklenir, boot grafiğine girmez.
   */
  private async _resolveAreas(tripId: string): Promise<void> {
    const rec = readJournal(tripId);
    if (rec === null) return;
    if (rec.startArea !== null && rec.endArea !== null) return;
    if (rec.startLocation === null && rec.endLocation === null) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const { reverseGeocodeParts } = await import('../geocodingService');

    /* Kaba alan = şehir; yoksa ilçe. Yol adı KULLANILMAZ — "D400 üzerinde"
       bir yolculuk özetinde yer adı değildir ve gereğinden fazla bilgi verir. */
    const area = async (p: { lat: number; lon: number } | null): Promise<string | null> => {
      if (p === null) return null;
      try {
        const parts = await reverseGeocodeParts(p.lat, p.lon);
        return parts === null ? null : (parts.city ?? parts.district);
      } catch { return null; }
    };

    const startArea = rec.startArea ?? await area(rec.startLocation);
    const endArea = rec.endArea ?? await area(rec.endLocation);
    if (startArea === null && endArea === null) return;   // uydurma YOK
    attachJournalAreas(tripId, startArea, endArea);
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
        /* SEYİR DEFTERİ: yalnız KÜÇÜK özet — kaba alan ADI (metin), bitiş
           gerekçesi, cihazın kapanış anı ve şema sürümü. Rota izi ·
           saniyelik GPS · koordinat BU YÜKTE YOKTUR ve sunucu şeması
           koordinat kolonunu yasaklar (migration 074/b). */
        p_journal: this._journalPayload(summary),
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

  /**
   * Seyir defteri özeti.
   *
   * Bilinmeyen alan **HİÇ KONMAZ** — sunucudaki `coalesce(yeni, eski)`
   * sözleşmesiyle uyumludur: eksik alan var olan değeri EZMEZ. Kayıt
   * bulunamazsa yük BOŞTUR; uydurma yer adı veya gerekçe ÜRETİLMEZ.
   */
  private _journalPayload(s: TripSummary): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    try {
      const rec = readJournal(s.tripId);
      if (rec === null) return out;
      if (rec.startArea !== null) out.startArea = rec.startArea;
      if (rec.endArea !== null) out.endArea = rec.endArea;
      /* `UNKNOWN` gerekçesi de GERÇEK bir bilgidir ("nasıl bittiğini
         bilmiyoruz") ve gönderilir — alan adının aksine bu bir iddia
         değil, dürüst bir kayıttır. */
      out.endReason = rec.endReason;
      if (rec.endedAtMs !== null) out.completedAtMs = rec.endedAtMs;
      out.schemaVersion = TRIP_JOURNAL_SCHEMA_VERSION;
    } catch { /* defter okunamazsa yük BOŞ kalır */ }
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

  /** @internal testler için — defteri ve çapayı sıfırlar (diske DOKUNMAZ). */
  _resetForTest(): void {
    this.stop();
    this._coordinator = new TripUploadCoordinator();
    this._lastHistoryLength = -1;
    this._inFlight = 0;
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
