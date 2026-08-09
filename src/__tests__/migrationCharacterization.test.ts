/**
 * migrationCharacterization.test.ts — ADR-286 Faz 0 · Adım 2
 * `fuelAdvisorService` · `maintenanceBrain` · `smartCardEngine` DAVRANIŞ DONDURMA.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── AMAÇ: DOĞRULUK DEĞİL, DEĞİŞMEZLİK ─────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu üç modül ADR-286 §6.1 ölçümünde **sıfır teste** sahipti ve göç sırasında
 * en riskli üçlü olarak işaretlendi (`fuelAdvisorService` ayrıca 6 ürün
 * dosyasıyla en çok bağımlıya sahip). Testsiz göç, sessiz davranış
 * değişikliğidir.
 *
 * ⚠️ **BU DOSYA DOĞRULUK İDDİA ETMEZ.** Bugün ne yapıyorlarsa onu kilitler —
 * yanlışını da. Şüpheli bulduğum davranışlara `⚠️ ŞÜPHELİ` notu düşüldü ve
 * kütüğe taşındı; düzeltme AYRI bir karardır. Bir kilit bilinçli değişiyorsa
 * GÜNCELLENİR, silinmez.
 *
 * ── KAPSAM DÜRÜSTLÜĞÜ ─────────────────────────────────────────────────────
 * `maintenanceBrain` iki SAF fonksiyon dışa verir → **tam davranış matrisi**
 * kurulabildi. `fuelAdvisorService` ve `smartCardEngine` iç mantıklarını dışa
 * vermez (yalnız `start`/`stop`); onlarda davranış değil **sözleşme** dondurulur:
 * yaşam döngüsü · zero-leak · karar eşikleri · durum şekli. Bu, iç mantığın
 * test edildiği anlamına GELMEZ ve öyle sunulmamalıdır.
 *
 * ── KIRILGANLIK KARARI (#484 dersi) ───────────────────────────────────────
 * Dinamik `import()` KULLANILMAZ. #484'te ölçüldü: `vi.resetModules()` +
 * dinamik import deseni, 490+ dosyalık takımda modül grafiği çözümlemesi
 * yüzünden rastgele zaman aşımına uğruyor. Burada yalnız statik import var.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  calcLifetimeWear, calcWearRate, getBrainState,
} from '../platform/diagnostic/maintenanceBrain';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SRC_BRAIN = read('src/platform/diagnostic/maintenanceBrain.ts');
const SRC_FUEL = read('src/platform/diagnostic/fuelAdvisorService.ts');
const SRC_CARD = read('src/platform/ai/smartCardEngine.ts');

/* ══════════════════════════════════════════════════════════════════════════
   1 · maintenanceBrain — SAF FONKSİYONLAR (tam davranış matrisi)
   ══════════════════════════════════════════════════════════════════════════ */

describe('1 · calcLifetimeWear — araç tipi ve motor hacmi çarpanları', () => {
  const BASE = 3_000_000;

  it('normal girdi: tip çarpanları bugünkü değerlerinde', () => {
    expect(calcLifetimeWear({ vehicleType: 'ev' } as never)).toBe(BASE * 2.0);
    expect(calcLifetimeWear({ vehicleType: 'phev' } as never)).toBe(BASE * 1.8);
    expect(calcLifetimeWear({ vehicleType: 'hybrid' } as never)).toBe(BASE * 1.5);
    expect(calcLifetimeWear({ vehicleType: 'diesel' } as never)).toBe(BASE * 1.3);
    expect(calcLifetimeWear({ vehicleType: 'gasoline' } as never)).toBe(BASE);
  });

  it('eksik/UNKNOWN alan: profil yoksa taban değer (çökmez)', () => {
    expect(calcLifetimeWear()).toBe(BASE);
    expect(calcLifetimeWear(undefined)).toBe(BASE);
    expect(calcLifetimeWear({} as never)).toBe(BASE);
    // Tanınmayan tip → çarpan 1.0 (fail-soft; sessizce yüksek ömür VERMEZ)
    expect(calcLifetimeWear({ vehicleType: 'roket' } as never)).toBe(BASE);
  });

  it('sınır değerler: hacim eşikleri 1.0 / 2.0 / 3.0 L', () => {
    const g = (L: number) => calcLifetimeWear({ vehicleType: 'gasoline', engineCapacityL: L } as never);
    expect(g(0.9)).toBe(Math.round(BASE * 0.85));
    expect(g(1.0)).toBe(BASE);                    // tam 1.0 → 1.00 kademesi
    expect(g(1.9)).toBe(BASE);
    expect(g(2.0)).toBe(Math.round(BASE * 1.15)); // tam 2.0 → üst kademe
    expect(g(2.9)).toBe(Math.round(BASE * 1.15));
    expect(g(3.0)).toBe(Math.round(BASE * 1.25)); // tam 3.0 → üst kademe
  });

  it('çelişkili girdi: EV + motor hacmi → hacim YOK SAYILIR', () => {
    // EV'de motor hacmi anlamsızdır; kod bunu bilerek yok sayar.
    expect(calcLifetimeWear({ vehicleType: 'ev', engineCapacityL: 5.0 } as never))
      .toBe(BASE * 2.0);
  });

  it('bozuk girdi: sıfır/negatif hacim çarpanı ETKİLEMEZ', () => {
    const g = (L: number) => calcLifetimeWear({ vehicleType: 'gasoline', engineCapacityL: L } as never);
    expect(g(0)).toBe(BASE);
    expect(g(-3)).toBe(BASE);
  });
});

describe('2 · calcWearRate — anlık stres (0..1)', () => {
  /* Varsayılanlar: idle 700 · max 6000 · normalTemp 90 */

  it('normal girdi: rölanti + normal sıcaklık + gaz yok → stres ~0', () => {
    expect(calcWearRate(700, 90, 0)).toBe(0);
  });

  it('normal girdi: ağırlıklar 0.40 RPM · 0.35 yük · 0.25 termik', () => {
    // Tam gaz + redline + normal sıcaklık → 0.40 + 0.35 = 0.75
    expect(calcWearRate(6000, 90, 100)).toBeCloseTo(0.75, 5);
    // Yalnız RPM tavanda → 0.40
    expect(calcWearRate(6000, 90, 0)).toBeCloseTo(0.40, 5);
    // Yalnız yük tavanda → 0.35
    expect(calcWearRate(700, 90, 100)).toBeCloseTo(0.35, 5);
  });

  it('sınır değerler: sonuç HER ZAMAN 0..1 aralığında kalır', () => {
    for (const [rpm, temp, thr] of [
      [-9999, -100, -100], [99999, 500, 999], [0, 0, 0], [6000, 200, 100],
    ] as const) {
      const v = calcWearRate(rpm, temp, thr);
      expect(v, `rpm=${rpm} temp=${temp} thr=${thr}`).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('termik: soğuk motor SABİT 0.15 ceza alır', () => {
    // normalTemp-30 = 60°C altı → 0.15 (kademeli DEĞİL, sabit)
    expect(calcWearRate(700, 59, 0)).toBeCloseTo(0.15 * 0.25, 5);
    expect(calcWearRate(700, -40, 0)).toBeCloseTo(0.15 * 0.25, 5);
    // Tam eşikte (60°C) ceza YOK — `<` operatörü `<=`ye kayarsa burada yakalanır
    expect(calcWearRate(700, 60, 0)).toBe(0);
  });

  it('⚠️ YER TUTUCU · termik artış LİNEER — eğri doğrulanmadı (#498)', () => {
    /*
     * Kod her zaman lineerdi: clamp((temp - hotThreshold) / 30, 0, 1).
     * Kaynak yorumu eskiden "üstel artış" diyordu; belge ile davranış
     * AYRIŞMIŞTI. Bu test lineerliği ölçtü, yorum gerçeğe hizalandı (#498) ve
     * DAVRANIŞ BİLİNÇLİ OLARAK DEĞİŞTİRİLMEDİ: üstele geçmek bir tahmin değil
     * ÖLÇÜM kararıdır — gerçek termik aşınma verisi toplanana kadar lineer kalır.
     * Aşağıdaki eşit aralıklar EŞİT artış üretir; lineerliğin kanıtı budur.
     */
    const t = (temp: number) => calcWearRate(700, temp, 0) / 0.25;   // termik payı
    const d1 = t(110) - t(100);
    const d2 = t(120) - t(110);
    expect(d1).toBeCloseTo(d2, 5);          // eşit artış = LİNEER
    expect(t(100)).toBeCloseTo(0, 5);       // hotThreshold = 100 °C
    expect(t(130)).toBeCloseTo(1, 5);       // +30 °C sonra tavan
  });

  it('eksik alan: throttle < 0 ise RPM\'den tahmin edilir (0.55 katsayı)', () => {
    // Yük ölçülemiyorsa uydurulmaz, RPM'den TÜRETİLİR ve düşük tutulur.
    const withThrottle = calcWearRate(6000, 90, 0);      // yük = 0
    const derived = calcWearRate(6000, 90, -1);          // yük = rpmStress*0.55
    expect(derived).toBeGreaterThan(withThrottle);
    expect(derived).toBeCloseTo(0.40 + (1 * 0.55) * 0.35, 5);
  });

  it('profil geçersizse varsayılanlara düşer (0 / negatif / eksik)', () => {
    const base = calcWearRate(3000, 90, 50);
    for (const p of [
      undefined, {}, { idleRpm: 0, maxRpm: 0, normalTemp: 0 },
      { idleRpm: -5, maxRpm: -5, normalTemp: -5 },
    ]) {
      expect(calcWearRate(3000, 90, 50, p as never)).toBe(base);
    }
  });

  it('profil geçerliyse eşikler profilden okunur', () => {
    // Dizel: idle 800, max 4500 → aynı RPM daha yüksek stres üretir
    const stock = calcWearRate(3000, 90, 0);
    const diesel = calcWearRate(3000, 90, 0,
      { idleRpm: 800, maxRpm: 4500, normalTemp: 90 } as never);
    expect(diesel).toBeGreaterThan(stock);
  });

  it('çelişkili girdi: RPM rölanti altında → negatife düşmez', () => {
    expect(calcWearRate(100, 90, 0)).toBe(0);
  });
});

describe('3 · maintenanceBrain — durum sözleşmesi', () => {
  it('getBrainState beş alanı da taşır ve KOPYA döner', () => {
    const s = getBrainState();
    expect(Object.keys(s).sort()).toEqual(
      ['cumulativeWear', 'healthScore', 'lifetimeWear', 'oilLife', 'wearRate']);
    // Kopya olmalı: dışarıdan mutasyon iç durumu bozmamalı.
    (s as { healthScore: number }).healthScore = -999;
    expect(getBrainState().healthScore).not.toBe(-999);
  });

  it('durum alanları sayısal ve sonlu (sahte değer yok)', () => {
    const s = getBrainState();
    for (const [k, v] of Object.entries(s)) {
      expect(Number.isFinite(v), `${k} sonlu değil`).toBe(true);
    }
    expect(s.healthScore).toBeGreaterThanOrEqual(0);
    expect(s.healthScore).toBeLessThanOrEqual(100);
    expect(s.wearRate).toBeGreaterThanOrEqual(0);
    expect(s.wearRate).toBeLessThanOrEqual(1);
  });

  it('sabitler bugünkü değerlerinde (göçte sessizce kaymasın)', () => {
    expect(SRC_BRAIN).toMatch(/BASE_LIFETIME_WEAR\s*=\s*3_000_000/);
    expect(SRC_BRAIN).toMatch(/DEFAULT_MAX_RPM\s*=\s*6_000/);
    expect(SRC_BRAIN).toMatch(/DEFAULT_IDLE_RPM\s*=\s*700/);
    expect(SRC_BRAIN).toMatch(/DEFAULT_NORM_TEMP\s*=\s*90/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · fuelAdvisorService — SÖZLEŞME (iç mantık dışa verilmiyor)
   ══════════════════════════════════════════════════════════════════════════ */

describe('4 · fuelAdvisorService — sözleşme dondurma', () => {
  it('start CLEANUP döndürür — zero-leak sözleşmesi', () => {
    expect(SRC_FUEL).toMatch(/export function startFuelAdvisor\(\):\s*\(\)\s*=>\s*void/);
    expect(SRC_FUEL).toContain('export function stopFuelAdvisor');
  });

  it('ağ çağrısının zaman aşımı VARDIR (askıda kalmaz)', () => {
    // Overpass sorgusu sınırsız beklerse kart sonsuza kadar boş kalırdı.
    expect(SRC_FUEL).toMatch(/OVERPASS_TIMEOUT_S\s*=\s*10/);
  });

  it('mesafe hesabı haversine — düz fark DEĞİL', () => {
    expect(SRC_FUEL).toContain('_haversineKm');
  });

  it('kullanıcı reddi kalıcıdır (kart ısrar etmez)', () => {
    expect(SRC_FUEL).toContain('_isDismissed');
    expect(SRC_FUEL).toContain('_markDismissed');
  });

  it('rota farkındalığı ve tehlike kapısı korunur', () => {
    // Rota dışı istasyon önermek ve tehlikeli noktaya yönlendirmek yasak.
    expect(SRC_FUEL).toContain('_routeAwareScore');
    expect(SRC_FUEL).toContain('_hasNearbyHazard');
  });

  it('⚠️ iç mantık dışa VERİLMİYOR — bu testler davranışı değil sözleşmeyi dondurur', () => {
    // Göç sırasında bu modülün gerçek karar mantığını doğrulamak için
    // saf fonksiyonların export edilmesi GEREKİR (kütük #499).
    const exports = [...SRC_FUEL.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
    expect(exports.sort()).toEqual(['startFuelAdvisor', 'stopFuelAdvisor']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · smartCardEngine — SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

describe('5 · smartCardEngine — sözleşme dondurma', () => {
  it('start/stop çifti vardır', () => {
    expect(SRC_CARD).toContain('export function startSmartCardEngine');
    expect(SRC_CARD).toContain('export function stopSmartCardEngine');
  });

  it('olay fırtınası kapalı — debounce 150 ms', () => {
    // Debounce kalkarsa her store olayında _compute() koşar → hot-path yükü.
    expect(SRC_CARD).toMatch(/EVENT_DEBOUNCE_MS\s*=\s*150/);
  });

  it('gün bölümü eşikleri bugünkü değerlerinde', () => {
    expect(SRC_CARD).toMatch(/MORNING_START_H\s*=\s*7/);
    expect(SRC_CARD).toMatch(/EVENING_START_H\s*=\s*18/);
  });

  it('gereksiz yeniden çizim engellenir (kart eşitliği kontrolü)', () => {
    expect(SRC_CARD).toContain('_cardsEqual');
  });

  it('⚠️ iç mantık dışa VERİLMİYOR — sözleşme dondurma (kütük #499)', () => {
    const exports = [...SRC_CARD.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
    expect(exports.sort()).toEqual(['startSmartCardEngine', 'stopSmartCardEngine']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6 · ÜÇÜ İÇİN ORTAK — göçte sessiz değişimi yakalayan kapılar
   ══════════════════════════════════════════════════════════════════════════ */

describe('6 · ortak göç kapıları', () => {
  it('üç modül de kendi timer\'ını temizler (zero-leak)', () => {
    for (const [name, src] of [
      ['maintenanceBrain', SRC_BRAIN], ['fuelAdvisorService', SRC_FUEL],
      ['smartCardEngine', SRC_CARD],
    ] as const) {
      const hasTimer = /setInterval|setTimeout/.test(src);
      if (hasTimer) {
        expect(/clearInterval|clearTimeout/.test(src), `${name}: timer var ama temizlik yok`)
          .toBe(true);
      }
    }
  });

  it('hiçbiri karar omurgasına HENÜZ bağlı değil — göç başlangıç durumu', () => {
    /*
     * ADR-286 göç sırası: bu üçü 6·7·8 numaralı adımlardır ve Faz 0
     * tamamlanmadan başlamazlar. Bu kilit, başlangıç durumunu kaydeder:
     * biri erkenden motora bağlanırsa test DÜŞER ve sıra bozulmuş olur.
     * Bağlama bilinçliyse bu testi GÜNCELLE.
     */
    for (const src of [SRC_BRAIN, SRC_FUEL, SRC_CARD]) {
      expect(src).not.toContain('maviReasoningEngine');
      expect(src).not.toContain('maviReasoningStore');
    }
  });
});
