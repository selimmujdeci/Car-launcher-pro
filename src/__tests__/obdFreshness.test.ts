/**
 * obdFreshness.test — P0-OBD-02 · OBD TAZELİK / SAĞLIK kilitleri.
 *
 * Kapatılan dört ölçülmüş kusur:
 *   F1  TÜM PID'lere SABİT 15 sn bayatlık eşiği uygulanıyordu. Genişletilmiş grup
 *       turda 1 PID okur → 16 PID izlenirken bir sinyalin SAĞLIKLI yaşı ~16 sn'dir.
 *       Sabit eşik çalışan PID'i "bayat" ilan ediyor (sahte alarm), aynı anda hızlı
 *       bir sinyalin 14 sn'lik gecikmesini "canlı" sayıyordu (sessiz yalan).
 *   F2  Bayat ölçüm "canlı" gibi kullanılıyordu: mağazada değer kalıyor ve hiçbir
 *       yaş kapısı yoktu → koparılmış bir hattın son değeriyle karar veriliyordu.
 *   F3  Reconnect'te `extendedPidService._values` TEMİZLENMİYORDU → önceki oturumun
 *       (hatta BAŞKA BİR ARACIN) ölçümü yeni oturumda taze damgayla akıyordu.
 *   F4  `v < 0` körlemesine eleme: `-1` sentinel'ini yakalarken GERÇEK negatif
 *       sıcaklıkları (soğuk iklimde ortam / emme / soğutma sıvısı) da yok ediyordu.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  computeFreshnessWindow, classifyFreshness,
  FRESHNESS_FLOOR_MS, EXT_ROTATION_TOLERANCE, STALE_TO_UNAVAILABLE_FACTOR,
} from '../platform/obd/obdFreshnessPolicy';
import {
  acceptCanonicalValue, CANONICAL_OBD_BY_KEY, CANONICAL_OBD_SIGNALS,
} from '../platform/obd/canonicalObdSignals';
import { _internals as extInternals, getPidStatus, watchPid, notifyObdConnected }
  from '../platform/obd/extendedPidService';

const T0 = 1_700_000_000_000;
const WIN = { staleMs: 30_000, unavailableMs: 90_000 };

/* ── F1 · Hızlı ve yavaş PID aynı eşiği KULLANMAZ ─────────────────────────── */

describe('P0-OBD-02 · F1 tazelik penceresi sinyale ve kadansa göre değişir', () => {
  it('sınıflar AYRI tabanlara sahiptir (tek sabit YOK)', () => {
    const f = FRESHNESS_FLOOR_MS;
    expect(f.hot).toBeLessThan(f.medium);
    expect(f.medium).toBeLessThan(f.slow);
    expect(f.slow).toBeLessThan(f.archival);
  });

  it('genişletilmiş eşik ROTASYON SÜRESİNDEN türer — 16 PID 1 PID gibi ölçülmez', () => {
    const one = computeFreshnessWindow({
      cls: 'medium', path: 'extended', cadenceMs: 1_000, watchedCount: 1,
    });
    const many = computeFreshnessWindow({
      cls: 'medium', path: 'extended', cadenceMs: 1_000, watchedCount: 16,
    });
    // 16 PID × 1 sn tur × 2 rotasyon toleransı = 32 sn > medium tabanı (30 sn)
    expect(many.staleMs).toBe(1_000 * 16 * EXT_ROTATION_TOLERANCE);
    expect(many.staleMs).toBeGreaterThan(one.staleMs);
  });

  it('YAVAŞ poll modunda (POWER_SAVE) eşik BÜYÜR — sahte bayatlık üretilmez', () => {
    const fast = computeFreshnessWindow({
      cls: 'medium', path: 'extended', cadenceMs: 1_000, watchedCount: 16,
    });
    const slow = computeFreshnessWindow({
      cls: 'medium', path: 'extended', cadenceMs: 15_000, watchedCount: 16,
    });
    expect(slow.staleMs).toBeGreaterThan(fast.staleMs);
  });

  it('sınıf tabanı ALTINA İNİLMEZ — tek kayıp paket ekranı yakıp söndürmez', () => {
    const w = computeFreshnessWindow({
      cls: 'slow', path: 'extended', cadenceMs: 250, watchedCount: 1,
    });
    expect(w.staleMs).toBe(FRESHNESS_FLOOR_MS.slow);
  });

  it('çekirdek eşik UYARLANABİLİR pencereyi kullanır (ikinci otorite kurulmaz)', () => {
    const w = computeFreshnessWindow({ cls: 'hot', path: 'core', coreWindowMs: 47_000 });
    expect(w.staleMs).toBe(47_000);   // çekirdek penceresi tabandan büyük → o kazanır
  });

  it('kadans bilinmiyorsa fail-soft: eşik hesaplanır, ÇÖKMEZ', () => {
    const w = computeFreshnessWindow({ cls: 'hot', path: 'extended' });
    expect(w.staleMs).toBeGreaterThan(0);
    expect(w.unavailableMs).toBe(w.staleMs * STALE_TO_UNAVAILABLE_FACTOR);
  });

  it('katalogdaki her sinyalin bir tazelik sınıfı VARDIR', () => {
    for (const d of CANONICAL_OBD_SIGNALS) {
      expect(FRESHNESS_FLOOR_MS[d.freshness], `${d.key} sınıfı geçersiz`).toBeGreaterThan(0);
    }
  });

  it('gaz kelebeği (hot) ile mesafe sayacı (archival) AYNI eşiği KULLANMAZ', () => {
    const hot = CANONICAL_OBD_BY_KEY.get('throttle')!;
    const arc = CANONICAL_OBD_BY_KEY.get('distanceWithMil')!;
    expect(hot.freshness).toBe('hot');
    expect(arc.freshness).toBe('archival');
    expect(FRESHNESS_FLOOR_MS[hot.freshness])
      .toBeLessThan(FRESHNESS_FLOOR_MS[arc.freshness]);
  });
});

/* ── F2 · LIVE → STALE → UNAVAILABLE ──────────────────────────────────────── */

describe('P0-OBD-02 · F2 iki aşamalı çürüme (bayat ≠ yok)', () => {
  const at = (ageMs: number) => classifyFreshness({
    hasValue: true, measuredAtMs: T0, nowMs: T0 + ageMs, window: WIN,
  });

  it('eşik içinde LIVE', () => {
    expect(at(0).state).toBe('LIVE');
    expect(at(29_999).state).toBe('LIVE');
    expect(at(30_000).state).toBe('LIVE');   // sınır DAHİL
  });

  it('eşiği aşınca STALE — değer hâlâ GERÇEK bir ölçümdür', () => {
    expect(at(30_001).state).toBe('STALE');
    expect(at(90_000).state).toBe('STALE');
    expect(at(45_000).reason).toBe('ok');
  });

  it('üç kat aşılınca UNAVAILABLE — gerekçe AÇIKÇA bildirilir', () => {
    const v = at(90_001);
    expect(v.state).toBe('UNAVAILABLE');
    expect(v.reason).toBe('expired');
  });

  it('ölçüm hiç yoksa UNAVAILABLE ve YAŞ HESAPLANMAZ (sahte 0 YOK)', () => {
    const v = classifyFreshness({
      hasValue: false, measuredAtMs: null, nowMs: T0, window: WIN,
    });
    expect(v.state).toBe('UNAVAILABLE');
    expect(v.ageMs).toBeNull();
    expect(v.reason).toBe('no_measurement');
  });

  it('damga 0 ise "1970" yaşı ÜRETİLMEZ', () => {
    const v = classifyFreshness({
      hasValue: true, measuredAtMs: 0, nowMs: T0, window: WIN,
    });
    expect(v.state).toBe('UNAVAILABLE');
    expect(v.ageMs).toBeNull();
  });

  it('saat GERİ sıçrarsa yaş 0’a kırpılır — ölçüm geçersiz SAYILMAZ', () => {
    const v = classifyFreshness({
      hasValue: true, measuredAtMs: T0 + 5_000, nowMs: T0, window: WIN,
    });
    expect(v.ageMs).toBe(0);
    expect(v.state).toBe('LIVE');
  });
});

/* ── F3 · Reconnect kapısı ────────────────────────────────────────────────── */

describe('P0-OBD-02 · F3 oturum değişince eski ölçüm CANLI SAYILMAZ', () => {
  it('epoch farklıysa yaş 0 olsa bile UNAVAILABLE', () => {
    const v = classifyFreshness({
      hasValue: true, measuredAtMs: T0, nowMs: T0, window: WIN,
      valueEpoch: 1, currentEpoch: 2,
    });
    expect(v.state).toBe('UNAVAILABLE');
    expect(v.reason).toBe('session_changed');
    expect(v.ageMs).toBeNull();   // yaş anlamsız → UYDURULMAZ
  });

  it('epoch aynıysa normal yaş kuralı işler', () => {
    const v = classifyFreshness({
      hasValue: true, measuredAtMs: T0, nowMs: T0 + 1_000, window: WIN,
      valueEpoch: 3, currentEpoch: 3,
    });
    expect(v.state).toBe('LIVE');
  });

  it('epoch bilinmiyorsa kapı UYGULANMAZ (çağıran bildirmedi)', () => {
    const v = classifyFreshness({
      hasValue: true, measuredAtMs: T0, nowMs: T0, window: WIN,
      valueEpoch: null, currentEpoch: null,
    });
    expect(v.state).toBe('LIVE');
  });
});

describe('P0-OBD-02 · F3 extendedPidService reconnect önbelleğini DÜŞÜRÜR', () => {
  beforeEach(() => extInternals.reset());

  it('yeniden bağlanmada önceki oturumun DEĞERLERİ silinir', () => {
    // Bir izleyici kur (keşif/native yolu jsdom'da no-op) ve değer geldiğini simüle et.
    watchPid('5C', () => { /* değer _values'e yazılır */ });
    extInternals.onExtendedData({ pid: '5C', data: '82' });   // 0x82-40 = 90 °C
    expect(getPidStatus('5C')).toBe('live');

    notifyObdConnected();

    /* KRİTİK: değer artık YOK. Eskiden `_values` dokunulmadan kalıyor ve
       `getPidStatus` 15 sn boyunca "live" diyordu — KOPMUŞ bir hattan. */
    expect(getPidStatus('5C')).not.toBe('live');
  });

  it('reconnect sonrası izleyici ÖNBELLEKTEN eski değer ALMAZ', () => {
    watchPid('5C', () => { /* ilk izleyici */ });
    extInternals.onExtendedData({ pid: '5C', data: '82' });
    notifyObdConnected();

    const seen: number[] = [];
    watchPid('5C', (v) => seen.push(v.value));
    // Eskiden burada önceki oturumun 90 °C'si ANINDA yayılıyordu.
    expect(seen).toEqual([]);
  });
});

/* ── F4 · Negatif sıcaklıklar körlemesine ELENMEZ ─────────────────────────── */

describe('P0-OBD-02 · F4 fiziksel bant, körlemesine negatif eleme DEĞİL', () => {
  const ambient = CANONICAL_OBD_BY_KEY.get('ambientTemp')!;
  const intake  = CANONICAL_OBD_BY_KEY.get('intakeTemp')!;
  const coolant = CANONICAL_OBD_BY_KEY.get('coolantTemp')!;
  const throttle = CANONICAL_OBD_BY_KEY.get('throttle')!;
  const volt    = CANONICAL_OBD_BY_KEY.get('moduleVoltage')!;

  it('GERÇEK negatif sıcaklık artık KABUL EDİLİR (soğuk iklim kusuru kapandı)', () => {
    expect(acceptCanonicalValue(ambient, -12)).toBe(-12);
    expect(acceptCanonicalValue(intake, -8)).toBe(-8);
    expect(acceptCanonicalValue(coolant, -5)).toBe(-5);
  });

  it('`-1` sentinel’i hâlâ ELENİR (TAM DEĞER kıyası)', () => {
    expect(acceptCanonicalValue(ambient, -1)).toBeNull();
    expect(acceptCanonicalValue(coolant, -1)).toBeNull();
    // Komşu değerler GEÇER — kör nokta 41 °C değil, 1 °C.
    expect(acceptCanonicalValue(ambient, -2)).toBe(-2);
    expect(acceptCanonicalValue(ambient, 0)).toBe(0);
  });

  it('bandı 0’dan başlayan sinyalde `-1` zaten bant dışıdır (ayrı kural GEREKMEZ)', () => {
    expect(throttle.minusOneIsSentinel).toBe(false);
    expect(acceptCanonicalValue(throttle, -1)).toBeNull();
    expect(acceptCanonicalValue(throttle, 0)).toBe(0);      // gerçek 0 % KABUL
  });

  it('FİZİKSEL bant, formülün teorik bandından DAR olabilir (adaptör glitch kapısı)', () => {
    // Registry 0x42 için 0–65,535 V der; akü kararı için 6–18 V dışı ÖLÇÜM DEĞİLDİR.
    expect(acceptCanonicalValue(volt, 13.8)).toBe(13.8);
    expect(acceptCanonicalValue(volt, 0)).toBeNull();
    expect(acceptCanonicalValue(volt, 60)).toBeNull();
  });

  it('sonlu olmayan değer HER ZAMAN elenir', () => {
    expect(acceptCanonicalValue(coolant, Number.NaN)).toBeNull();
    expect(acceptCanonicalValue(coolant, Number.POSITIVE_INFINITY)).toBeNull();
    expect(acceptCanonicalValue(coolant, undefined)).toBeNull();
    expect(acceptCanonicalValue(coolant, null)).toBeNull();
  });

  it('gerçek 0 ölçümü ile "veri yok" AYRIDIR — 0 kabul edilir', () => {
    expect(acceptCanonicalValue(throttle, 0)).toBe(0);
    expect(acceptCanonicalValue(coolant, 0)).toBe(0);
  });

  it('sentinel bayrağı YALNIZ bandı negatife uzanan sinyallerde açıktır', () => {
    for (const d of CANONICAL_OBD_SIGNALS) {
      if (d.minusOneIsSentinel) {
        expect(d.physMin, `${d.key}: sentinel gereksiz (bant zaten 0+)`).toBeLessThan(-1);
      }
    }
  });
});
