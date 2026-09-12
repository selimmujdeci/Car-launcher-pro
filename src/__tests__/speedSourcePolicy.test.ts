/**
 * speedSourcePolicy.test.ts — "OBD bağlıysa OBD, yoksa GPS" kuralının kilidi.
 *
 * SAHA (2026-08-12, kullanıcı): *"OBD bağlı olduğunda OBD hız verisi
 * kullanılacak, yoksa GPS — şimdi sadece GPS kullanıyor."*
 *
 * KÖK (ölçüldü): karar bir YARIŞTI — `confidence × tazelik`. OBD kadansı sahada
 * ~4,3 s (bkz. `obdCadenceGate` başlığı: 102 olay / 438 s), GPS 1 Hz. OBD skoru
 * paketler ARASINDA düşüp GPS'in altına iniyordu → araç OBD'ye bağlıyken bile
 * hız GPS'ten geliyor ve kaynak saniyeler içinde gidip geliyordu.
 *
 * Bu dosya kuralın KENDİSİNİ (öncelik) ve güvenlik sınırını (tazelik) kilitler.
 */
import { describe, it, expect } from 'vitest';
import {
  isSpeedSourceUsable,
  pickSpeedSource,
  SPEED_SOURCE_PRIORITY,
} from '../platform/vehicleDataLayer/speedSourcePolicy';
import {
  OBD_TIMEOUT_FLOOR_MS,
  OBD_TIMEOUT_CEIL_MS,
  createObdCadenceGate,
} from '../platform/vehicleDataLayer/obdCadenceGate';

/* Sahada ölçülen değerler — UYDURULMADI (obdCadenceGate başlığındaki snapshot). */
const FIELD_OBD_CADENCE_MS = 4_300;   // 102 olay / 438 s
const GPS_TICK_MS          = 1_000;   // 1 Hz
const GPS_TIMEOUT_MS       = 5_000;   // SRC_TIMEOUT_GPS_MS
const CONF_OBD             = 0.85;
const CONF_GPS             = 0.70;

describe('speedSourcePolicy — öncelik sırası (yarış DEĞİL)', () => {
  it('sıra HAL > CAN > OBD > GPS; GPS DAİMA sonuncu', () => {
    expect(SPEED_SOURCE_PRIORITY).toEqual(['HAL', 'CAN', 'OBD', 'GPS']);
    /* GPS'in son olması pazarlıksız: aracın kendi ölçümü varken türev
       (Doppler) ölçüme düşülmez. */
    expect(SPEED_SOURCE_PRIORITY[SPEED_SOURCE_PRIORITY.length - 1]).toBe('GPS');
  });

  it('⭐ OBD uygunsa GPS de uygun olsa bile OBD kazanır (kullanıcı kuralı)', () => {
    expect(pickSpeedSource(false, false, true, true)).toBe('OBD');
  });

  it('OBD uygun DEĞİLSE GPS kazanır', () => {
    expect(pickSpeedSource(false, false, false, true)).toBe('GPS');
  });

  it('donanım hiyerarşisi korunur', () => {
    expect(pickSpeedSource(true,  true,  true,  true)).toBe('HAL');
    expect(pickSpeedSource(false, true,  true,  true)).toBe('CAN');
  });

  it('hiçbiri uygun değilse `null` — sahte 0 ÜRETİLMEZ', () => {
    expect(pickSpeedSource(false, false, false, false)).toBeNull();
  });

  it('karar YALNIZ uygunluğa bakar — çağıran sırası/skoru değiştiremez', () => {
    /* Aynı girdi daima aynı çıktı: kaynak titremesinin yapısal olarak
       imkânsız olmasının sebebi budur. */
    for (let i = 0; i < 5; i++) {
      expect(pickSpeedSource(false, false, true, true)).toBe('OBD');
    }
  });
});

describe('speedSourcePolicy — uygunluk (tazelik güvenlik sınırı)', () => {
  it('yok / güvensiz / bayat sinyal sıraya GİRMEZ', () => {
    expect(isSpeedSourceUsable(false, 0.85, 0, 5_000)).toBe(false);   // sinyal yok
    expect(isSpeedSourceUsable(true,  0,    0, 5_000)).toBe(false);   // güven 0
    expect(isSpeedSourceUsable(true,  0.85, 6_000, 5_000)).toBe(false); // bayat
  });

  it('tam eşikte sinyal BAYATTIR (katı karşılaştırma)', () => {
    expect(isSpeedSourceUsable(true, 0.85, 4_999, 5_000)).toBe(true);
    expect(isSpeedSourceUsable(true, 0.85, 5_000, 5_000)).toBe(false);
  });

  it('bozuk sayı (NaN/negatif) fail-closed', () => {
    expect(isSpeedSourceUsable(true, Number.NaN, 0, 5_000)).toBe(false);
    expect(isSpeedSourceUsable(true, 0.85, Number.NaN, 5_000)).toBe(false);
    expect(isSpeedSourceUsable(true, 0.85, -1, 5_000)).toBe(false);
    expect(isSpeedSourceUsable(true, 0.85, 0, 0)).toBe(false);
  });
});

describe('⭐ SAHA SENARYOSU — ölçülen kadanslarla eski yarış vs yeni öncelik', () => {
  /** Eski karar: `confidence × (1 − yaş/eşik)` skoru; büyük olan kazanır. */
  const oldRace = (obdAgeMs: number, obdTimeout: number, gpsAgeMs: number): 'OBD' | 'GPS' => {
    const cOBD = CONF_OBD * Math.max(0, 1 - obdAgeMs / obdTimeout);
    const cGPS = CONF_GPS * Math.max(0, 1 - gpsAgeMs / GPS_TIMEOUT_MS);
    return cOBD >= cGPS ? 'OBD' : 'GPS';
  };

  /** Sahada öğrenilen OBD eşiği — sabit değil, kadanstan türer. */
  const learnedObdTimeout = (): number => {
    const gate = createObdCadenceGate();
    for (let i = 0; i < 30; i++) gate.observe(FIELD_OBD_CADENCE_MS);
    return gate.timeoutMs();
  };

  it('öğrenilen eşik ölçülen kadansla tutarlı (taban/tavan arasında)', () => {
    const t = learnedObdTimeout();
    expect(t).toBeGreaterThan(OBD_TIMEOUT_FLOOR_MS);
    expect(t).toBeLessThanOrEqual(OBD_TIMEOUT_CEIL_MS);
    /* GAP_FACTOR = 2, ama sönüm (DECAY 0,97) sabit kadansta tepeyi 4300 ↔ 4171
       arasında salındırır → eşik 2× kadansın biraz ALTINDA oturur. Ölçülen
       davranış budur; "tam 2×" beklemek sönümü yok saymak olurdu. */
    expect(t).toBeGreaterThan(FIELD_OBD_CADENCE_MS * 1.9);
    expect(t).toBeLessThanOrEqual(FIELD_OBD_CADENCE_MS * 2);
  });

  it('ESKİ yarış: OBD bağlı ve TAZE olmasına rağmen zamanın çoğunda GPS kazanıyordu', () => {
    const obdTimeout = learnedObdTimeout();
    let gpsWins = 0, total = 0;
    /* OBD paketleri arasındaki tüm GPS tiklerini tara (kusurun mekaniği). */
    for (let obdAge = 0; obdAge < FIELD_OBD_CADENCE_MS; obdAge += GPS_TICK_MS) {
      const gpsAge = obdAge % GPS_TICK_MS;   // GPS her saniye tazelenir
      total++;
      if (oldRace(obdAge, obdTimeout, gpsAge) === 'GPS') gpsWins++;
    }
    /* Kullanıcının gördüğü buydu: "şimdi sadece GPS kullanıyor". */
    expect(gpsWins).toBeGreaterThan(0);
    expect(gpsWins / total).toBeGreaterThanOrEqual(0.5);
  });

  it('⭐ YENİ öncelik: OBD TAZE olduğu SÜRECE her ölçümde OBD kazanır', () => {
    const obdTimeout = learnedObdTimeout();
    for (let obdAge = 0; obdAge < obdTimeout; obdAge += 250) {
      const obdOk = isSpeedSourceUsable(true, CONF_OBD, obdAge, obdTimeout);
      const gpsOk = isSpeedSourceUsable(true, CONF_GPS, 0, GPS_TIMEOUT_MS);
      expect(obdOk, `OBD yaş ${obdAge} ms`).toBe(true);
      expect(pickSpeedSource(false, false, obdOk, gpsOk), `OBD yaş ${obdAge} ms`).toBe('OBD');
    }
  });

  it('⭐ OBD BAYATLAYINCA (kopma) devir GPS\'e geçer — körlük YOK', () => {
    const obdTimeout = learnedObdTimeout();
    const obdOk = isSpeedSourceUsable(true, CONF_OBD, obdTimeout + 1, obdTimeout);
    const gpsOk = isSpeedSourceUsable(true, CONF_GPS, 0, GPS_TIMEOUT_MS);
    expect(obdOk).toBe(false);
    expect(pickSpeedSource(false, false, obdOk, gpsOk)).toBe('GPS');
  });

  it('OBD hiç yokken (dongle bağlı değil) GPS tek kaynaktır', () => {
    const obdOk = isSpeedSourceUsable(false, 0, 0, OBD_TIMEOUT_FLOOR_MS);
    const gpsOk = isSpeedSourceUsable(true, CONF_GPS, 500, GPS_TIMEOUT_MS);
    expect(pickSpeedSource(false, false, obdOk, gpsOk)).toBe('GPS');
  });

  it('güvenlik kapısı OBD\'yi elerse (çelişki) GPS kazanır — kapı ÖNCELİĞİ EZER', () => {
    /* `_hwSpeedContradicted`: donanım "0" derken GPS hareket + motor dönüyor.
       Worker bunu `okOBD=false` olarak yansıtır; politika elenmişi ATLAR. */
    expect(pickSpeedSource(false, false, /* elendi */ false, true)).toBe('GPS');
  });
});
