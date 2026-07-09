/**
 * dtcExtendedCatalog.test.ts — Geniş DTC kataloğu kilidi (PR-DTC-2).
 *
 * Kilitlenen davranışlar:
 *  1. Geniş katalog LAZY — yüklenmeden P0401 çözülmez (çekirdekte yok).
 *  2. preloadExtendedDtcCatalog() kataloğu yükler.
 *  3. Toplam DTC sayısı 200+ (çekirdek 49 + geniş katalog).
 *  4. Bilinen kod (P0401) doğru + AI alanları (trDescription/driveSafe/repairSuggestions) dolu.
 *  5. Çekirdek 49 kodun davranışı bozulmadı (P0300).
 *  6. Bilinmeyen kod fallback'i bozulmadı.
 *
 * NOT: testler sıralı çalışır — (1) önce yüklenmemiş durumu doğrular, sonra yükler.
 */
import { describe, it, expect } from 'vitest';
import { lookupDtc, preloadExtendedDtcCatalog } from '../platform/dtcService';
import { loadedDtcCount, resolveDtcRecord } from '../platform/obd/dtcDataSource';

describe('DTC geniş katalog (PR-DTC-2)', () => {
  it('1) yüklenmeden P0401 çekirdekte YOK (lazy)', () => {
    expect(resolveDtcRecord('P0401')).toBeUndefined();
  });

  it('2) preloadExtendedDtcCatalog() geniş kataloğu yükler', async () => {
    await preloadExtendedDtcCatalog();
    expect(resolveDtcRecord('P0401')).toBeDefined();
  });

  it('3) toplam DTC sayısı 200+', async () => {
    await preloadExtendedDtcCatalog();
    expect(loadedDtcCount()).toBeGreaterThanOrEqual(200);
  });

  it('4) bilinen kod (P0401) doğru dönüyor + AI alanları dolu', async () => {
    await preloadExtendedDtcCatalog();
    const d = lookupDtc('P0401');
    expect(d.code).toBe('P0401');
    expect(d.system).toBe('Emisyon');
    expect(d.severity).toBe('warning');
    expect(d.trDescription).toBeTruthy();
    expect(d.driveSafe).toBeDefined();
    expect(Array.isArray(d.repairSuggestions)).toBe(true);
    expect(d.repairSuggestions!.length).toBeGreaterThan(0);
  });

  it('5) çekirdek kod hâlâ çalışıyor (P0300 — davranış bozulmadı)', async () => {
    await preloadExtendedDtcCatalog();
    const d = lookupDtc('P0300');
    expect(d.description).toBe('Tespit Edilemeyen Silindir Ateşleme Hatası');
    expect(d.severity).toBe('critical');
  });

  it('6) bilinmeyen kod fallback bozulmadı (P0989)', async () => {
    await preloadExtendedDtcCatalog();
    const d = lookupDtc('P0989');
    expect(d.system).toBe('Motor/Sürüş');
    expect(d.severity).toBe('warning');
    expect(d.possibleCauses).toEqual(['Yetkili servise danışın']);
  });

  it('7) B/C/U gruplarından örnek var (dengeli)', async () => {
    await preloadExtendedDtcCatalog();
    expect(lookupDtc('U0002').system).toBe('CAN Ağı');
    expect(lookupDtc('C0035').system).toBe('Fren/ABS');
    expect(lookupDtc('B0012').system).toBe('Güvenlik (SRS)');
  });
});
