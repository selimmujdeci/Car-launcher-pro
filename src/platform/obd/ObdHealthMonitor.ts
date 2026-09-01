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

import { OBD_FROZEN_ABS_MS } from '../freshnessPolicy';

/** Sanitizer'ın izlediği alanlar — NativeOBDData alan adlarıyla birebir. */
export const HEALTH_FIELDS = [
  'speed', 'rpm', 'engineTemp', 'fuelLevel',
  'throttle', 'intakeTemp', 'boostPressure', 'voltage',
] as const;
export type HealthField = (typeof HEALTH_FIELDS)[number];

/**
 * P0-OBD-06 — Bir alanın BU POLL TURUNDAKİ sonucu.
 *
 * Üçü de AYRI nedendir ve BİRLEŞTİRİLMEZ:
 *  · `accepted`    — native değer sundu, sanitizer kabul etti.
 *  · `rejected`    — native değer sundu ama sanitizer REDDETTİ (aralık dışı /
 *                    imkânsız sıçrama). Bu bir ÇÖZÜMLEME/VERİ hatasıdır.
 *  · `not_offered` — native `-1` sentinel'i döndürdü: bu turda sorulmadı ya da
 *                    ECU veri VERMEDİ (NO DATA). "Sağlıklı" DEĞİLDİR.
 */
export type FieldSampleOutcome = 'accepted' | 'rejected' | 'not_offered';

/**
 * Alan başına ZAMANLAMA kanıtı. Hepsi MEVCUT poll akışından türetilir —
 * ELM327'ye TEK EK SORGU gitmez.
 *
 * `null` = hiç gözlenmedi. Sahte 0 YOK: "0 ms önce güncellendi" ile "hiç
 * güncellenmedi" tamamen farklı iki gerçektir.
 */
export interface FieldTimingSnapshot {
  /** Son KABUL edilen ölçümün anı (monotonik ms); yoksa `null`. */
  readonly lastAcceptedAtMs: number | null;
  /** Değerin son DEĞİŞTİĞİ an; yoksa `null`. */
  readonly lastChangedAtMs: number | null;
  /** Son reddedilen (çözümleme/aralık hatası) ölçümün anı; yoksa `null`. */
  readonly lastRejectedAtMs: number | null;
  /** Native'in değer SUNMADIĞI (`-1`) son an; yoksa `null`. */
  readonly lastNotOfferedAtMs: number | null;
  /**
   * Ardışık KABUL edilen ölçümler arasındaki gözlenen aralığın üstel
   * ortalaması (ms). Tek örnekten hesaplanamaz → `null`.
   *
   * BU BİR ROUND-TRIP DEĞİLDİR: komutun gidiş-dönüş süresi çekirdek poll
   * yolunda ÖLÇÜLMEZ (ölçmek sıcak döngüye dokunmak olurdu). Bu değer
   * "veri bize hangi sıklıkla ULAŞIYOR" sorusunu yanıtlar.
   */
  readonly observedIntervalMs: number | null;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly notOfferedCount: number;
}

export interface ObdHealthSnapshot {
  /** 0-100 — bağlantı kalitesi. Bağlantı hiç kurulmadıysa -1. */
  connectionQuality: number;
  /** Alan → 0-100 güvenilirlik. Hiç veri görmemiş alanlar haritada YOK. */
  sensorReliability: Partial<Record<HealthField, number>>;
  /** Son kabul edilen paketten bu yana geçen süre (ms). -1 = hiç paket yok. */
  lastPacketAgeMs: number;
  /**
   * DONMA SİNYALİ (kullanıcı algısı): son geçerli paket STALE_ABS_MS'ten eski mi.
   * connectionQuality'den BAĞIMSIZ ve MUTLAK — çünkü "gösterge donuk mu" sorusu
   * adaptörün ne kadar hızlı olabileceğine değil, verinin ne kadardır güncellenmediğine
   * bağlıdır. Zayıf head unit gerçekten yavaş sorgulasa bile kullanıcı için gösterge
   * DONUKTUR → bu bayrak açık kalmalı (rapor "her şey %100" yalanını söylememeli).
   */
  isStale: boolean;
  /** Sönümlü reconnect sayacı (teşhis için ham değer). */
  reconnectPressure: number;
  /**
   * P0-OBD-06 — alan başına zamanlama kanıtı. Hiç gözlenmemiş alan haritada YOK
   * (boş kayıt "sağlıklı" gibi okunmasın).
   */
  fieldTiming: Partial<Record<HealthField, FieldTimingSnapshot>>;
  /** Aktif beklenen poll periyodu (ms) — yaş kararları buna GÖRELİ verilir. */
  expectedIntervalMs: number;
  /** Bu oturumda hiç kabul edilmiş paket geldi mi. */
  sessionHasData: boolean;
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
/**
 * Mutlak donma eşiği (ms) — son paket bundan eskiyse `isStale=true`. Sürücü için
 * göstergenin ~4s güncellenmemesi "donmuş" demektir; poll config'inden bağımsız.
 *
 * E-01/E-36: değer artık ELLE KOPYALANMAZ — `freshnessPolicy` tek otoritedir.
 * Aynı soruyu soran `diagnosticTriage` ve `diagnosticEvidence` de oradan okur.
 */
const STALE_ABS_MS = OBD_FROZEN_ABS_MS;

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
  /* P0-OBD-06 — alan başına zamanlama. Kurucuda TAM ŞEKİLLİ (hidden-class
     kararlılığı): sıcak yolda sonradan anahtar EKLENMEZ. */
  private readonly _t: Record<HealthField, {
    acceptedAt: number; changedAt: number; rejectedAt: number; notOfferedAt: number;
    value: number; interval: number; ok: number; bad: number; miss: number;
  }>;

  constructor() {
    this._ok  = { speed: 0, rpm: 0, engineTemp: 0, fuelLevel: 0, throttle: 0, intakeTemp: 0, boostPressure: 0, voltage: 0 };
    this._bad = { speed: 0, rpm: 0, engineTemp: 0, fuelLevel: 0, throttle: 0, intakeTemp: 0, boostPressure: 0, voltage: 0 };
    const blank = () => ({
      acceptedAt: -1, changedAt: -1, rejectedAt: -1, notOfferedAt: -1,
      value: Number.NaN, interval: -1, ok: 0, bad: 0, miss: 0,
    });
    this._t = {
      speed: blank(), rpm: blank(), engineTemp: blank(), fuelLevel: blank(),
      throttle: blank(), intakeTemp: blank(), boostPressure: blank(), voltage: blank(),
    };
  }

  /** Sayaç tavanı — sınırsız büyüme yok (SystemBoot doygunluk deseni). */
  private static readonly COUNTER_MAX = 1_000_000;
  private static _sat(n: number): number {
    return n >= ObdHealthMonitorImpl.COUNTER_MAX ? ObdHealthMonitorImpl.COUNTER_MAX : n + 1;
  }

  /**
   * P0-OBD-06 — bir alanın tur sonucunu ZAMAN DAMGASIYLA kaydeder.
   *
   * MEVCUT ölçümden türer: `_sanitizeNative` zaten hem native'in sunduğu ham
   * değeri hem sanitizer kararını biliyor. Ek sorgu YOK, yeni timer YOK.
   *
   * Değer DEĞİŞİMİ ayrı izlenir: "aynı değer uzun süre" tek başına arıza
   * DEĞİLDİR (park hâlinde devir 0 sabittir) — ama YENİLEME gelmiyorsa o
   * STALL'dır. İkisini ayırmak bu iki damganın varlık sebebidir.
   */
  noteFieldSample(
    field: HealthField, outcome: FieldSampleOutcome,
    value: number | null, nowMs: number = performance.now(),
  ): void {
    const t = this._t[field];
    if (t === undefined) return;
    if (outcome === 'not_offered') {
      t.notOfferedAt = nowMs;
      t.miss = ObdHealthMonitorImpl._sat(t.miss);
      return;
    }
    if (outcome === 'rejected') {
      t.rejectedAt = nowMs;
      t.bad = ObdHealthMonitorImpl._sat(t.bad);
      return;
    }
    /* accepted */
    if (t.acceptedAt >= 0) {
      const gap = nowMs - t.acceptedAt;
      /* Üstel ortalama (α=0.3): tek bir gecikme ortalamayı uçurmaz, kalıcı
         yavaşlama ise birkaç turda görünür. */
      t.interval = t.interval < 0 ? gap : t.interval * 0.7 + gap * 0.3;
    }
    t.acceptedAt = nowMs;
    t.ok = ObdHealthMonitorImpl._sat(t.ok);
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (!Number.isFinite(t.value) || t.value !== value) t.changedAt = nowMs;
      t.value = value;
    }
  }

  /** Bağlantı kuruldu — bayatlık referansı sıfırlanır (önceki oturumun yaşı sayılmaz). */
  noteConnected(nowMs: number = performance.now()): void {
    this._sessionStartMs = nowMs;
    /* P0-OBD-06 — YENİ OTURUM, YENİ KANIT. Önceki bağlantının zamanlaması
       taşınırsa, yeni oturumda tek ölçüm gelmeden alan "taze" görünür ve
       adaptör başka araca takılmışsa o aracın değeriyle karar verilir. */
    this._clearTiming();
  }

  /** AdaptivePollingController profili değişti — bayatlık bu periyoda göre ölçülür. */
  setExpectedIntervalMs(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this._expectedIntervalMs = ms;
  }

  /** Reconnect planlandı (gerçek kopma). */
  noteReconnect(nowMs: number = performance.now()): void {
    this._applyReconnectDecay(nowMs);
    this._reconnectPressure += 1;
    /* Kopma anında da zamanlama düşer: kopmuş bir hattın son değeri "taze"
       sayılamaz (bu turun kapattığı kusurun ta kendisi). */
    this._clearTiming();
    this._lastPacketMs = -1;
  }

  private _clearTiming(): void {
    for (const f of HEALTH_FIELDS) {
      const t = this._t[f];
      t.acceptedAt = -1; t.changedAt = -1; t.rejectedAt = -1; t.notOfferedAt = -1;
      t.value = Number.NaN; t.interval = -1;
    }
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

    // Donma: yalnız gerçek paket yaşına bakar (oturum başlangıcı DEĞİL — henüz hiç
    // paket gelmemişse "donuk" değil "bekliyor" durumundadır, isStale=false).
    const isStale = lastPacketAgeMs >= 0 && lastPacketAgeMs > STALE_ABS_MS;

    const fieldTiming: Partial<Record<HealthField, FieldTimingSnapshot>> = {};
    for (const f of HEALTH_FIELDS) {
      const t = this._t[f];
      /* HİÇ gözlenmemiş alan haritaya GİRMEZ — boş kayıt "sağlıklı" gibi okunurdu. */
      if (t.acceptedAt < 0 && t.rejectedAt < 0 && t.notOfferedAt < 0) continue;
      fieldTiming[f] = {
        lastAcceptedAtMs:   t.acceptedAt   >= 0 ? t.acceptedAt   : null,
        lastChangedAtMs:    t.changedAt    >= 0 ? t.changedAt    : null,
        lastRejectedAtMs:   t.rejectedAt   >= 0 ? t.rejectedAt   : null,
        lastNotOfferedAtMs: t.notOfferedAt >= 0 ? t.notOfferedAt : null,
        observedIntervalMs: t.interval     >= 0 ? Math.round(t.interval) : null,
        acceptedCount: t.ok, rejectedCount: t.bad, notOfferedCount: t.miss,
      };
    }

    return {
      connectionQuality, sensorReliability, lastPacketAgeMs, isStale, reconnectPressure,
      fieldTiming,
      expectedIntervalMs: this._expectedIntervalMs,
      sessionHasData: this._lastPacketMs >= 0,
    };
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
    this._clearTiming();
    for (const f of HEALTH_FIELDS) { const t = this._t[f]; t.ok = 0; t.bad = 0; t.miss = 0; }
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
