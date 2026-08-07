/**
 * carosLabLocationEngine.test.ts — LAB LOCATION ENGINE KİLİTLERİ.
 *
 * İki şey kilitlenir:
 *   (A) Zorunlu Gözlemlenebilirlik: salt-okunur · gerçek kaynak ·
 *       aktif komut YOK · kanıtsız bilgi YOK · KOORDİNAT GÖSTERİLMEZ.
 *   (B) "Mevcut davranışı bozma": motor `gpsService`'i YALNIZ GÖZLER —
 *       başlatmaz, durdurmaz, yeniden başlatmaz, konfigürasyonuna dokunmaz.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SCREEN   = 'src/components/devtools/screens/LocationEngineScreen.tsx';
const PROVIDER = 'src/platform/location/locationProvider.ts';
const CONF     = 'src/platform/location/locationConfidence.ts';
const ARBITER  = 'src/platform/location/locationArbiter.ts';
const RUNTIME  = 'src/platform/location/locationEngineRuntime.ts';

describe('LAB · katalog ve yönlendirme', () => {
  it('1. 🔒 araç kategorisinde AVAILABLE bir Location Engine aracı var', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'location-engine');
    expect(tool, 'katalogda location-engine yok').toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
    expect(tool!.layer).toBe('GNSS');
    expect(tool!.note).toMatch(/BAŞLATMAZ/);
    expect(tool!.note).toMatch(/KOORDİNAT/);
    expect(tool!.note).toMatch(/DAHİL DEĞİL/);   // harici taşıma kapsam dışı
  });

  it('2. 🔒 araç kimliği TİP UNION\'ında kayıtlı (route sözleşmesi gerçek)', () => {
    /* `tsc -b` bu union'ı GERÇEKTEN uygular; union'a eklenmeyen bir id
       kök build'i kırar. Bu kilit o sözleşmeyi metin düzeyinde de sabitler. */
    const cat = read('src/platform/devtools/carosLabCatalog.ts');
    expect(cat).toMatch(/'location-engine'/);
    const unionBlock = cat.slice(
      cat.indexOf('export type CarosLabToolId'),
      cat.indexOf('export interface CarosLabTool'),
    );
    expect(unionBlock).toContain("'location-engine'");
    expect(unionBlock).toContain("'fleet-connectivity'");
    expect(unionBlock).toContain("'fleet-identity'");
  });

  it('3. 🔒 ekran haritası lazy bağlar', () => {
    const map = read('src/components/devtools/carosLabScreenMap.tsx');
    expect(map).toMatch(/case 'location-engine':/);
    expect(map).toMatch(/import\('\.\/screens\/LocationEngineScreen'\)/);
    expect(existsSync(join(ROOT, SCREEN))).toBe(true);
  });
});

describe('LAB · aktif komut YOK', () => {
  it('4. 🔒 ekran GPS\'e dokunmuyor', () => {
    const c = code(SCREEN);
    for (const forbidden of [
      /startGPSTracking/, /stopGPSTracking/, /watchPosition/, /getCurrentPosition/,
      /feedBackgroundLocation/, /registerLocationProvider/, /startLocationEngine/,
      /stopLocationEngine/, /fetch\(/, /setInterval/, /setTimeout/,
    ]) {
      expect(c, `ekran yasak çağrı içeriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('5. 🔒 ekran timer kurmuyor, mountedRef ile temizleniyor', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/mountedRef/);
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('6. 🔒 ekran YALNIZ salt-okunur anlık görüntü okur', () => {
    const c = code(SCREEN);
    expect(c).toMatch(/readLocationEngineSnapshot/);
    expect(c).toMatch(/readLocationEngineProviders/);
  });
});

describe('LAB · KOORDİNAT gösterilmez (kişisel veri)', () => {
  it('7. 🔒 ekran enlem/boylam BASMIYOR', () => {
    const c = code(SCREEN);
    expect(c).not.toMatch(/\{[^}]*\blatitude\b[^}]*\}/);
    expect(c).not.toMatch(/\{[^}]*\blongitude\b[^}]*\}/);
    expect(c).not.toMatch(/sample\.latitude/);
    expect(c).not.toMatch(/sample\.longitude/);
  });

  it('8. 🔒 ekran mutlak zaman damgası basmıyor (yalnız yaş)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/function ageText\(/);
    expect(src).toMatch(/nowMs - atMs/);
    expect(code(SCREEN)).not.toMatch(/toISOString|toLocaleString/);
  });

  it('9. 🔒 bilinmeyen alan UNAVAILABLE (sahte 0 / sahte tarih YOK)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/const UNAVAILABLE = 'UNAVAILABLE'/);
    expect(src).toMatch(/if \(atMs === null\) return UNAVAILABLE;/);
  });

  it('10. 🔒 okuma düşerse ekran çökmez (fail-soft)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/try \{ engine = readLocationEngineSnapshot\(\); \} catch/);
    expect(src).toMatch(/try \{ providers = readLocationEngineProviders\(\); \} catch/);
  });
});

describe('"Mevcut davranışı bozma" — yapısal kilit', () => {
  it('11. 🔒 motor gpsService\'i BAŞLATMIYOR / DURDURMUYOR / YENİDEN BAŞLATMIYOR', () => {
    const c = code(RUNTIME);
    expect(c).not.toMatch(/startGPSTracking/);
    expect(c).not.toMatch(/stopGPSTracking/);
    expect(c).not.toMatch(/watchPosition/);
    expect(c).not.toMatch(/getCurrentPosition/);
    expect(c).not.toMatch(/feedBackgroundLocation/);
    /* YALNIZ gözlem API'leri kullanılır. */
    expect(c).toMatch(/onGPSLocation/);
    expect(c).toMatch(/getGPSState/);
  });

  it('12. 🔒 motor runtimeManager / termal ayarlarına DOKUNMUYOR', () => {
    const c = code(RUNTIME);
    expect(c).not.toMatch(/runtimeManager/);
    expect(c).not.toMatch(/getThermalLevel/);
    expect(c).not.toMatch(/gpsUpdateMs/);
  });

  it('13. 🔒 saf katmanlar I/O ve zaman İÇERMEZ', () => {
    for (const f of [PROVIDER, CONF, ARBITER]) {
      const c = code(f);
      expect(c, `${f} fetch içeriyor`).not.toMatch(/fetch\(/);
      expect(c, `${f} localStorage içeriyor`).not.toMatch(/localStorage/);
      expect(c, `${f} Date.now içeriyor`).not.toMatch(/Date\.now\(\)/);
      expect(c, `${f} timer içeriyor`).not.toMatch(/setInterval|setTimeout/);
    }
  });

  it('14. 🔒 hakem gözlem yüzeyi ASLA fırlatmaz', () => {
    const c = code(ARBITER);
    /* `tick` ve `getSnapshot` üst düzey try/catch ile sarılı olmalı. */
    expect(c).toMatch(/tick\(input: ArbiterTickInput\): ArbiterDecision \{\s*try \{/);
    expect(c).toMatch(/getSnapshot\(\): ArbiterSnapshot \{\s*try \{/);
  });

  it('15. 🔒 SystemBoot motoru cleanup zincirine kaydeder (zero-leak)', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot).toMatch(/startLocationEngine/);
    expect(boot).toMatch(/this\._reg\(startLocationEngine\(\)\)/);
  });

  it('16. 🔒 harici sağlayıcı KAYITSIZ ise "hazır" GÖRÜNMEZ', () => {
    const c = code(RUNTIME);
    /* Yalnız yerleşik ikisi listelenir; harici olanlar kayıt gerektirir. */
    expect(c).toMatch(/return \['HEAD_UNIT_GPS', 'LAST_KNOWN', \.\.\.this\._external\.keys\(\)\]/);
    /* Yerleşiklerin üzerine yazılamaz (iki otorite yasağı). */
    expect(c).toMatch(/if \(p\.id === 'HEAD_UNIT_GPS' \|\| p\.id === 'LAST_KNOWN'\)/);
  });

  it('17. 🔒 LAST_KNOWN zaman damgası UYDURULMUYOR (canlı görünmesin)', () => {
    const src = read(RUNTIME);
    /* Depoda damga yok → "şimdi" YAZILMAZ; durum daima LAST_KNOWN/OFFLINE. */
    expect(src).toMatch(/timestampMs: nowMs - 1/);
    expect(src).toMatch(/Yaş bilinmiyor/);
  });
});
