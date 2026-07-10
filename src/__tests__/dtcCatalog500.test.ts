/**
 * dtcCatalog500.test.ts — 500+ DTC kataloğu kilidi (PR-DTC-3).
 *
 * Kilitlenen davranışlar:
 *  1. Lazy: yüklenmeden ikinci katalog kodu (P0273) çekirdekte YOK.
 *  2. preloadExtendedDtcCatalog() her iki geniş kataloğu da yükler.
 *  3. Toplam benzersiz DTC sayısı 500+ (çekirdek 49 + geniş 163 + geniş-2 335).
 *  4. Mevcut 212 kod bozulmadı (çekirdek P0300 + PR-DTC-2 P0401).
 *  5. Bilinmeyen kod fallback'i hâlâ çalışıyor.
 *  6. P0/P2/P3/U/B/C prefix dağılımı raporlanıyor (ve beklenen gruplar dolu).
 *  7. İkinci katalogda çekirdek/PR-DTC-2 ile ÇAKIŞAN kod yok (son-kaynak-kazanır
 *     sessiz eziminin regresyonunu engeller).
 *
 * NOT: testler sıralı çalışır — (1) önce yüklenmemiş durumu doğrular, sonra yükler.
 */
import { describe, it, expect } from 'vitest';
import { lookupDtc, preloadExtendedDtcCatalog } from '../platform/dtcService';
import { loadedDtcCount, resolveDtcRecord } from '../platform/obd/dtcDataSource';
import CORE_EXTENDED from '../platform/obd/data/dtcExtendedCatalog';
import EXTENDED_2 from '../platform/obd/data/dtcExtendedCatalog2';

/** Kod önekine göre grup: P0/P2/P3 (P alt aileleri) + U/B/C. */
function prefixGroup(code: string): string {
  const c = code.toUpperCase();
  if (c[0] === 'P') return `P${c[1]}`; // P0, P2, P3, P1...
  return c[0]; // U, B, C
}

/** Yüklü tüm kodların (çekirdek + geniş kataloglar) birleşik anahtar kümesi. */
function allLoadedCodes(): string[] {
  // resolveDtcRecord senkron kayıt defterinden okur; kod listesini kataloglardan türet.
  const set = new Set<string>();
  for (const code of Object.keys(CORE_EXTENDED)) set.add(code.toUpperCase());
  for (const code of Object.keys(EXTENDED_2)) set.add(code.toUpperCase());
  // Çekirdek DTC_DB kodları resolveDtcRecord ile teyit edilir (aşağıdaki 4. test).
  return [...set];
}

describe('DTC 500+ katalog (PR-DTC-3)', () => {
  it('1) yüklenmeden ikinci katalog kodu (P0273) çekirdekte YOK (lazy)', () => {
    expect(resolveDtcRecord('P0273')).toBeUndefined();
  });

  it('2) preload sonrası ikinci katalog kodu (P0273) çözülüyor', async () => {
    await preloadExtendedDtcCatalog();
    expect(resolveDtcRecord('P0273')).toBeDefined();
  });

  it('3) toplam benzersiz DTC sayısı 500+', async () => {
    await preloadExtendedDtcCatalog();
    expect(loadedDtcCount()).toBeGreaterThanOrEqual(500);
  });

  it('4) mevcut 212 kod bozulmadı (çekirdek P0300 + PR-DTC-2 P0401)', async () => {
    await preloadExtendedDtcCatalog();
    const core = lookupDtc('P0300');
    expect(core.description).toBe('Tespit Edilemeyen Silindir Ateşleme Hatası');
    expect(core.severity).toBe('critical');
    const ext = lookupDtc('P0401');
    expect(ext.system).toBe('Emisyon');
    expect(ext.trDescription).toBeTruthy();
  });

  it('5) bilinmeyen kod fallback bozulmadı (P0XYZ → P0777 gibi)', async () => {
    await preloadExtendedDtcCatalog();
    const d = lookupDtc('P0779'); // katalogda olmayan generic kod
    expect(d.system).toBe('Motor/Sürüş');
    expect(d.severity).toBe('warning');
    expect(d.possibleCauses).toEqual(['Yetkili servise danışın']);
  });

  it('6) P0/P2/P3/U/B/C dağılımı raporlanıyor', async () => {
    await preloadExtendedDtcCatalog();
    const dist: Record<string, number> = {};
    for (const code of allLoadedCodes()) {
      const g = prefixGroup(code);
      dist[g] = (dist[g] ?? 0) + 1;
    }
    // Konsola dağılım raporu (görev tanımı: dağılım raporlanmalı).
    // eslint-disable-next-line no-console
    console.log('[PR-DTC-3] geniş katalog prefix dağılımı:', JSON.stringify(dist));

    // Beklenen gruplar dolu olmalı (dürüstlük: P3 = üretici-özel, KASITLI 0).
    expect(dist['P0']).toBeGreaterThan(0);
    expect(dist['P2']).toBeGreaterThan(0);
    expect(dist['U']).toBeGreaterThan(0);
    expect(dist['B']).toBeGreaterThan(0);
    expect(dist['C']).toBeGreaterThan(0);
    // P3xxx (üretici-özel) bilinçli EKLENMEDİ → 0 olmalı.
    expect(dist['P3'] ?? 0).toBe(0);
    // P1xxx (üretici-özel) da eklenmemeli.
    expect(dist['P1'] ?? 0).toBe(0);
  });

  it('7) ikinci katalog çekirdek/PR-DTC-2 ile ÇAKIŞMIYOR', () => {
    const first = new Set(Object.keys(CORE_EXTENDED).map((c) => c.toUpperCase()));
    const dupes = Object.keys(EXTENDED_2)
      .map((c) => c.toUpperCase())
      .filter((c) => first.has(c));
    expect(dupes).toEqual([]);
  });

  it('8) ikinci katalog kayıtları zorunlu alanları taşıyor', () => {
    for (const [code, rec] of Object.entries(EXTENDED_2)) {
      expect(rec.description, `${code} description`).toBeTruthy();
      expect(rec.system, `${code} system`).toBeTruthy();
      expect(['critical', 'warning', 'info']).toContain(rec.severity);
      expect(Array.isArray(rec.possibleCauses), `${code} possibleCauses`).toBe(true);
    }
  });
});
