/**
 * ObdHealthMonitor — Patch 7 (OBD Core v2).
 *
 * İki skor üretir (MVP hedef #13-14):
 *  - connectionQuality (0-100): reconnect baskısı + veri bayatlığından türetilen
 *    bağlantı kalitesi. Reconnect olayları üstel yarı-ömürle söner (geçici bir kopma
 *    kaliteyi sonsuza dek düşürmez); bayatlık aktif poll periyoduna GÖRELİ ölçülür
 *    (AdaptivePollingController 250ms-15s arası periyot uygulayabilir).
 *  - sensorReliability (alan → 0-100): sanitizer kabul/red oranı — üstel yarı-ömürlü
 *    sayaçlar, eski hatalar zamanla affedilir. Hiç veri görmemiş alan raporlanmaz.
 *
 * Tasarım kuralları:
 *  - Saf hesap + enjekte edilebilir monotonik saat (performance.now) → deterministik test.
 *    Duvar saati KULLANILMAZ (CLAUDE.md §4 Clock Jump Protection).
 *  - Sıfır-tahsis sıcak yol: notePacket nesne/dizi üretmez, önceden tahsisli sayaçları
 *    günceller (V8 hidden-class kararlılığı — tüm alanlar kurucuda tanımlı).
 *  - Fail-soft gözlemci: skor üretimi veri akışını asla etkilemez.
 */

/** Sanitizer'ın izlediği alanlar — NativeOBDData alan adlarıyla birebir. */
export const HEALTH_FIELDS = [
  'speed', 'rpm', 'engineTemp', 'fuelLevel',
  'throttle', 'intakeTemp', 'boostPressure', 'voltage',
] as const;
export type HealthField = (typeof HEALTH_FIELDS)[number];

export interface ObdHealthSnapshot {
  /** 0-100 — bağlantı kalitesi. Bağlantı hiç kurulmadıysa -1. */
  connectionQuality: number;
  /** Alan → 0-100 güvenilirlik. Hiç veri görmemiş alanlar haritada YOK. */
  sensorReliability: Partial<Record<HealthField, number>>;
  /** Son kabul edilen paketten bu yana geçen süre (ms). -1 = hiç paket yok. */
  lastPacketAgeMs: number;
  /** Sönümlü reconnect sayacı (teşhis için ham değer). */
  reconnectPressure: number;
}

/** Reconnect baskısı yarı-ömrü — 2 dk önceki kopma yarı ağırlıkta sayılır. */
const RECONNECT_HALF_LIFE_MS = 120_000;
/** Sensör kabul/red sayaçları yarı-ömrü — 5 dk. */
const FIELD_HALF_LIFE_MS = 300_000;
/** Reconnect başına kalite cezası (sönümlü baskı × bu katsayı). */
const RECONNECT_PENALTY = 25;
/** Bayatlık toleransı: beklenen periyodun bu katına kadar ceza yok. */
const STALE_GRACE_FACTOR = 3;
/** Bayatlık cezasının tavana (50 puan) ulaştığı kat. */
const STALE_MAX_FACTOR = 10;

function _decay(value: number, elapsedMs: number, halfLifeMs: number): number {
  if (elapsedMs <= 0 || value === 0) return value;
  return value * Math.pow(0.5, elapsedMs / halfLifeMs);
}

class ObdHealthMonitorImpl {
  // Sönümlü reconnect baskısı + son güncelleme zamanı
  private _reconnectPressure = 0;
  private _reconnectUpdatedMs = 0;
  // Son kabul edilen paket / oturum başlangıcı (monotonik ms)
  private _lastPacketMs = -1;
  private _sessionStartMs = -1;
  // Aktif beklenen poll periyodu (AdaptivePollingController.fastMs)
  private _expectedIntervalMs = 3_000;
  // Alan bazlı sönümlü ok/bad sayaçları — kurucuda tam şekilli (hidden-class kararlı)
  private readonly _ok:  Record<HealthField, number>;
  private readonly _bad: Record<HealthField, number>;
  private _fieldsUpdatedMs = 0;

  constructor() {
    this._ok  = { speed: 0, rpm: 0, engineTemp: 0, fuelLevel: 0, throttle: 0, intakeTemp: 0, boostPressure: 0, voltage: 0 };
    this._bad = { speed: 0, rpm: 0, engineTemp: 0, fuelLevel: 0, throttle: 0, intakeTemp: 0, boostPressure: 0, voltage: 0 };
  }

  /** Bağlantı kuruldu — bayatlık referansı sıfırlanır (önceki oturumun yaşı sayılmaz). */
  noteConnected(nowMs: number = performance.now()): void {
    this._sessionStartMs = nowMs;
  }

  /** AdaptivePollingController profili değişti — bayatlık bu periyoda göre ölçülür. */
  setExpectedIntervalMs(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this._expectedIntervalMs = ms;
  }

  /** Reconnect planlandı (gerçek kopma). */
  noteReconnect(nowMs: number = performance.now()): void {
    this._applyReconnectDecay(nowMs);
    this._reconnectPressure += 1;
  }

  /**
   * Sanitizer sonucu: alan native pakette SUNULDU mu (>= 0) ve patch'e KABUL edildi mi.
   * Sunulmayan (bu turda sorgulanmamış, -1 sentinel) alanlar İSTATİSTİĞE GİRMEZ —
   * staggered polling güvenilirliği düşürmez.
   */
  noteField(field: HealthField, accepted: boolean, nowMs: number = performance.now()): void {
    this._applyFieldDecay(nowMs);
    if (accepted) this._ok[field] += 1;
    else this._bad[field] += 1;
  }

  /** Kabul edilen (en az bir geçerli alanlı) paket geldi — bayatlık saati sıfırlanır. */
  notePacketAccepted(nowMs: number = performance.now()): void {
    this._lastPacketMs = nowMs;
  }

  snapshot(nowMs: number = performance.now()): ObdHealthSnapshot {
    const reconnectPressure = _decay(
      this._reconnectPressure, nowMs - this._reconnectUpdatedMs, RECONNECT_HALF_LIFE_MS);

    // Bayatlık: son paket YA DA oturum başlangıcından beri geçen süre / beklenen periyot
    const ref = Math.max(this._lastPacketMs, this._sessionStartMs);
    let connectionQuality = -1;
    let lastPacketAgeMs = -1;
    if (ref >= 0) {
      lastPacketAgeMs = this._lastPacketMs >= 0 ? nowMs - this._lastPacketMs : -1;
      const ageFactor = (nowMs - ref) / this._expectedIntervalMs;
      const stalePenalty = ageFactor <= STALE_GRACE_FACTOR
        ? 0
        : Math.min(50, (50 * (ageFactor - STALE_GRACE_FACTOR)) / (STALE_MAX_FACTOR - STALE_GRACE_FACTOR));
      connectionQuality = Math.max(0, Math.min(100,
        Math.round(100 - RECONNECT_PENALTY * reconnectPressure - stalePenalty)));
    }

    const sensorReliability: Partial<Record<HealthField, number>> = {};
    const fieldElapsed = nowMs - this._fieldsUpdatedMs;
    for (const f of HEALTH_FIELDS) {
      const ok  = _decay(this._ok[f],  fieldElapsed, FIELD_HALF_LIFE_MS);
      const bad = _decay(this._bad[f], fieldElapsed, FIELD_HALF_LIFE_MS);
      const total = ok + bad;
      if (total > 0.01) sensorReliability[f] = Math.round((100 * ok) / total);
    }

    return { connectionQuality, sensorReliability, lastPacketAgeMs, reconnectPressure };
  }

  /** Test/oturum sıfırlama — tüm sayaçlar başlangıç durumuna döner. */
  reset(): void {
    this._reconnectPressure = 0;
    this._reconnectUpdatedMs = 0;
    this._lastPacketMs = -1;
    this._sessionStartMs = -1;
    this._expectedIntervalMs = 3_000;
    this._fieldsUpdatedMs = 0;
    for (const f of HEALTH_FIELDS) { this._ok[f] = 0; this._bad[f] = 0; }
  }

  private _applyReconnectDecay(nowMs: number): void {
    this._reconnectPressure = _decay(
      this._reconnectPressure, nowMs - this._reconnectUpdatedMs, RECONNECT_HALF_LIFE_MS);
    this._reconnectUpdatedMs = nowMs;
  }

  private _applyFieldDecay(nowMs: number): void {
    const elapsed = nowMs - this._fieldsUpdatedMs;
    if (elapsed > 0 && this._fieldsUpdatedMs > 0) {
      for (const f of HEALTH_FIELDS) {
        this._ok[f]  = _decay(this._ok[f],  elapsed, FIELD_HALF_LIFE_MS);
        this._bad[f] = _decay(this._bad[f], elapsed, FIELD_HALF_LIFE_MS);
      }
    }
    this._fieldsUpdatedMs = nowMs;
  }
}

/** Modül-tekil monitör — obdService besler, UI/teşhis snapshot() ile okur. */
export const obdHealthMonitor = new ObdHealthMonitorImpl();

/** Kısayol: aktif OBD sağlık skoru anlık görüntüsü. */
export function getObdHealth(): ObdHealthSnapshot {
  return obdHealthMonitor.snapshot();
}
