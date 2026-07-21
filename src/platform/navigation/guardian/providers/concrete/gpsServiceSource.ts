/**
 * gpsServiceSource — GUARDIAN-AI-G14 (Concrete GPS Source).
 *
 * G12 `GpsSource` sözleşmesinin İLK GERÇEK implementasyonu: mevcut CAROS PRO GPS
 * servisinin konum snapshot'ından yalnız ARAÇ HIZINI okuyup `RawGpsData
 * {currentSpeedKph?}` üretir. Bu gerçek-IO fazının ilk küçük dilimidir — yalnız
 * GPS hız kaynağı bağlanır.
 *
 * ── TASARIM İLKELERİ ────────────────────────────────────────────────────────
 *  - Guardian katmanı Android/Capacitor API'sini BİLMEZ: gerçek servise küçük bir
 *    PORT (`GpsLocationPort`) üzerinden bağlanır (DI). Concrete factory `gpsService`
 *    modülünü TOP-LEVEL import ETMEZ — o modül import-time `subscribe(...)` yan
 *    etkileri taşır. Gerçek bağlama `createUnifiedStoreGpsLocationPort()` ile
 *    yetkili `UnifiedVehicleStore` snapshot'ından okunur (bu store import-güvenli:
 *    modül seviyesinde timer/listener/abonelik YOK).
 *  - PULL/snapshot: `read()` yalnız son konum snapshot'ını okur; polling loop,
 *    timer, interval, subscription EKLEMEZ (zero-leak).
 *  - Determinism: `Date.now` source İÇİNE gömülmez — tazelik için gereken "şimdi"
 *    DI `clock.nowMs()` ile gelir. Aynı snapshot + aynı clock/policy → aynı çıktı.
 *
 * ── HIZ BİRİMİ (heuristic YASAK) ────────────────────────────────────────────
 * Birim `snapshot.speedUnit` ile AÇIKÇA gelir: `'mps'` → `speed * 3.6`; `'kph'` →
 * aynen. Birim yok/bilinmiyorsa TAHMİN edilmez → `undefined` (fail-soft). Yetkili
 * store hızı `GPSLocation.speed` m/s'dir (types.ts'te doğrulanmış) → gerçek port
 * `speedUnit:'mps'` verir.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Servis hazır değil / izin yok / konum yok / hız yok / hız geçersiz (NaN/Inf/
 * negatif) / birim belirsiz / stale / accuracy gate düştü / port throw etti →
 * `read()` `undefined` döner, ASLA throw etmez. Guardian'ın diğer kaynakları
 * çalışmaya devam eder. (PII/koordinat/rota loglanmaz — bu source zaten koordinat
 * OKUMAZ, yalnız hız/tazelik/doğruluk metadatası.)
 */
import type { RawGpsData, GpsSource } from '../gpsSource';
import { useUnifiedVehicleStore } from '../../../../vehicleDataLayer/UnifiedVehicleStore';

/* ── Port sözleşmesi (Guardian ↔ gerçek servis sınırı) ────────────────────── */

export type GpsSpeedUnit = 'mps' | 'kph';

/** Gerçek servisten okunan ham konum snapshot'ı (Guardian tarafına normalize).
 *  Tüm alanlar opsiyonel — kaynak güvenilmez olabilir. */
export interface GpsLocationSnapshot {
  /** Ham hız değeri; birimi `speedUnit` belirler (tahmin YOK). */
  speed?:           number;
  speedUnit?:       GpsSpeedUnit;
  /** Konum fix zaman damgası (epoch ms) — tazelik (stale) kapısı için. */
  timestampMs?:     number;
  /** Konum doğruluğu (metre) — accuracy kapısı için. */
  accuracyMeters?:  number;
}

/** Guardian'ın bağlandığı küçük port — gerçek GPS servisini soyutlar. */
export interface GpsLocationPort {
  getLatestLocation(): GpsLocationSnapshot | undefined;
}

/** Tazelik hesabı için DI saat portu — `Date.now` source içine gömülmez. */
export interface GpsClock {
  nowMs(): number;
}

/** DI ile gelen kapılar (hepsi opsiyonel). */
export interface GpsSourcePolicy {
  /** Verilirse: snapshot yaşı bu değeri AŞARSA hız sunulmaz (stale). Bu kapı
   *  aktifken `clock` VE `snapshot.timestampMs` gereklidir (yoksa fail-soft). */
  maxLocationAgeMs?:   number;
  /** Verilirse: `snapshot.accuracyMeters` bu değeri AŞARSA hız sunulmaz. */
  maxAccuracyMeters?:  number;
}

export interface GpsServiceSourceDependencies {
  port:     GpsLocationPort;
  policy?:  GpsSourcePolicy;
  clock?:   GpsClock;
}

/* ── Sabitler ─────────────────────────────────────────────────────────────── */

/** m/s → km/h çarpanı (birim `'mps'` olarak DOĞRULANDIĞINDA). */
const KMH_PER_MS = 3.6;

/** Gerçek store hızının birimi — `GPSLocation.speed` m/s'dir (types.ts'te
 *  `// m/s` yorumuyla doğrulanmış). Bu bir heuristic DEĞİL, doğrulanmış sözleşme. */
const STORE_SPEED_UNIT: GpsSpeedUnit = 'mps';

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Port'u FAIL-SOFT okur: port throw ederse veya nesne-olmayan çıktı verirse
 *  `undefined` döner (asla throw etmez). */
function safeReadSnapshot(port: GpsLocationPort): GpsLocationSnapshot | undefined {
  let snapshot: GpsLocationSnapshot | undefined;
  try {
    snapshot = port.getLatestLocation();
  } catch {
    return undefined; // servis hatası Guardian'ı devirmez
  }
  return isObject(snapshot) ? snapshot : undefined;
}

/* ── Concrete source ──────────────────────────────────────────────────────── */

/**
 * Gerçek GPS servisine port üzerinden bağlı `GpsSource` üretir. Factory
 * DI'yı doğrular (wiring/programlama hatası → throw); üretilen `read()` ise HER
 * ZAMAN fail-soft'tur (runtime veri sorunu → `undefined`, asla throw). Factory
 * port'u OKUMAZ (lazy) ve hiçbir timer/listener kurmaz.
 */
export function createGpsServiceSource(deps: GpsServiceSourceDependencies): GpsSource {
  if (!isObject(deps) || !deps.port || typeof deps.port.getLatestLocation !== 'function') {
    throw new RangeError('createGpsServiceSource: geçerli bir port zorunludur (getLatestLocation fonksiyonu).');
  }
  const { port, policy, clock } = deps;

  if (policy !== undefined) {
    if (!isObject(policy)) {
      throw new RangeError('createGpsServiceSource: policy bir nesne olmalı.');
    }
    if (policy.maxLocationAgeMs !== undefined && (!isFiniteNumber(policy.maxLocationAgeMs) || policy.maxLocationAgeMs < 0)) {
      throw new RangeError(`createGpsServiceSource: geçersiz policy.maxLocationAgeMs (${policy.maxLocationAgeMs}) — negatif-olmayan finite olmalı.`);
    }
    if (policy.maxAccuracyMeters !== undefined && (!isFiniteNumber(policy.maxAccuracyMeters) || policy.maxAccuracyMeters < 0)) {
      throw new RangeError(`createGpsServiceSource: geçersiz policy.maxAccuracyMeters (${policy.maxAccuracyMeters}) — negatif-olmayan finite olmalı.`);
    }
  }
  if (clock !== undefined && typeof clock.nowMs !== 'function') {
    throw new RangeError('createGpsServiceSource: clock verildiyse nowMs() fonksiyonu olmalı.');
  }

  return {
    read(): RawGpsData | undefined {
      const snapshot = safeReadSnapshot(port);
      if (snapshot === undefined) return undefined;

      // 1) Hız geçerliliği — finite ve negatif-olmayan.
      if (!isFiniteNumber(snapshot.speed) || snapshot.speed < 0) return undefined;

      // 2) Birim (heuristic YOK) — açık `speedUnit` gerekli.
      let currentSpeedKph: number;
      if (snapshot.speedUnit === 'kph')      currentSpeedKph = snapshot.speed;
      else if (snapshot.speedUnit === 'mps') currentSpeedKph = snapshot.speed * KMH_PER_MS;
      else return undefined; // bilinmeyen/eksik birim → tahmin etme
      if (!isFiniteNumber(currentSpeedKph) || currentSpeedKph < 0) return undefined;

      // 3) Tazelik (opt-in) — clock + timestamp gerekli; yoksa fail-soft.
      if (policy?.maxLocationAgeMs !== undefined) {
        if (!clock) return undefined;
        if (!isFiniteNumber(snapshot.timestampMs)) return undefined;
        let now: number;
        try {
          now = clock.nowMs();
        } catch {
          return undefined;
        }
        if (!isFiniteNumber(now)) return undefined;
        const ageMs = now - snapshot.timestampMs;
        if (ageMs < 0 || ageMs > policy.maxLocationAgeMs) return undefined; // gelecek/stale
      }

      // 4) Accuracy (opt-in) — accuracy alanı gerekli.
      if (policy?.maxAccuracyMeters !== undefined) {
        if (!isFiniteNumber(snapshot.accuracyMeters)) return undefined;
        if (snapshot.accuracyMeters > policy.maxAccuracyMeters) return undefined;
      }

      // Her çağrıda YENİ nesne (immutable çıktı).
      return { currentSpeedKph };
    },
  };
}

/* ── Gerçek servis bağlaması (concrete port) ──────────────────────────────── */

/**
 * Yetkili `UnifiedVehicleStore` snapshot'ından okuyan gerçek `GpsLocationPort`.
 * `GPSLocation.speed` m/s'dir (doğrulanmış) → `speedUnit:'mps'`. Store'dan yalnız
 * hız/tazelik/doğruluk metadatası alınır (koordinat Guardian'a taşınmaz).
 * Snapshot değiştirilmeden yeni bir DTO üretilir (immutable).
 */
export function createUnifiedStoreGpsLocationPort(): GpsLocationPort {
  return {
    getLatestLocation(): GpsLocationSnapshot | undefined {
      const loc = useUnifiedVehicleStore.getState().location;
      if (!isObject(loc)) return undefined;
      return {
        speed:          loc.speed,
        speedUnit:      STORE_SPEED_UNIT,
        timestampMs:    loc.timestamp,
        accuracyMeters: loc.accuracy,
      };
    },
  };
}
