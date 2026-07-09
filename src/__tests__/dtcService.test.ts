/**
 * dtcService.test.ts — DTC veri kaynağı soyutlaması kilidi (PR-DTC-1).
 *
 * Kilitlenen davranışlar:
 *  1. Mevcut 49 çekirdek kod hâlâ çözülüyor (P0300 örneği).
 *  2. Kod normalize ediliyor (küçük harf + boşluk).
 *  3. Bilinmeyen kod → prefix tabanlı dürüst fallback.
 *  4. Yeni AI-teşhis alanları çekirdek kodda default undefined (davranış bozulmuyor).
 *  5. Ek katalog kaydı çekirdeği bozmadan yeni kod + AI alanları ekliyor (genişleme).
 *  6. Lazy kaynak iskeleti: registerLazyDtcSource + ensureExtendedDtcLoaded merge ediyor.
 */
import { describe, it, expect } from 'vitest';
import { lookupDtc } from '../platform/dtcService';
import {
  registerDtcCatalog,
  registerLazyDtcSource,
  ensureExtendedDtcLoaded,
  resolveDtcRecord,
  loadedDtcCount,
  type DtcCatalog,
} from '../platform/obd/dtcDataSource';

describe('dtcService — DTC veri kaynağı soyutlaması (PR-DTC-1)', () => {
  it('1) mevcut çekirdek kod hâlâ bulunuyor (P0300)', () => {
    const d = lookupDtc('P0300');
    expect(d.code).toBe('P0300');
    expect(d.description).toBe('Tespit Edilemeyen Silindir Ateşleme Hatası');
    expect(d.system).toBe('Motor');
    expect(d.severity).toBe('critical');
    expect(d.possibleCauses).toContain('Bujiler');
  });

  it('1b) çekirdek kayıt sayısı en az 49 (hot-core yüklendi)', () => {
    expect(loadedDtcCount()).toBeGreaterThanOrEqual(49);
  });

  it('2) kod normalize ediliyor (küçük harf + boşluk)', () => {
    const d = lookupDtc('  p0300 ');
    expect(d.code).toBe('P0300');
    expect(d.description).toBe('Tespit Edilemeyen Silindir Ateşleme Hatası');
  });

  it('3) bilinmeyen kod → prefix fallback (P9999)', () => {
    const d = lookupDtc('P9999');
    expect(d.code).toBe('P9999');
    expect(d.system).toBe('Motor/Sürüş');
    expect(d.severity).toBe('warning');
    expect(d.possibleCauses).toEqual(['Yetkili servise danışın']);
  });

  it('3b) bilinmeyen U kodu → Ağ/İletişim grubu', () => {
    expect(lookupDtc('U9999').system).toBe('Ağ/İletişim');
  });

  it('4) yeni AI alanları çekirdek kodda default undefined (davranış bozulmuyor)', () => {
    const d = lookupDtc('P0300');
    expect(d.trDescription).toBeUndefined();
    expect(d.driveSafe).toBeUndefined();
    expect(d.estimatedCost).toBeUndefined();
    expect(d.repairSuggestions).toBeUndefined();
    expect(d.relatedPids).toBeUndefined();
  });

  it('5) ek katalog kaydı çekirdeği bozmadan yeni kod + AI alanları ekler', () => {
    const extra: DtcCatalog = {
      P0401: {
        description: 'EGR Akışı Yetersiz',
        system: 'Emisyon',
        severity: 'warning',
        possibleCauses: ['EGR valfi tıkalı'],
        trDescription: 'Egzoz gazı geri dönüşüm (EGR) akışı beklenenin altında.',
        driveSafe: 'caution',
        estimatedCost: { tier: 'medium' },
        repairSuggestions: ['EGR valfi temizliği', 'EGR borusu kontrolü'],
        relatedPids: ['2C', '2D'],
      },
    };
    registerDtcCatalog(extra);

    const d = lookupDtc('P0401');
    expect(d.description).toBe('EGR Akışı Yetersiz');
    expect(d.driveSafe).toBe('caution');
    expect(d.estimatedCost).toEqual({ tier: 'medium' });
    expect(d.relatedPids).toEqual(['2C', '2D']);

    // çekirdek hâlâ sağlam
    expect(lookupDtc('P0300').severity).toBe('critical');
  });

  it('6) lazy kaynak iskeleti: registerLazyDtcSource + ensureExtendedDtcLoaded merge eder', async () => {
    expect(resolveDtcRecord('P1234')).toBeUndefined(); // yüklenmeden yok

    registerLazyDtcSource(async () => ({
      P1234: {
        description: 'Üretici Özel Kod',
        system: 'Motor',
        severity: 'info',
        possibleCauses: ['Yetkili servis'],
      },
    }));
    await ensureExtendedDtcLoaded();

    expect(resolveDtcRecord('P1234')?.description).toBe('Üretici Özel Kod');
    // artık lookupDtc üzerinden de çözülür
    expect(lookupDtc('P1234').severity).toBe('info');
  });
});
