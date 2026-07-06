/**
 * globalDiagnosticButton.test.ts — "her yere Tanı Gönder" global tetik kilidi.
 *
 * Dilim 3: bir sorun uygulamanın neresinde olursa olsun tek dokunuşla saha
 * verisi gelebilsin diye App.tsx'e mount edilen tek global "Tanı Gönder"
 * butonu. Bu kilit, butonun sessizce kaybolmamasını (mount + doğru aksiyon +
 * geri-vites güvenlik kapısı) garantiler.
 *
 * ?raw = transform-time sabit (readFileSync paralel-suite flake'inden bağışık —
 * bkz. proje hafıza notu: regression-guard-raw-import).
 */
import { describe, it, expect } from 'vitest';
import appSrc from '../App.tsx?raw';
import btnSrc from '../components/common/GlobalDiagnosticButton.tsx?raw';

describe('GlobalDiagnosticButton — global "Tanı Gönder" kilidi', () => {
  it('App.tsx bileşeni import eder ve mount eder', () => {
    expect(appSrc).toContain("import { GlobalDiagnosticButton }");
    expect(appSrc).toContain('<GlobalDiagnosticButton />');
  });

  it('geri vites aktifken gizlenir (kamera temiz — safety kapısı)', () => {
    // Mount satırı !storeReverse kapısında olmalı (diğer global overlay'lerle aynı).
    expect(appSrc).toContain('!storeReverse && <GlobalDiagnosticButton />');
  });

  it('aktif self-test taramasını (Tanı Robotu) tetikler', () => {
    // Buton artık pasif snapshot yerine robotu koşturur: her alt sistemin
    // kapısı çalınıp rapor gönderilir (triggerSelfTestSnapshot → runSelfTest).
    expect(btnSrc).toContain('triggerSelfTestSnapshot');
    // not_paired dahil tüm sonuç durumları etiketlenir (yalancı başarı yok)
    expect(btnSrc).toContain('not_paired');
  });
});
