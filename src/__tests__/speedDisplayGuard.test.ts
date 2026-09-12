/**
 * speedDisplayGuard.test.ts — #634 KİLİDİ
 * Fiziksel olarak imkânsız hız EKRANA ÇIKAMAZ.
 *
 * ── NEDEN VAR (kullanıcı ekran görüntüsü, 2026-08-18 18:33) ────────────────
 * Araç DURURKEN hız göstergesinde beş haneli değerler göründü ve kullanıcı
 * bunu *"durduğum yerde böyle yükselip duruyor"* diye bildirdi. Aynı karede
 * araç durumu kartı da farklı bir sayı gösteriyordu.
 *
 * ── DÜRÜST SINIR: KÖK BULUNAMADI ───────────────────────────────────────────
 * Kusur cihazda TEKRARLATILAMADI (ölçüm sırasında hız sabit `0` ve sonra `—`
 * okundu; GPS donanımı logcat'te `speed:0.000000` veriyordu). Ayrıca WebView
 * `console` çıktısı logcat'e DÜŞMÜYOR — yani `[SafetyGate] Rejected Speed`
 * uyarısı olsa bile görülemezdi; "kapı reddetmemiş" çıkarımı bu yüzden
 * geçersizdir ve yapılmamıştır.
 *
 * Bu kilit KÖKÜ İDDİA ETMEZ. İki şeyi garanti eder:
 *   1. Kök nerede olursa olsun, absürt değer SÜRÜCÜYE gösterilmez.
 *   2. Bir dahaki ihlalde iz kalır (sayaç + son değer) — böylece kök
 *      sonraki turda tahminle değil ÖLÇÜMLE bulunabilir.
 *
 * Sürücüye "1.203 km/h" yazmak hiçbir şey yazmamaktan DAHA KÖTÜDÜR: hız aynı
 * zamanda ETA ve hız-limiti uyarısının girdisidir.
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatDisplaySpeed, SPEED_UNKNOWN_TEXT, SPEED_PHYSICAL_MAX_KMH,
  getSpeedDisplayRejections, _resetSpeedDisplayRejectionsForTest,
} from '../hooks/useDisplaySpeed';

describe('#634 — imkânsız hız ekrana çıkamaz', () => {
  beforeEach(() => { _resetSpeedDisplayRejectionsForTest(); });

  it('🔒 kullanıcının gördüğü beş haneli değerler `—` olur', () => {
    /* Ekran görüntüsündeki değerler — sabit olarak yazılı ki bir daha
       geçerse kilit tam o senaryoyu yakalasın. */
    for (const bad of [60098, 8970, 1203, 301]) {
      expect(formatDisplaySpeed(bad), `${bad} ekrana çıktı`).toBe(SPEED_UNKNOWN_TEXT);
    }
  });

  it('🔒 negatif hız da ekrana çıkmaz', () => {
    expect(formatDisplaySpeed(-1)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(-999)).toBe(SPEED_UNKNOWN_TEXT);
  });

  it('🔒 GEÇERLİ aralık aynen gösterilir — kapı gerçek hızı yutmaz', () => {
    expect(formatDisplaySpeed(0)).toBe('0');
    expect(formatDisplaySpeed(9)).toBe('9');
    expect(formatDisplaySpeed(120)).toBe('120');
    expect(formatDisplaySpeed(SPEED_PHYSICAL_MAX_KMH)).toBe('300');
  });

  it('🔒 ONDALIK GÖSTERİLMEZ — kullanıcı isteği (tam sayı)', () => {
    expect(formatDisplaySpeed(8.97)).toBe('9');
    expect(formatDisplaySpeed(0.4)).toBe('0');
    expect(formatDisplaySpeed(119.6)).toBe('120');
    /* Hiçbir çıktı ondalık ayırıcı taşımaz. */
    for (const v of [0, 0.5, 8.97, 42.42, 299.9]) {
      expect(formatDisplaySpeed(v)).not.toMatch(/[.,]/);
    }
  });

  it('🔒 "bilinmiyor" ile "sıfır" AYRI kalır (sahte 0 yasağı korunur)', () => {
    expect(formatDisplaySpeed(null)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(undefined)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(Number.NaN)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(0)).toBe('0');           // duran araç ≠ verisi olmayan araç
  });

  it('🔒 ihlal İZ BIRAKIR — bir dahaki sefere kök ölçümle aranabilir', () => {
    expect(getSpeedDisplayRejections()).toEqual({ count: 0, last: null });
    formatDisplaySpeed(60098);
    formatDisplaySpeed(42);          // geçerli — sayacı artırmamalı
    formatDisplaySpeed(8970);
    const r = getSpeedDisplayRejections();
    expect(r.count, 'ihlal sayacı tutmuyor').toBe(2);
    expect(r.last, 'son ihlal değeri kaydedilmiyor').toBe(8970);
  });

  it('🔒 gözlem BOUNDED — geçmiş listesi tutulmaz (bellek sızıntısı yok)', () => {
    for (let i = 0; i < 500; i++) formatDisplaySpeed(1000 + i);
    const r = getSpeedDisplayRejections();
    expect(r.count).toBe(500);
    expect(Object.keys(r).sort()).toEqual(['count', 'last']);  // yalnız iki alan
  });

  it('🔒 sınır, store kapısıyla AYNI değerdedir (iki kapı ayrışmaz)', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(
      'src/platform/vehicleDataLayer/UnifiedVehicleStore.ts', 'utf8'));
    expect(src, 'store kapısı 300 değil — iki katman ayrıştı')
      .toMatch(/patch\.speed\s*<=\s*300/);
    expect(SPEED_PHYSICAL_MAX_KMH).toBe(300);
  });
});
