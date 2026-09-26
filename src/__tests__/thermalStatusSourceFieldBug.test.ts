/**
 * thermalStatusSourceFieldBug.test.ts — 2026-09-06 GERÇEK CİHAZ SAHA KUSURU.
 *
 * ÖLÇÜLEN KUSUR (Redmi 23090RA98I, adb + CDP, karşılaştırmalı):
 *
 *   Android'in kendi hükmü :  dumpsys thermalservice → HAL Ready: true
 *                             Thermal Status: 3 (SEVERE), SKIN 51 °C, CPU 63 °C
 *   Uygulamanın hükmü      :  L0 (hiçbir kısıtlama)
 *   CSS çıktısı            :  --rt-blur:1  --rt-anim:1  --rt-shadow:1
 *
 * NEDEN: watchdog'un İKİ kaynağı da bu durumu GÖREMİYORDU —
 *   • batarya      40.4 °C  <  45 °C (L1 eşiği)      → susuyor
 *   • SoC die      63   °C  < 100 °C (SOC_DIE_L1)    → susuyor
 *   • üretici hükmü SEVERE                            → HİÇ OKUNMUYORDU
 *
 * SONUÇ (ölçüldü): tam ekran haritada RenderThread %80'de sabitlendi; sadece
 * blur+shadow kapatmak onu %42'ye, GPU'yu %26 → %9.6'ya düşürüyordu. Yani
 * koruma mekanizması VARDI, doğru sinyal ona hiç ulaşmıyordu.
 *
 * DÜZELTME: `PowerManager.getCurrentThermalStatus()` native köprüden okunur ve
 * die tahmininden ÖNCE gelir (üretici kalibrasyonu cilt sıcaklığını da kapsar).
 * HAL'in ölü olduğu head unit'lerde alan hiç gelmez → eski sysfs yolu AYNEN
 * korunur (kütük #139 kararı bozulmadı).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { statusLevelFor } from '../platform/thermalWatchdog';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const WATCHDOG = read('src/platform/thermalWatchdog.ts');
const PLUGIN   = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');

describe('① statusLevelFor — üretici termal hükmü → kademe (saf fonksiyon)', () => {
  it('🔒 SEVERE(3) → L2: sahadaki birebir durum artık kısıtlama ÜRETİR', () => {
    expect(statusLevelFor(3), 'SEVERE hâlâ sessiz — kusur geri geldi').toBe(2);
  });

  it('🔒 kademe eşlemesi Android tanımlarıyla birebir', () => {
    expect(statusLevelFor(0)).toBe(0);   // NONE
    expect(statusLevelFor(1)).toBe(0);   // LIGHT — kullanıcıya sezilmez
    expect(statusLevelFor(2)).toBe(1);   // MODERATE
    expect(statusLevelFor(3)).toBe(2);   // SEVERE
    expect(statusLevelFor(4)).toBe(3);   // CRITICAL
    expect(statusLevelFor(5)).toBe(3);   // EMERGENCY
    expect(statusLevelFor(6)).toBe(3);   // SHUTDOWN
  });

  it('🔒 geçersiz/eksik değer UNAVAILABLE (null) — sahte "serin" hükmü YOK', () => {
    expect(statusLevelFor(undefined), 'eksik alan 0 sayılıyor — sahte serin hüküm').toBeNull();
    expect(statusLevelFor(-2147483648), 'HAL ölü değeri kabul edildi').toBeNull();
    expect(statusLevelFor(7)).toBeNull();
    expect(statusLevelFor(NaN)).toBeNull();
  });
});

describe('② native köprü: değer zero-trust okunur', () => {
  it('🔒 PowerManager.getCurrentThermalStatus() gerçekten çağrılır', () => {
    expect(PLUGIN, 'üretici termal hükmü okunmuyor — kusur geri geldi')
      .toContain('getCurrentThermalStatus()');
  });

  it('🔒 API 29 altında çağrılmaz (eski cihazda çökme YOK)', () => {
    expect(PLUGIN).toMatch(/SDK_INT\s*>=\s*29/);
  });

  it('🔒 geçersiz aralık JSON\'a KONMAZ (HAL ölü → alan hiç gelmez)', () => {
    const i = PLUGIN.indexOf('getCurrentThermalStatus()');
    const gövde = PLUGIN.slice(i - 400, i + 400);
    expect(gövde, 'aralık denetimi yok — Integer.MIN_VALUE sızabilir')
      .toMatch(/st\s*>=\s*0\s*&&\s*st\s*<=\s*6/);
    expect(gövde, 'hata yutulmuyor — okuma düşerse readThermal komple düşer')
      .toContain('catch (Throwable ignored)');
  });
});

describe('③ kaynak önceliği ve geri alma disiplini', () => {
  const poll = (() => {
    const i = WATCHDOG.indexOf('async function _pollNativeThermal(');
    return WATCHDOG.slice(i, WATCHDOG.indexOf('\n}', WATCHDOG.indexOf('const die = selectDieTempC', i)));
  })();

  it('🔒 üretici hükmü die tahmininden ÖNCE değerlendirilir', () => {
    const statusIdx = poll.indexOf('statusLevelFor(');
    const dieIdx    = poll.indexOf('selectDieTempC(');
    expect(statusIdx, 'üretici hükmü okunmuyor').toBeGreaterThan(-1);
    expect(dieIdx,    'die yolu kaldırılmış — head unit desteği düştü').toBeGreaterThan(-1);
    expect(statusIdx, 'sıra ters — die tahmini üretici hükmünü eziyor').toBeLessThan(dieIdx);
  });

  it('🔒 üretici hükmü kesindir: kısıtlama varken die yolu ÇALIŞTIRILMAZ', () => {
    expect(poll, 'erken dönüş yok — die, üretici hükmünü ezebilir')
      .toMatch(/_applyTemp\([\s\S]{0,80}\);\s*\n\s*return;\s*\/\/ üretici hükmü kesindir/);
  });

  it('🔒 yalnız KENDİ yükselttiğini serbest bırakır (başka kaynağı ezmez)', () => {
    expect(poll).toContain('if (_statusEscalated)');
  });

  it('🔒 head unit yolu korundu: die kaynağı hâlâ kendi eşikleriyle çalışıyor', () => {
    expect(WATCHDOG).toContain('SOC_DIE_L1');
    expect(WATCHDOG, 'die histerezisi kaldırılmış').toContain('dieLevelFor');
  });

  it('🔒 stop() sahiplik bayraklarını sıfırlar (yeniden başlatmada yanlış geri-alma YOK)', () => {
    const i = WATCHDOG.indexOf('export function stopThermalWatchdog(');
    const gövde = WATCHDOG.slice(i, WATCHDOG.indexOf('\n}', i));
    expect(gövde).toContain('_statusEscalated     = false;');
    expect(gövde).toContain('_socEscalated        = false;');
  });
});

/**
 * ④ İKİNCİ SAHA KUSURU (aynı turda, gerçek cihazda ölçüldü):
 * `--rt-blur: 0` uygulanmasına RAĞMEN ekranda **50 element** hâlâ sabit
 * `backdrop-filter: blur(8px|32px)` ile duruyordu — Tailwind `backdrop-blur-*`
 * sınıfları `calc(var(--rt-blur,1) * Npx)` çarpanını KULLANMAZ. Yani termal
 * kısıtlama "blur kapalı" derken GPU'nun en pahalı işi açık kalıyordu.
 * Çözüm `rt-no-shadow` deseninin birebir kardeşi: `html.rt-no-blur`.
 */
describe('④ blur kısıtlaması KAÇAK BIRAKMAZ (sabit Tailwind sınıfları dahil)', () => {
  const ARM = read('src/core/runtime/AdaptiveRuntimeManager.ts');
  const CSS = read('src/index.css');

  it('🔒 enableBlur=false → html.rt-no-blur sınıfı yazılır', () => {
    expect(ARM, 'sınıf anahtarı yok — sabit blur sınıfları kısıtlamadan KAÇAR')
      .toMatch(/classList\.toggle\('rt-no-blur',\s*!config\.enableBlur\)/);
  });

  it('🔒 CSS tarafı bu sınıfta TÜM backdrop-filter\'ları kapatır', () => {
    const i = CSS.indexOf('html.rt-no-blur');
    expect(i, 'rt-no-blur kuralı CSS\'te yok').toBeGreaterThan(-1);
    const kural = CSS.slice(i, CSS.indexOf('}', i));
    expect(kural).toMatch(/backdrop-filter:\s*none\s*!important/);
    expect(kural, 'webkit öneki yok — eski WebView\'de kaçak kalır')
      .toMatch(/-webkit-backdrop-filter:\s*none\s*!important/);
  });

  /* ÜÇÜNCÜ KATMAN — CSS dosyası TEK BAŞINA YETMEZ (kurulu APK'da ölçüldü):
   * minifier `backdrop-filter: none !important` bildirimini SİLİYOR. Kanıt:
   * `html.rt-no-blur *` kuralı yüklü stil sayfasında `{ }` boş gövdeyle duruyordu;
   * `base.css`'teki `html[data-runtime="SAFE_MODE"] * { backdrop-filter:none }`
   * ise çıktıda HİÇ YOKTU. Bu yüzden kural ayrıca ÇALIŞMA ZAMANINDA enjekte edilir. */
  it('🔒 kural derleme hattından GEÇMEDEN runtime\'da da enjekte edilir', () => {
    expect(ARM, 'runtime enjeksiyonu yok — minifier kuralı silince koruma ÖLÜR')
      .toContain('_applyBlurKillStyle');
    const i = ARM.indexOf('private _applyBlurKillStyle(');
    const gövde = ARM.slice(i, ARM.indexOf('\n  }', i));
    expect(gövde, 'enjekte edilen kuralda backdrop-filter kapatması yok')
      .toMatch(/backdrop-filter:none !important/);
    expect(gövde, 'webkit öneki yok').toMatch(/-webkit-backdrop-filter:none !important/);
    expect(gövde, 'kısıt kalkınca içerik boşaltılmıyor — blur geri GELMEZ')
      .toMatch(/:\s*''/);
  });

  it('🔒 Zero-Leak: enjekte edilen <style> destroy()\'da kaldırılır', () => {
    const i = ARM.indexOf('  destroy(): void {');
    const gövde = ARM.slice(i, i + 600);
    expect(gövde).toContain('this._blurKillEl?.remove()');
    expect(gövde).toContain('this._blurKillEl = null');
  });

  it('🔒 gölge kardeşi bozulmadı (aynı desen, iki ayrı bütçe)', () => {
    expect(ARM).toMatch(/classList\.toggle\('rt-no-shadow',\s*!config\.enableShadows\)/);
    expect(CSS).toContain('html.rt-no-shadow *');
  });

  it('🔒 `--rt-blur` çarpanı KALDIRILMADI (iki mekanizma birlikte çalışır)', () => {
    expect(ARM).toContain("setProperty('--rt-blur'");
    expect(CSS, 'çarpan deseni kaldırılmış — ince ayar yeteneği kayboldu')
      .toContain('calc(var(--rt-blur, 1)');
  });
});
