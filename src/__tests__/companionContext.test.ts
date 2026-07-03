/**
 * companionContext.test.ts — "Yol Arkadaşım" yorumlayıcı testleri (Commit 2).
 *
 * Kapsam:
 *  - yakıt→menzil cümlesi sınır değerleri (mimari §10 test planı)
 *  - imkânsız sensör verisi reddi (NaN, negatif, aralık dışı → null)
 *  - mola eşiği kararı (eşik altı → null = sus)
 *  - Türkçe ek uyumu (saattir / dakikadır)
 *  - determinizm + ISO 15008 cümle uzunluğu
 *  - modül saflığı (servis import'u YOK — kaynak sözleşmesi)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  interpretTimeOfDay,
  formatDurationTr,
  approxRangeKm,
  interpretFuel,
  interpretRange,
  interpretBatteryCharge,
  interpretTripDuration,
  interpretBreakNeed,
  interpretFatigue,
  interpretArrival,
  interpretEngineTempConcern,
  interpretDoorAjar,
  interpretTirePressure,
  interpretVisibilityLights,
  interpretRangeVsRoute,
} from '../platform/companion/companionContext';

/* ── 1. interpretTimeOfDay ──────────────────────────────────── */

describe('interpretTimeOfDay — günün dilimi sınırları', () => {
  it.each([
    [5, 'sabah'], [10, 'sabah'],
    [11, 'ogle'], [16, 'ogle'],
    [17, 'aksam'], [21, 'aksam'],
    [22, 'gece'], [23, 'gece'], [0, 'gece'], [4, 'gece'],
  ] as const)('saat %i → %s', (hour, expected) => {
    expect(interpretTimeOfDay(hour)).toBe(expected);
  });

  it('geçersiz saat → gece (fail-safe: en temkinli dilim)', () => {
    expect(interpretTimeOfDay(NaN)).toBe('gece');
    expect(interpretTimeOfDay(-1)).toBe('gece');
    expect(interpretTimeOfDay(25)).toBe('gece');
  });
});

/* ── 2. formatDurationTr ────────────────────────────────────── */

describe('formatDurationTr', () => {
  it('dakika / saat / karışık biçimler', () => {
    expect(formatDurationTr(0)).toBe('bir dakikadan az');
    expect(formatDurationTr(45)).toBe('45 dakika');
    expect(formatDurationTr(60)).toBe('1 saat');
    expect(formatDurationTr(120)).toBe('2 saat');
    expect(formatDurationTr(135)).toBe('2 saat 15 dakika');
  });

  it('küsurat yuvarlanır (59.6 → 1 saat)', () => {
    expect(formatDurationTr(59.6)).toBe('1 saat');
  });

  it('geçersiz değer → null', () => {
    expect(formatDurationTr(NaN)).toBeNull();
    expect(formatDurationTr(-5)).toBeNull();
    expect(formatDurationTr(Infinity)).toBeNull();
  });
});

/* ── 3. approxRangeKm ───────────────────────────────────────── */

describe('approxRangeKm — sahte hassasiyet törpüleme', () => {
  it('100 altı 10\'a, üstü 50\'ye yuvarlanır', () => {
    expect(approxRangeKm(143)).toBe(150);
    expect(approxRangeKm(96)).toBe(100);
    expect(approxRangeKm(47)).toBe(50);
    expect(approxRangeKm(333)).toBe(350);
    expect(approxRangeKm(0)).toBe(0);
  });

  it('imkânsız menzil → null', () => {
    expect(approxRangeKm(2001)).toBeNull();
    expect(approxRangeKm(-1)).toBeNull();
    expect(approxRangeKm(NaN)).toBeNull();
  });
});

/* ── 4. interpretFuel — sınır değerleri ─────────────────────── */

describe('interpretFuel', () => {
  it('kritik (<10): benzinlik aciliyeti', () => {
    const r = interpretFuel(8);
    expect(r).toContain('kritik');
    expect(r).toContain('yüzde 8');
    expect(r).toContain('benzinliğe');
  });

  it('az (10-24): doldurma önerisi', () => {
    const r = interpretFuel(23);
    expect(r).toContain('azalıyor');
    expect(r).toContain('yüzde 23');
  });

  it('normal (≥25): durum iyi', () => {
    const r = interpretFuel(80);
    expect(r).toContain('yüzde 80');
    expect(r).toContain('iyi');
  });

  it('menzil verilirse yorumlu menzil cümleye girer (143 → ~150)', () => {
    const r = interpretFuel(23, 143);
    expect(r).toContain('150 kilometre');
  });

  it('imkânsız menzil cümleye GİRMEZ ama yakıt yorumu üretilir', () => {
    const r = interpretFuel(50, 9999);
    expect(r).toBeTruthy();
    expect(r).not.toContain('9999');
    expect(r).not.toContain('kilometre');
  });

  it('sınır: tam 10 ve tam 25', () => {
    expect(interpretFuel(10)).toContain('azalıyor');
    expect(interpretFuel(25)).toContain('iyi');
  });

  it('imkânsız yakıt verisi → null (OBD yok = sus)', () => {
    expect(interpretFuel(NaN)).toBeNull();
    expect(interpretFuel(-1)).toBeNull();
    expect(interpretFuel(101)).toBeNull();
  });
});

/* ── 5. interpretRange ──────────────────────────────────────── */

describe('interpretRange', () => {
  it('normal menzil', () => {
    expect(interpretRange(143)).toContain('150 kilometre');
  });

  it('düşük menzil (<50) aciliyet ekler', () => {
    expect(interpretRange(40)).toContain('benzinliğe');
  });

  it('sıfıra yuvarlanan menzil → "neredeyse bitti"', () => {
    expect(interpretRange(4)).toContain('neredeyse bitti');
    expect(interpretRange(0)).toContain('neredeyse bitti');
  });

  it('geçersiz → null', () => {
    expect(interpretRange(NaN)).toBeNull();
    expect(interpretRange(2500)).toBeNull();
  });
});

/* ── 5b. interpretBatteryCharge — EV/hibrit enerji bağlamı ──── */

describe('interpretBatteryCharge', () => {
  it('normal şarj → "durum iyi"', () => {
    const r = interpretBatteryCharge(80);
    expect(r).toContain('yüzde 80');
    expect(r).toContain('durum iyi');
  });

  it('az şarj eşiği EV\'de erken (%20 altı)', () => {
    expect(interpretBatteryCharge(18)).toContain('azalıyor');
    // %25 EV\'de hâlâ "iyi" (benzinden farklı eşik)
    expect(interpretBatteryCharge(25)).toContain('durum iyi');
  });

  it('kritik şarj (%10 altı)', () => {
    expect(interpretBatteryCharge(8)).toContain('kritik');
  });

  it('düşük menzilde proaktif ŞARJ İSTASYONU teklifi (benzinlik değil)', () => {
    const r = interpretBatteryCharge(15, 60);
    expect(r).toContain('şarj istasyonu');
    expect(r).not.toContain('benzin');
  });

  it('şarj oluyorsa uyarı değil GÜVEN verir', () => {
    const r = interpretBatteryCharge(15, 60, true);
    expect(r).toContain('Şarj oluyoruz');
    expect(r).not.toContain('kritik');
  });

  it('şarjda neredeyse dolu → "az sonra hazırız"', () => {
    expect(interpretBatteryCharge(97, undefined, true)).toContain('az sonra hazırız');
  });

  it('geçersiz/ICE (batteryLevel=-1) → null (sus)', () => {
    expect(interpretBatteryCharge(-1)).toBeNull();
    expect(interpretBatteryCharge(NaN)).toBeNull();
    expect(interpretBatteryCharge(101)).toBeNull();
  });
});

/* ── 6. interpretTripDuration — Türkçe ek uyumu ─────────────── */

describe('interpretTripDuration', () => {
  it('tam saat → "saattir" (ünsüz uyumu)', () => {
    expect(interpretTripDuration(120)).toBe('2 saattir yoldayız.');
  });

  it('dakika biten süre → "dakikadır"', () => {
    expect(interpretTripDuration(135)).toContain('2 saat 15 dakikadır yoldayız');
    expect(interpretTripDuration(45)).toContain('45 dakikadır yoldayız');
  });

  it('mesafe varsa cümleye eklenir', () => {
    expect(interpretTripDuration(135, 110)).toContain('110 kilometre yol yaptık');
  });

  it('1 km altı / geçersiz mesafe cümleye girmez', () => {
    expect(interpretTripDuration(45, 0.4)).not.toContain('kilometre');
    expect(interpretTripDuration(45, NaN)).not.toContain('kilometre');
  });

  it('1 dakikadan kısa → "Daha yeni yola çıktık."', () => {
    expect(interpretTripDuration(0.3)).toBe('Daha yeni yola çıktık.');
  });

  it('48 saat üstü / geçersiz süre → null (veri bozulması)', () => {
    expect(interpretTripDuration(48 * 60 + 1)).toBeNull();
    expect(interpretTripDuration(NaN)).toBeNull();
    expect(interpretTripDuration(-10)).toBeNull();
  });
});

/* ── 7. interpretBreakNeed — eşik kararı ────────────────────── */

describe('interpretBreakNeed', () => {
  it('eşik altı → null (KONUŞMA — scheduler tetiklemez)', () => {
    expect(interpretBreakNeed(119, 120)).toBeNull();
    expect(interpretBreakNeed(0, 120)).toBeNull();
  });

  it('eşik tam dolunca cümle üretir', () => {
    const r = interpretBreakNeed(120, 120);
    expect(r).toContain('2 saattir molasız');
    expect(r).toContain('mola');
  });

  it('eşik aşımı', () => {
    expect(interpretBreakNeed(200, 120)).toContain('3 saat 20 dakikadır molasız');
  });

  it('30 dk altı interval geçersiz konfig → null', () => {
    expect(interpretBreakNeed(100, 29)).toBeNull();
    expect(interpretBreakNeed(100, 0)).toBeNull();
  });

  it('bozuk girdi → null', () => {
    expect(interpretBreakNeed(NaN, 120)).toBeNull();
    expect(interpretBreakNeed(-5, 120)).toBeNull();
    expect(interpretBreakNeed(5000, 120)).toBeNull();
  });
});

/* ── 8. interpretFatigue ────────────────────────────────────── */

describe('interpretFatigue', () => {
  it('gece + uzun yol (≥2 saat) → dinlenme noktası önerisi', () => {
    const r = interpretFatigue(150, true);
    expect(r).toContain('Gece');
    expect(r).toContain('mola');
  });

  it('gece + kısa yol → gece uyarısı', () => {
    expect(interpretFatigue(30, true)).toContain('Gece sürüşü');
  });

  it('gündüz + uzun yol → mola önerisi', () => {
    expect(interpretFatigue(150, false)).toContain('mola');
  });

  it('gündüz + kısa yol → hafif öneri (her zaman cevap var)', () => {
    expect(interpretFatigue(20, false)).toBeTruthy();
  });

  it('bozuk süre → null', () => {
    expect(interpretFatigue(NaN, false)).toBeNull();
    expect(interpretFatigue(-1, true)).toBeNull();
  });
});

/* ── 9. interpretArrival ────────────────────────────────────── */

describe('interpretArrival', () => {
  it('500 m altı → "neredeyse geldik"', () => {
    expect(interpretArrival(300, 60)).toContain('Neredeyse geldik');
  });

  it('kısa ETA (≤10 dk): "9 dakika kaldı — 5 kilometre"', () => {
    const r = interpretArrival(5000, 540);
    expect(r).toContain('9 dakika');
    expect(r).toContain('5 kilometre');
  });

  it('10 km altı mesafe ondalıklı söylenir — TTS için virgül (7,5 kilometre)', () => {
    expect(interpretArrival(7500, 700)).toContain('7,5 kilometre');
  });

  it('uzun ETA: saat biçimi + yuvarlak km', () => {
    const r = interpretArrival(50_000, 3600);
    expect(r).toContain('1 saat');
    expect(r).toContain('50 kilometre');
  });

  it('rota yok / bozuk veri → null', () => {
    expect(interpretArrival(0, 0)).toBeNull();
    expect(interpretArrival(NaN, 100)).toBeNull();
    expect(interpretArrival(1000, NaN)).toBeNull();
    expect(interpretArrival(6_000_000, 100)).toBeNull();  // >5000 km
    expect(interpretArrival(1000, 90_000)).toBeNull();    // >24 saat
  });
});

/* ── 10. interpretEngineTempConcern ─────────────────────────── */

describe('interpretEngineTempConcern — yalnız konuşmaya değer durumlar', () => {
  it('normal aralık (50-105) → null (sus)', () => {
    expect(interpretEngineTempConcern(90)).toBeNull();
    expect(interpretEngineTempConcern(50)).toBeNull();
    expect(interpretEngineTempConcern(105)).toBeNull();
  });

  it('aşırı ısınma (>105) → durma önerisi', () => {
    expect(interpretEngineTempConcern(110)).toContain('durup kontrol');
  });

  it('soğuk motor (<50) → yumuşak sürüş önerisi', () => {
    expect(interpretEngineTempConcern(35)).toContain('yumuşak');
  });

  it('sensör hatası (-40 altı / 200 üstü / NaN) → null', () => {
    expect(interpretEngineTempConcern(-50)).toBeNull();
    expect(interpretEngineTempConcern(250)).toBeNull();
    expect(interpretEngineTempConcern(NaN)).toBeNull();
  });
});

/* ── 10b. interpretDoorAjar — kapı/bagaj açık ───────────────── */

describe('interpretDoorAjar', () => {
  const shut = { fl: false, fr: false, rl: false, rr: false, trunk: false };

  it('hepsi kapalı → null (sus)', () => {
    expect(interpretDoorAjar(shut)).toBeNull();
  });

  it('tek kapı açık → o kapının adıyla uyarır', () => {
    expect(interpretDoorAjar({ ...shut, fl: true })).toContain('Sürücü kapısı');
    expect(interpretDoorAjar({ ...shut, fr: true })).toContain('Ön yolcu kapısı');
  });

  it('bagaj tekil özel ifade', () => {
    const r = interpretDoorAjar({ ...shut, trunk: true });
    expect(r).toContain('Bagaj');
    expect(r).toContain('kapanmamış');
  });

  it('birden fazla açık → "ve" ile listeler', () => {
    const r = interpretDoorAjar({ ...shut, fl: true, rr: true });
    expect(r).toContain('ve');
    expect(r).toContain('durup kapat');
  });

  it('undefined/sensör yok → null', () => {
    expect(interpretDoorAjar(undefined)).toBeNull();
    expect(interpretDoorAjar(null)).toBeNull();
    expect(interpretDoorAjar({})).toBeNull(); // hiç alan yok = kapalı say
  });
});

/* ── 10c. interpretTirePressure — TPMS düşük basınç ─────────── */

describe('interpretTirePressure', () => {
  const ok = { fl: 230, fr: 235, rl: 240, rr: 235 };

  it('hepsi normal → null', () => {
    expect(interpretTirePressure(ok)).toBeNull();
  });

  it('tek düşük lastik → konumuyla uyarır', () => {
    expect(interpretTirePressure({ ...ok, fr: 150 })).toContain('Sağ ön');
    expect(interpretTirePressure({ ...ok, rl: 120 })).toContain('Sol arka');
  });

  it('birden fazla düşük → liste + çoğul', () => {
    const r = interpretTirePressure({ fl: 160, fr: 150, rl: 240, rr: 235 });
    expect(r).toContain('ve');
    expect(r).toContain('lastiklerin');
  });

  it('imkânsız değer (0, NaN, >450) sensör yok sayılır → atlanır', () => {
    expect(interpretTirePressure({ fl: 0, fr: 235, rl: 240, rr: 235 })).toBeNull();
    expect(interpretTirePressure({ fl: NaN, fr: 235, rl: 240, rr: 235 })).toBeNull();
    expect(interpretTirePressure({ fl: 9999, fr: 235, rl: 240, rr: 235 })).toBeNull();
  });

  it('undefined → null', () => {
    expect(interpretTirePressure(undefined)).toBeNull();
    expect(interpretTirePressure(null)).toBeNull();
  });
});

/* ── 10d. interpretVisibilityLights — hava + far köprüsü ────── */

describe('interpretVisibilityLights', () => {
  it('yağmurda farlar kapalı/bilinmiyor → far SORUSU (iddia değil)', () => {
    const r = interpretVisibilityLights(61, false);
    expect(r).toContain('Yağmur başladı');
    expect(r).toContain('farların açık mı');
  });

  it('farlar BİLİNEN açıksa → null (hatırlatma yok)', () => {
    expect(interpretVisibilityLights(61, true)).toBeNull();
    expect(interpretVisibilityLights(45, true)).toBeNull();
  });

  it('sis → "Sis bastırdı", kar → "Kar başladı"', () => {
    expect(interpretVisibilityLights(48, false)).toContain('Sis bastırdı');
    expect(interpretVisibilityLights(73, false)).toContain('Kar başladı');
  });

  it('açık/bulutlu hava (görünürlük iyi) → null', () => {
    expect(interpretVisibilityLights(0, false)).toBeNull();  // açık
    expect(interpretVisibilityLights(2, false)).toBeNull();  // parçalı bulutlu
    expect(interpretVisibilityLights(3, false)).toBeNull();  // kapalı ama yağış yok
  });

  it('geçersiz kod → null', () => {
    expect(interpretVisibilityLights(-1, false)).toBeNull();
    expect(interpretVisibilityLights(NaN, false)).toBeNull();
  });
});

/* ── 10e. interpretRangeVsRoute — yakıt yeterlilik köprüsü ──── */

describe('interpretRangeVsRoute', () => {
  it('menzil yola yetmez → "yetmez" + benzinlik teklifi', () => {
    const r = interpretRangeVsRoute(180, 340, 'Ankara');
    expect(r).toContain('Ankara rotasında');
    expect(r).toContain('yetmez');
    expect(r).toContain('benzinlik');
  });

  it('sınırda (tampon <%15) → "sınırda"', () => {
    // menzil 360, yol 340 → 360 < 340*1.15(391) → sınırda
    expect(interpretRangeVsRoute(360, 340)).toContain('sınırda');
  });

  it('rahat yeter → kısa "rahatça yeter"', () => {
    expect(interpretRangeVsRoute(500, 200, 'İzmir')).toContain('rahatça yeter');
  });

  it('hedef adı yoksa "Rotanda" jenerik ifade', () => {
    const r = interpretRangeVsRoute(180, 340);
    expect(r).toContain('Rotanda');
    expect(r).not.toContain('undefined');
  });

  it('mesafeler yuvarlanır (sahte hassasiyet yok)', () => {
    const r = interpretRangeVsRoute(183, 337, 'Bursa');
    expect(r).toContain('340 kilometre');   // 337 → 340
    expect(r).toContain('180 kilometre');   // 183 → 180
  });

  it('neredeyse varış (<2km) → null (karşılaştırma anlamsız)', () => {
    expect(interpretRangeVsRoute(180, 1)).toBeNull();
  });

  it('imkânsız değer (menzil>2000, yol>5000, NaN, negatif) → null', () => {
    expect(interpretRangeVsRoute(3000, 340)).toBeNull();
    expect(interpretRangeVsRoute(180, 6000)).toBeNull();
    expect(interpretRangeVsRoute(NaN, 340)).toBeNull();
    expect(interpretRangeVsRoute(-1, 340)).toBeNull();
  });
});

/* ── 11. Yapısal garantiler ─────────────────────────────────── */

describe('yapısal garantiler', () => {
  it('determinizm — aynı girdi her zaman aynı çıktı (rastgelelik yok)', () => {
    for (let i = 0; i < 5; i++) {
      expect(interpretFuel(23, 143)).toBe(interpretFuel(23, 143));
      expect(interpretFatigue(150, true)).toBe(interpretFatigue(150, true));
      expect(interpretArrival(5000, 540)).toBe(interpretArrival(5000, 540));
    }
  });

  it('ISO 15008 — tüm yorumlar TTS için makul uzunlukta (<180 karakter)', () => {
    const outputs = [
      interpretFuel(8, 30), interpretFuel(23, 143), interpretFuel(80, 500),
      interpretRange(40), interpretRange(300),
      interpretTripDuration(135, 110),
      interpretBreakNeed(200, 120),
      interpretFatigue(150, true), interpretFatigue(20, false),
      interpretArrival(5000, 540), interpretArrival(50_000, 3600),
      interpretEngineTempConcern(110),
    ];
    for (const out of outputs) {
      expect(out).toBeTruthy();
      expect(out!.length).toBeLessThan(180);
    }
  });

  it('modül saflığı — companionContext servis import etmez (kaynak sözleşmesi)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'companion', 'companionContext.ts'), 'utf-8');
    // Hiç import yok — modül tamamen kendi başına saf fonksiyon koleksiyonu
    // (yorum satırlarındaki servis adları sayılmaz; gerçek import aranır)
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/from\s+['"].*(obdService|tripLogService|routingService)/);
  });
});
